// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import type * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodePerfHooks from "node:perf_hooks";

import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { ProjectEntry, ProjectListEntriesResult } from "@aqqua/contracts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";

const WORKSPACE_DIRECTORY_MAX_ENTRIES = 25_000;
const WORKSPACE_DIRECTORY_WALK_BUDGET_MS = 10_000;
const WORKSPACE_DIRECTORY_CACHE_TTL = "5 seconds";
const WORKSPACE_DIRECTORY_CACHE_CAPACITY = 32;
const MAX_DIRECTORY_ALIAS_VISITS_PER_TARGET = 4;

// Dependency and build caches can exhaust the 25k cap before the walk reaches
// source files, leaving ordinary project folders with no listed children.
const SKIPPED_ENTRY_NAMES = new Set([".git", "node_modules", ".pnpm-store", ".turbo"]);

export interface WorkspaceDirectoryWalkOptions {
  readonly maxEntries?: number;
  readonly timeBudgetMs?: number;
}

interface PendingDirectory {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly parent: PendingDirectory | null;
}

// Check only this branch so the same directory can appear at its original path
// and through links such as .claude/skills without following a cycle.
function isAncestorDirectory(directory: PendingDirectory, absolutePath: string): boolean {
  for (let ancestor: PendingDirectory | null = directory; ancestor; ancestor = ancestor.parent) {
    if (ancestor.absolutePath === absolutePath) return true;
  }
  return false;
}

function containsSkippedPathSegment(relativePath: string): boolean {
  return relativePath
    .split(NodePath.sep)
    .some((segment) => segment.length > 0 && SKIPPED_ENTRY_NAMES.has(segment));
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

const walkDirectory = Effect.fn("WorkspaceDirectoryWalk.walkDirectory")(function* (
  cwd: string,
  options?: WorkspaceDirectoryWalkOptions,
): Effect.fn.Return<ProjectListEntriesResult & { readonly gitPaths: ReadonlyMap<string, string> }> {
  const maxEntries = options?.maxEntries ?? WORKSPACE_DIRECTORY_MAX_ENTRIES;
  const timeBudgetMs = options?.timeBudgetMs ?? WORKSPACE_DIRECTORY_WALK_BUDGET_MS;

  return yield* Effect.promise(async () => {
    const startedAt = NodePerfHooks.performance.now();
    const entries: ProjectEntry[] = [];
    const gitPaths = new Map<string, string>();
    const directoryAliasVisits = new Map<string, number>();
    let workspaceRealPath: string;
    try {
      workspaceRealPath = await NodeFSP.realpath(cwd);
    } catch (cause) {
      if (isUnreadableDirectoryError(cause)) return { entries, truncated: false, gitPaths };
      throw cause;
    }
    const pendingDirectories: PendingDirectory[] = [
      { absolutePath: workspaceRealPath, relativePath: "", parent: null },
    ];

    for (let queueIndex = 0; queueIndex < pendingDirectories.length; queueIndex += 1) {
      if (NodePerfHooks.performance.now() - startedAt >= timeBudgetMs) {
        return { entries, truncated: true, gitPaths };
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
          return { entries, truncated: true, gitPaths };
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
        // Git rejects paths below a symlink. Classify linked children using
        // their original workspace paths while retaining aliases in the UI.
        const gitPath = toPosixPath(NodePath.relative(workspaceRealPath, absolutePath));
        if (gitPath !== relativePath) gitPaths.set(relativePath, gitPath);
        if (kind !== "directory") continue;

        let directoryRealPath = absolutePath;
        if (dirent.isSymbolicLink()) {
          try {
            directoryRealPath = await NodeFSP.realpath(absolutePath);
          } catch (cause) {
            if (isUnreadableDirectoryError(cause)) continue;
            throw cause;
          }
          const relativeToRoot = NodePath.relative(workspaceRealPath, directoryRealPath);
          if (
            relativeToRoot === ".." ||
            relativeToRoot.startsWith(`..${NodePath.sep}`) ||
            NodePath.isAbsolute(relativeToRoot) ||
            containsSkippedPathSegment(relativeToRoot) ||
            isAncestorDirectory(pendingDirectory, directoryRealPath)
          ) {
            continue;
          }
          const visits = directoryAliasVisits.get(directoryRealPath) ?? 0;
          if (visits >= MAX_DIRECTORY_ALIAS_VISITS_PER_TARGET) continue;
          directoryAliasVisits.set(directoryRealPath, visits + 1);
        }
        pendingDirectories.push({
          absolutePath: directoryRealPath,
          relativePath,
          parent: pendingDirectory,
        });
      }
    }

    return { entries, truncated: false, gitPaths };
  });
});

export const walkWorkspaceDirectory = Effect.fn("WorkspaceDirectoryWalk.walkWorkspaceDirectory")(
  function* (cwd: string, options?: WorkspaceDirectoryWalkOptions) {
    const { entries, truncated } = yield* walkDirectory(cwd, options);
    return { entries, truncated };
  },
);

export class WorkspaceDirectoryWalk extends Context.Service<
  WorkspaceDirectoryWalk,
  {
    readonly list: (cwd: string) => Effect.Effect<ProjectListEntriesResult>;
    readonly invalidate: (cwd: string) => Effect.Effect<void>;
  }
>()("aqqua/workspace/WorkspaceDirectoryWalk") {}

export const make = Effect.gen(function* () {
  const listUncached = Effect.fn("WorkspaceDirectoryWalk.listUncached")(function* (cwd: string) {
    const result = yield* walkDirectory(cwd);
    const ignoredPaths = yield* GitVcsDriver.findIgnoredPaths(cwd, [
      ...new Set(result.entries.map((entry) => result.gitPaths.get(entry.path) ?? entry.path)),
    ]).pipe(
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
        ignored: ignoredPaths.has(result.gitPaths.get(entry.path) ?? entry.path),
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
