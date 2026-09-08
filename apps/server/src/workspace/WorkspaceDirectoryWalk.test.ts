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
    it.effect("skips repository metadata and dependency caches", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir;
        yield* writeFile(cwd, ".git/HEAD");
        yield* writeFile(cwd, "node_modules/pkg/index.js");
        yield* writeFile(cwd, ".turbo/cache/build.tar.zst");
        yield* writeFile(cwd, ".pnpm-store/v10/index/package.json");
        yield* writeFile(cwd, ".cache/value");
        yield* writeFile(cwd, "__pycache__/module.pyc");
        yield* writeFile(cwd, "src/index.ts");

        const result = yield* walkWorkspaceDirectory(cwd);
        const paths = result.entries.map((entry) => entry.path);

        expect(paths.some((path) => path.startsWith(".git"))).toBe(false);
        expect(paths.some((path) => path.startsWith("node_modules"))).toBe(false);
        expect(paths.some((path) => path.startsWith(".turbo"))).toBe(false);
        expect(paths.some((path) => path.startsWith(".pnpm-store"))).toBe(false);
        expect(paths).toContain(".cache/value");
        expect(paths).toContain("__pycache__/module.pyc");
        expect(paths).toContain("src/index.ts");
      }),
    );

    it.effect("reaches skill files before generated caches exhaust the entry cap", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir;
        yield* writeFile(cwd, ".claude/skills/apple-design/SKILL.md");
        for (let index = 0; index < 12; index += 1) {
          yield* writeFile(cwd, `.turbo/cache/${index}.json`);
          yield* writeFile(cwd, `.pnpm-store/v10/${index}.json`);
        }

        const result = yield* walkWorkspaceDirectory(cwd, { maxEntries: 10 });

        expect(result.entries).toContainEqual({
          path: ".claude/skills/apple-design/SKILL.md",
          kind: "file",
        });
        expect(result.truncated).toBe(false);
      }),
    );

    it.effect("lists skill files through an in-workspace directory symlink", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir;
        yield* writeFile(cwd, ".agents/skills/apple-design/SKILL.md");
        yield* writeFile(cwd, ".agents/skills/apple-design/references/motion.md");
        yield* Effect.promise(async () => {
          await NodeFSP.mkdir(`${cwd}/.claude`);
          await NodeFSP.symlink("../.agents/skills", `${cwd}/.claude/skills`, "dir");
        });

        const result = yield* walkWorkspaceDirectory(cwd);
        const paths = result.entries.map((entry) => entry.path);

        expect(paths).toContain(".agents/skills/apple-design/SKILL.md");
        expect(paths).toContain(".claude/skills/apple-design/SKILL.md");
        expect(paths).toContain(".claude/skills/apple-design/references/motion.md");
        expect(result.truncated).toBe(false);
      }),
    );

    it.effect("does not descend into excluded directories through a symlink alias", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir;
        yield* writeFile(cwd, ".git/objects/secret");
        yield* writeFile(cwd, "node_modules/pkg/index.js");
        yield* Effect.promise(async () => {
          await NodeFSP.symlink(".git", `${cwd}/metadata`, "dir");
          await NodeFSP.symlink("node_modules", `${cwd}/dependencies`, "dir");
        });

        const result = yield* walkWorkspaceDirectory(cwd);
        const paths = result.entries.map((entry) => entry.path);

        expect(paths).toContain("metadata");
        expect(paths).toContain("dependencies");
        expect(paths.some((path) => path.startsWith("metadata/"))).toBe(false);
        expect(paths.some((path) => path.startsWith("dependencies/"))).toBe(false);
        expect(result.truncated).toBe(false);
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

    it.effect("follows sibling aliases without recursing through mutual symlink cycles", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir;
        yield* writeFile(cwd, "a/one.md");
        yield* writeFile(cwd, "b/two.md");
        yield* Effect.promise(async () => {
          await NodeFSP.symlink("../b", `${cwd}/a/link`, "dir");
          await NodeFSP.symlink("../a", `${cwd}/b/link`, "dir");
        });

        const result = yield* walkWorkspaceDirectory(cwd);
        const paths = result.entries.map((entry) => entry.path);

        expect(paths).toContain("a/link/two.md");
        expect(paths).toContain("b/link/one.md");
        expect(paths.filter((path) => path.startsWith("a/link/link"))).toEqual(["a/link/link"]);
        expect(paths.filter((path) => path.startsWith("b/link/link"))).toEqual(["b/link/link"]);
        expect(result.truncated).toBe(false);
      }),
    );

    it.effect("lists external and broken directory links without descending into them", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir;
        // A sibling with the root's name as its prefix must still be outside.
        const outside = `${cwd}-outside`;
        yield* Effect.acquireRelease(
          Effect.promise(() => NodeFSP.mkdir(outside)),
          () => Effect.promise(() => NodeFSP.rm(outside, { recursive: true, force: true })),
        );
        yield* writeFile(outside, "outside.md");
        yield* Effect.promise(async () => {
          await NodeFSP.symlink(outside, `${cwd}/external`, "dir");
          await NodeFSP.symlink(`${cwd}/missing`, `${cwd}/broken`, "dir");
        });

        const result = yield* walkWorkspaceDirectory(cwd);

        expect(result.entries).toEqual([
          { path: "broken", kind: "file" },
          { path: "external", kind: "directory" },
        ]);
        expect(result.truncated).toBe(false);
      }),
    );

    it.effect("resolves links relative to a workspace opened through a symlink", () =>
      Effect.gen(function* () {
        const parent = yield* makeTempDir;
        yield* writeFile(parent, "workspace/skills/SKILL.md");
        yield* Effect.promise(async () => {
          await NodeFSP.symlink("workspace", `${parent}/workspace-link`, "dir");
          await NodeFSP.symlink("skills", `${parent}/workspace/linked-skills`, "dir");
        });

        const result = yield* walkWorkspaceDirectory(`${parent}/workspace-link`);

        expect(result.entries).toContainEqual({ path: "linked-skills/SKILL.md", kind: "file" });
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
