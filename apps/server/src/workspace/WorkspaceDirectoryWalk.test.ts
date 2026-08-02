// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { walkWorkspaceDirectory } from "./WorkspaceDirectoryWalk.ts";

const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({
    prefix: "aqqua-workspace-directory-walk-",
  });
});

const writeFile = (cwd: string, relativePath: string) =>
  Effect.promise(async () => {
    const absolutePath = `${cwd}/${relativePath}`;
    await NodeFSP.mkdir(absolutePath.slice(0, absolutePath.lastIndexOf("/")), {
      recursive: true,
    });
    await NodeFSP.writeFile(absolutePath, "");
  });

it.layer(NodeServices.layer, { excludeTestServices: true })("walkWorkspaceDirectory", (it) => {
  describe("bounded breadth-first walk", () => {
    it.effect("skips only .git and node_modules", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir;
        yield* writeFile(cwd, ".git/HEAD");
        yield* writeFile(cwd, "node_modules/pkg/index.js");
        yield* writeFile(cwd, ".cache/value");
        yield* writeFile(cwd, "__pycache__/module.pyc");
        yield* writeFile(cwd, "src/index.ts");

        const result = yield* walkWorkspaceDirectory(cwd);
        const paths = result.entries.map((entry) => entry.path);

        expect(paths.some((path) => path.startsWith(".git"))).toBe(false);
        expect(paths.some((path) => path.startsWith("node_modules"))).toBe(false);
        expect(paths).toContain(".cache/value");
        expect(paths).toContain("__pycache__/module.pyc");
        expect(paths).toContain("src/index.ts");
      }),
    );

    it.effect("lists but does not descend into a symlinked directory cycle", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir;
        yield* writeFile(cwd, "src/index.ts");
        yield* Effect.promise(() => NodeFSP.symlink(cwd, `${cwd}/src/cycle`, "dir"));
        yield* Effect.promise(() =>
          NodeFSP.symlink(`${cwd}/src/index.ts`, `${cwd}/linked-index.ts`, "file"),
        );

        const result = yield* walkWorkspaceDirectory(cwd);

        expect(result.entries).toContainEqual({
          path: "linked-index.ts",
          kind: "file",
        });
        expect(result.entries).toContainEqual({
          path: "src/cycle",
          kind: "directory",
        });
        expect(result.entries.filter((entry) => entry.path.includes("cycle"))).toHaveLength(1);
        expect(result.truncated).toBe(false);
      }),
    );

    it.effect("sets truncated when the entry cap cuts the walk short", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir;
        yield* writeFile(cwd, "a/deep/file.txt");
        yield* writeFile(cwd, "b.txt");
        yield* writeFile(cwd, "c.txt");

        const result = yield* walkWorkspaceDirectory(cwd, { maxEntries: 3 });

        expect(result.entries).toEqual([
          { path: "a", kind: "directory" },
          { path: "b.txt", kind: "file" },
          { path: "c.txt", kind: "file" },
        ]);
        expect(result.truncated).toBe(true);
      }),
    );

    it.effect("sets truncated when the wall-clock budget is exhausted", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir;
        yield* writeFile(cwd, "file.txt");

        const result = yield* walkWorkspaceDirectory(cwd, { timeBudgetMs: 0 });

        expect(result.entries).toEqual([]);
        expect(result.truncated).toBe(true);
      }),
    );
  });
});
