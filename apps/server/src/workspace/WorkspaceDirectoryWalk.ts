// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import type * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodePerfHooks from "node:perf_hooks";

import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { ProjectEntry, ProjectListEntriesResult } from "@t3tools/contracts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";

const WORKSPACE_DIRECTORY_MAX_ENTRIES = 25_000;
const WORKSPACE_DIRECTORY_WALK_BUDGET_MS = 10_000;
const WORKSPACE_DIRECTORY_CACHE_TTL = "5 seconds";
const WORKSPACE_DIRECTORY_CACHE_CAPACITY = 32;

// node_modules is intentionally omitted from the fully materialized explorer:
// it commonly exhausts the 25k cap and buries the useful project tree.
const SKIPPED_ENTRY_NAMES = new Set([".git", "node_modules"]);

export interface WorkspaceDirectoryWalkOptions {
  readonly maxEntries?: number;
  readonly timeBudgetMs?: number;
}

interface PendingDirectory {
  readonly absolutePath: string;
  readonly relativePath: string;
}

// A directory the walk cannot read is skipped rather than failing the whole
// listing. Beyond the permission cases, a queued directory can disappear or be
// replaced between being enqueued and being read — build tools and watchers do
// this routinely — and a workspace listing is far too hot a path to fail over
// one transient entry.
function isUnreadableDirectoryError(cause: unknown): boolean {
  const code = (cause as NodeJS.ErrnoException | undefined)?.code;
  return (
    code === "EACCES" ||
    code === "EPERM" ||
    code === "ENOENT" ||
    code === "ENOTDIR" ||
    code === "ELOOP"
  );
}

function toPosixPath(input: string): string {
  return input.replaceAll(NodePath.sep, "/");
}

async function classifySymlink(absolutePath: string): Promise<ProjectEntry["kind"]> {
  try {
    return (await NodeFSP.stat(absolutePath)).isDirectory() ? "directory" : "file";
  } catch {
    // Broken or concurrently removed symlinks are still useful filesystem entries.
    return "file";
  }
}

export const walkWorkspaceDirectory = Effect.fn("WorkspaceDirectoryWalk.walkWorkspaceDirectory")(
  function* (
    cwd: string,
    options?: WorkspaceDirectoryWalkOptions,
  ): Effect.fn.Return<ProjectListEntriesResult> {
    const maxEntries = options?.maxEntries ?? WORKSPACE_DIRECTORY_MAX_ENTRIES;
    const timeBudgetMs = options?.timeBudgetMs ?? WORKSPACE_DIRECTORY_WALK_BUDGET_MS;

    return yield* Effect.promise(async () => {
      const startedAt = NodePerfHooks.performance.now();
      const entries: ProjectEntry[] = [];
      const pendingDirectories: PendingDirectory[] = [{ absolutePath: cwd, relativePath: "" }];

      for (let queueIndex = 0; queueIndex < pendingDirectories.length; queueIndex += 1) {
        if (NodePerfHooks.performance.now() - startedAt >= timeBudgetMs) {
          return { entries, truncated: true };
        }

        const pendingDirectory = pendingDirectories[queueIndex]!;
        let dirents: NodeFS.Dirent<string>[];
        try {
          dirents = await NodeFSP.readdir(pendingDirectory.absolutePath, {
            withFileTypes: true,
          });
        } catch (cause) {
          if (isUnreadableDirectoryError(cause)) {
            continue;
          }
          throw cause;
        }

        dirents.sort((left, right) => left.name.localeCompare(right.name));
        for (const dirent of dirents) {
          if (
            NodePerfHooks.performance.now() - startedAt >= timeBudgetMs ||
            entries.length >= maxEntries
          ) {
            return { entries, truncated: true };
          }
          if (SKIPPED_ENTRY_NAMES.has(dirent.name)) {
            continue;
          }

          const absolutePath = NodePath.join(pendingDirectory.absolutePath, dirent.name);
          const relativePath = toPosixPath(
            pendingDirectory.relativePath
              ? NodePath.join(pendingDirectory.relativePath, dirent.name)
              : dirent.name,
          );
          const kind = dirent.isSymbolicLink()
            ? await classifySymlink(absolutePath)
            : dirent.isDirectory()
              ? "directory"
              : "file";

          entries.push({ path: relativePath, kind });
          if (kind === "directory" && !dirent.isSymbolicLink()) {
            pendingDirectories.push({ absolutePath, relativePath });
          }
        }
      }

      return { entries, truncated: false };
    });
  },
);

export class WorkspaceDirectoryWalk extends Context.Service<
  WorkspaceDirectoryWalk,
  {
    readonly list: (cwd: string) => Effect.Effect<ProjectListEntriesResult>;
    readonly invalidate: (cwd: string) => Effect.Effect<void>;
  }
>()("t3/workspace/WorkspaceDirectoryWalk") {}

export const make = Effect.gen(function* () {
  const listUncached = Effect.fn("WorkspaceDirectoryWalk.listUncached")(function* (cwd: string) {
    const result = yield* walkWorkspaceDirectory(cwd);
    const ignoredPaths = yield* GitVcsDriver.findIgnoredPaths(
      cwd,
      result.entries.map((entry) => entry.path),
    ).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Failed to classify gitignored workspace entries", {
          cwd,
          cause,
        }).pipe(Effect.as(new Set<string>())),
      ),
    );

    return {
      entries: result.entries.map((entry) => ({
        ...entry,
        ignored: ignoredPaths.has(entry.path),
      })),
      truncated: result.truncated,
    } satisfies ProjectListEntriesResult;
  });
  const cache = yield* Cache.make({
    capacity: WORKSPACE_DIRECTORY_CACHE_CAPACITY,
    timeToLive: WORKSPACE_DIRECTORY_CACHE_TTL,
    lookup: listUncached,
  });

  return WorkspaceDirectoryWalk.of({
    list: (cwd) => Cache.get(cache, cwd),
    invalidate: (cwd) => Cache.invalidate(cache, cwd),
  });
});

export const layer = Layer.effect(WorkspaceDirectoryWalk, make).pipe(
  Layer.provide(VcsProcess.layer),
);
