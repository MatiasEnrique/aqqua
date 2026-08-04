// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as WorkspaceEntries from "./WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "./WorkspaceFileSystem.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";

const ProjectLayer = WorkspaceFileSystem.layer.pipe(
  Layer.provide(WorkspacePaths.layer),
  Layer.provide(WorkspaceEntries.layer.pipe(Layer.provide(WorkspacePaths.layer))),
);

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(ProjectLayer),
  Layer.provideMerge(WorkspaceEntries.layer.pipe(Layer.provide(WorkspacePaths.layer))),
  Layer.provideMerge(WorkspacePaths.layer),
  Layer.provideMerge(VcsDriverRegistry.layer.pipe(Layer.provide(VcsProcess.layer))),
  Layer.provide(
    ServerConfig.ServerConfig.layerTest(process.cwd(), {
      prefix: "aqqua-workspace-files-test-",
    }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({
    prefix: "aqqua-workspace-files-",
  });
});

const writeTextFile = Effect.fn("writeTextFile")(function* (
  cwd: string,
  relativePath: string,
  contents = "",
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolutePath = path.join(cwd, relativePath);
  yield* fileSystem
    .makeDirectory(path.dirname(absolutePath), { recursive: true })
    .pipe(Effect.orDie);
  yield* fileSystem.writeFileString(absolutePath, contents).pipe(Effect.orDie);
});

it.layer(TestLayer, { excludeTestServices: true })("WorkspaceFileSystemLive", (it) => {
  describe("readFile", () => {
    it.effect("reads UTF-8 files relative to the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/index.ts", "export const answer = 42;\n");

        const result = yield* workspaceFileSystem.readFile({
          cwd,
          relativePath: "src/index.ts",
        });

        expect(result).toEqual({
          relativePath: "src/index.ts",
          contents: "export const answer = 42;\n",
          byteLength: 26,
          truncated: false,
        });
      }),
    );

    it.effect("rejects reads outside the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const cwd = yield* makeTempDir;

        const error = yield* workspaceFileSystem
          .readFile({ cwd, relativePath: "../escape.md" })
          .pipe(Effect.flip);

        expect(error.message).toContain(
          "Workspace file path must be relative to the project root: ../escape.md",
        );
      }),
    );

    it.effect("rejects symlinks that resolve outside the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const outsideDir = yield* makeTempDir;
        yield* writeTextFile(outsideDir, "secret.txt", "outside\n");
        yield* fileSystem.symlink(
          path.join(outsideDir, "secret.txt"),
          path.join(cwd, "linked-secret.txt"),
        );

        const error = yield* workspaceFileSystem
          .readFile({ cwd, relativePath: "linked-secret.txt" })
          .pipe(Effect.flip);
        const resolvedWorkspaceRoot = yield* fileSystem.realPath(cwd);
        const resolvedPath = yield* fileSystem.realPath(path.join(outsideDir, "secret.txt"));

        expect(error).toBeInstanceOf(WorkspaceFileSystem.WorkspaceFilePathEscapeError);
        expect(error).toMatchObject({
          workspaceRoot: cwd,
          relativePath: "linked-secret.txt",
          resolvedWorkspaceRoot,
          resolvedPath,
        });
        expect("cause" in error).toBe(false);
      }),
    );

    it.effect("rejects directories without manufacturing an I/O cause", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* fileSystem.makeDirectory(path.join(cwd, "src"));

        const error = yield* workspaceFileSystem
          .readFile({ cwd, relativePath: "src" })
          .pipe(Effect.flip);
        const resolvedPath = yield* fileSystem.realPath(path.join(cwd, "src"));

        expect(error).toBeInstanceOf(WorkspaceFileSystem.WorkspacePathNotFileError);
        expect(error).toMatchObject({
          workspaceRoot: cwd,
          relativePath: "src",
          resolvedPath,
        });
        expect("cause" in error).toBe(false);
      }),
    );

    it.effect("rejects binary files without leaking their contents into the error", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const absolutePath = path.join(cwd, "asset.bin");
        yield* fileSystem.writeFile(absolutePath, Uint8Array.from([0x61, 0, 0x62]));

        const error = yield* workspaceFileSystem
          .readFile({ cwd, relativePath: "asset.bin" })
          .pipe(Effect.flip);
        const resolvedPath = yield* fileSystem.realPath(absolutePath);

        expect(error).toBeInstanceOf(WorkspaceFileSystem.WorkspaceBinaryFileError);
        expect(error).toMatchObject({
          workspaceRoot: cwd,
          relativePath: "asset.bin",
          resolvedPath,
        });
        expect("cause" in error).toBe(false);
        expect("contents" in error).toBe(false);
      }),
    );

    it.effect("preserves the real cause and path for I/O failures", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const resolvedPath = path.join(cwd, "missing.txt");

        const error = yield* workspaceFileSystem
          .readFile({ cwd, relativePath: "missing.txt" })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(WorkspaceFileSystem.WorkspaceFileSystemOperationError);
        expect(error).toMatchObject({
          workspaceRoot: cwd,
          relativePath: "missing.txt",
          resolvedPath,
          operationPath: resolvedPath,
          operation: "realpath-target",
        });
        expect(error.cause).toBeInstanceOf(Error);
        expect((error.cause as NodeJS.ErrnoException).code).toBe("ENOENT");
      }),
    );
  });

  describe("writeFile", () => {
    it.effect("writes files relative to the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const result = yield* workspaceFileSystem.writeFile({
          cwd,
          relativePath: "plans/effect-rpc.md",
          contents: "# Plan\n",
        });
        const saved = yield* fileSystem
          .readFileString(path.join(cwd, "plans/effect-rpc.md"))
          .pipe(Effect.orDie);

        expect(result).toEqual({ relativePath: "plans/effect-rpc.md" });
        expect(saved).toBe("# Plan\n");
      }),
    );

    it.effect("invalidates workspace entry search cache after writes", () =>
      Effect.gen(function* () {
        const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/existing.ts", "export {};\n");

        const beforeWrite = yield* workspaceEntries.list({ cwd });
        expect(beforeWrite.entries.some((entry) => entry.path === "plans/effect-rpc.md")).toBe(
          false,
        );

        yield* workspaceFileSystem.writeFile({
          cwd,
          relativePath: "plans/effect-rpc.md",
          contents: "# Plan\n",
        });

        const afterWrite = yield* workspaceEntries.list({ cwd });
        expect(afterWrite.entries).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: "plans/effect-rpc.md" })]),
        );
        expect(afterWrite.truncated).toBe(false);
      }),
    );

    it.effect("rejects writes outside the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const path = yield* Path.Path;
        const fileSystem = yield* FileSystem.FileSystem;

        const error = yield* workspaceFileSystem
          .writeFile({
            cwd,
            relativePath: "../escape.md",
            contents: "# nope\n",
          })
          .pipe(Effect.flip);

        expect(error.message).toContain(
          "Workspace file path must be relative to the project root: ../escape.md",
        );

        const escapedPath = path.resolve(cwd, "..", "escape.md");
        const escapedStat = yield* fileSystem
          .stat(escapedPath)
          .pipe(Effect.orElseSucceed(() => null));
        expect(escapedStat).toBeNull();
      }),
    );

    it.effect("rejects a symlinked file without changing its outside target", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const outsideDir = yield* makeTempDir;
        yield* writeTextFile(outsideDir, "outside.md", "keep outside\n");
        yield* fileSystem.symlink(path.join(outsideDir, "outside.md"), path.join(cwd, "linked.md"));

        const error = yield* workspaceFileSystem
          .writeFile({ cwd, relativePath: "linked.md", contents: "escape\n" })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(WorkspaceFileSystem.WorkspaceFilePathEscapeError);
        expect(
          yield* fileSystem.readFileString(path.join(outsideDir, "outside.md")).pipe(Effect.orDie),
        ).toBe("keep outside\n");
      }),
    );

    it.effect("rejects a symlinked parent without creating an outside file", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const outsideDir = yield* makeTempDir;
        yield* fileSystem.symlink(outsideDir, path.join(cwd, "linked-dir"));

        const error = yield* workspaceFileSystem
          .writeFile({ cwd, relativePath: "linked-dir/escape.md", contents: "escape\n" })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(WorkspaceFileSystem.WorkspaceFilePathEscapeError);
        expect(
          yield* fileSystem
            .stat(path.join(outsideDir, "escape.md"))
            .pipe(Effect.orElseSucceed(() => null)),
        ).toBeNull();
      }),
    );
  });

  describe("createEntry", () => {
    it.effect("creates an empty file and refreshes workspace entries", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const beforeCreate = yield* workspaceEntries.list({ cwd });
        expect(beforeCreate.entries.some((entry) => entry.path === "notes/todo.md")).toBe(false);

        const result = yield* workspaceFileSystem.createEntry({
          cwd,
          relativePath: "notes/todo.md",
          kind: "file",
        });
        const contents = yield* fileSystem
          .readFileString(path.join(cwd, "notes/todo.md"))
          .pipe(Effect.orDie);

        expect(result).toEqual({ relativePath: "notes/todo.md", kind: "file" });
        expect(contents).toBe("");
        const afterCreate = yield* workspaceEntries.list({ cwd });
        expect(afterCreate.entries).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: "notes/todo.md", kind: "file" }),
          ]),
        );
      }),
    );

    it.effect("creates nested folders", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;

        const result = yield* workspaceFileSystem.createEntry({
          cwd,
          relativePath: "docs/guides/setup",
          kind: "directory",
        });
        const stat = yield* fileSystem.stat(path.join(cwd, "docs/guides/setup")).pipe(Effect.orDie);

        expect(result).toEqual({
          relativePath: "docs/guides/setup",
          kind: "directory",
        });
        expect(stat.type).toBe("Directory");
      }),
    );

    it.effect("rejects collisions without changing the existing entry", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "notes.md", "keep me\n");

        const error = yield* workspaceFileSystem
          .createEntry({ cwd, relativePath: "notes.md", kind: "file" })
          .pipe(Effect.flip);
        const contents = yield* fileSystem
          .readFileString(path.join(cwd, "notes.md"))
          .pipe(Effect.orDie);

        expect(error).toBeInstanceOf(WorkspaceFileSystem.WorkspaceEntryCollisionError);
        expect(contents).toBe("keep me\n");
      }),
    );

    it.effect("rejects traversal and symlink escapes before creating anything", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const outsideDir = yield* makeTempDir;

        const traversalError = yield* workspaceFileSystem
          .createEntry({ cwd, relativePath: "../escape.md", kind: "file" })
          .pipe(Effect.flip);
        expect(traversalError).toBeInstanceOf(WorkspacePaths.WorkspacePathOutsideRootError);

        yield* fileSystem.symlink(outsideDir, path.join(cwd, "outside-link"));
        const symlinkError = yield* workspaceFileSystem
          .createEntry({
            cwd,
            relativePath: "outside-link/escape.md",
            kind: "file",
          })
          .pipe(Effect.flip);

        expect(symlinkError).toBeInstanceOf(WorkspaceFileSystem.WorkspaceFilePathEscapeError);
        const outsideStat = yield* fileSystem
          .stat(path.join(outsideDir, "escape.md"))
          .pipe(Effect.orElseSucceed(() => null));
        expect(outsideStat).toBeNull();
      }),
    );
  });

  describe("moveEntry", () => {
    it.effect("renames an entry and refreshes workspace entries", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "before.md", "contents\n");
        yield* workspaceEntries.list({ cwd });

        const sourceStat = yield* fileSystem.stat(path.join(cwd, "before.md")).pipe(Effect.orDie);
        const result = yield* workspaceFileSystem.moveEntry({
          cwd,
          sourcePath: "before.md",
          destinationPath: "after.md",
        });

        expect(result).toEqual({
          sourcePath: "before.md",
          destinationPath: "after.md",
        });
        const contents = yield* fileSystem
          .readFileString(path.join(cwd, "after.md"))
          .pipe(Effect.orDie);
        expect(contents).toBe("contents\n");
        const destinationStat = yield* fileSystem
          .stat(path.join(cwd, "after.md"))
          .pipe(Effect.orDie);
        expect(destinationStat.ino).toEqual(sourceStat.ino);
        const afterMove = yield* workspaceEntries.list({ cwd });
        expect(afterMove.entries.some((entry) => entry.path === "before.md")).toBe(false);
        expect(afterMove.entries).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: "after.md", kind: "file" })]),
        );
      }),
    );

    it.effect("renames directories with their contents", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "before/nested.md", "contents\n");

        yield* workspaceFileSystem.moveEntry({
          cwd,
          sourcePath: "before",
          destinationPath: "after",
        });

        expect(
          yield* fileSystem.readFileString(path.join(cwd, "after/nested.md")).pipe(Effect.orDie),
        ).toBe("contents\n");
        const oldDirectory = yield* fileSystem
          .stat(path.join(cwd, "before"))
          .pipe(Effect.orElseSucceed(() => null));
        expect(oldDirectory).toBeNull();
      }),
    );

    it.effect("renames an in-workspace symlink without moving its target", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "target.md", "target contents\n");
        yield* fileSystem.symlink("target.md", path.join(cwd, "before.md"));

        yield* workspaceFileSystem.moveEntry({
          cwd,
          sourcePath: "before.md",
          destinationPath: "after.md",
        });

        expect(
          (yield* Effect.promise(() => NodeFSP.lstat(path.join(cwd, "after.md")))).isSymbolicLink(),
        ).toBe(true);
        expect(
          yield* fileSystem.readFileString(path.join(cwd, "target.md")).pipe(Effect.orDie),
        ).toBe("target contents\n");
      }),
    );

    it.effect("publishes an EXDEV fallback only after the copy is complete", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const sourcePath = path.join(cwd, "source.md");
        const destinationPath = path.join(cwd, "destination.md");
        yield* writeTextFile(cwd, "source.md", "contents\n");
        let renameCalls = 0;

        yield* Effect.promise(() =>
          WorkspaceFileSystem.moveWorkspaceEntryOnDisk(
            {
              sourcePath,
              destinationPath,
              recursive: false,
              stagingSuffix: "fallback-test",
            },
            {
              rename: async (from, to) => {
                renameCalls += 1;
                if (renameCalls === 1) {
                  throw Object.assign(new Error("cross-device move"), { code: "EXDEV" });
                }
                await NodeFSP.rename(from, to);
              },
              cp: NodeFSP.cp,
              rm: NodeFSP.rm,
              lstat: NodeFSP.lstat,
            },
          ),
        );

        expect(renameCalls).toBe(2);
        expect(yield* fileSystem.readFileString(destinationPath).pipe(Effect.orDie)).toBe(
          "contents\n",
        );
        expect(
          yield* fileSystem.stat(sourcePath).pipe(Effect.orElseSucceed(() => null)),
        ).toBeNull();
        expect(
          yield* fileSystem
            .stat(`${destinationPath}.aqqua-move-fallback-test`)
            .pipe(Effect.orElseSucceed(() => null)),
        ).toBeNull();
      }),
    );

    it.effect("removes the EXDEV destination when source removal fails", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const sourcePath = path.join(cwd, "source.md");
        const destinationPath = path.join(cwd, "destination.md");
        yield* writeTextFile(cwd, "source.md", "keep source\n");
        let renameCalls = 0;

        const result = yield* Effect.promise(() =>
          WorkspaceFileSystem.moveWorkspaceEntryOnDisk(
            {
              sourcePath,
              destinationPath,
              recursive: false,
              stagingSuffix: "rollback-test",
            },
            {
              rename: async (from, to) => {
                renameCalls += 1;
                if (renameCalls === 1) {
                  throw Object.assign(new Error("cross-device move"), { code: "EXDEV" });
                }
                await NodeFSP.rename(from, to);
              },
              cp: NodeFSP.cp,
              rm: async (target, options) => {
                if (target === sourcePath) {
                  throw Object.assign(new Error("source is busy"), { code: "EBUSY" });
                }
                await NodeFSP.rm(target, options);
              },
              lstat: NodeFSP.lstat,
            },
          ).then(
            () => ({ ok: true as const }),
            (error: unknown) => ({ ok: false as const, error }),
          ),
        );

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect((result.error as NodeJS.ErrnoException).code).toBe("EBUSY");
        expect(yield* fileSystem.readFileString(sourcePath).pipe(Effect.orDie)).toBe(
          "keep source\n",
        );
        expect(
          yield* fileSystem.stat(destinationPath).pipe(Effect.orElseSucceed(() => null)),
        ).toBeNull();
      }),
    );

    it.effect("rejects destination collisions without overwriting either file", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "source.md", "source\n");
        yield* writeTextFile(cwd, "destination.md", "destination\n");

        const error = yield* workspaceFileSystem
          .moveEntry({
            cwd,
            sourcePath: "source.md",
            destinationPath: "destination.md",
          })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(WorkspaceFileSystem.WorkspaceEntryCollisionError);
        expect(
          yield* fileSystem.readFileString(path.join(cwd, "source.md")).pipe(Effect.orDie),
        ).toBe("source\n");
        expect(
          yield* fileSystem.readFileString(path.join(cwd, "destination.md")).pipe(Effect.orDie),
        ).toBe("destination\n");
      }),
    );

    it.effect("rejects traversal and symlink escapes", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const outsideDir = yield* makeTempDir;
        yield* writeTextFile(cwd, "source.md", "inside\n");

        const traversalError = yield* workspaceFileSystem
          .moveEntry({
            cwd,
            sourcePath: "source.md",
            destinationPath: "../escape.md",
          })
          .pipe(Effect.flip);
        expect(traversalError).toBeInstanceOf(WorkspacePaths.WorkspacePathOutsideRootError);

        yield* fileSystem.symlink(outsideDir, path.join(cwd, "outside-link"));
        const symlinkError = yield* workspaceFileSystem
          .moveEntry({
            cwd,
            sourcePath: "source.md",
            destinationPath: "outside-link/escape.md",
          })
          .pipe(Effect.flip);
        expect(symlinkError).toBeInstanceOf(WorkspaceFileSystem.WorkspaceFilePathEscapeError);
      }),
    );
  });

  describe("deleteEntry", () => {
    it.effect("deletes an entry and refreshes workspace entries", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "delete-me.md", "temporary\n");
        yield* workspaceEntries.list({ cwd });

        const result = yield* workspaceFileSystem.deleteEntry({
          cwd,
          relativePath: "delete-me.md",
          recursive: false,
        });

        expect(result).toEqual({ relativePath: "delete-me.md" });
        const stat = yield* fileSystem
          .stat(path.join(cwd, "delete-me.md"))
          .pipe(Effect.orElseSucceed(() => null));
        expect(stat).toBeNull();
        const afterDelete = yield* workspaceEntries.list({ cwd });
        expect(afterDelete.entries.some((entry) => entry.path === "delete-me.md")).toBe(false);
      }),
    );

    it.effect("requires recursive opt-in to delete a non-empty directory", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "folder/kept.md", "keep\n");

        const error = yield* workspaceFileSystem
          .deleteEntry({ cwd, relativePath: "folder", recursive: false })
          .pipe(Effect.flip);
        expect(error).toBeInstanceOf(WorkspaceFileSystem.WorkspaceDirectoryNotEmptyError);

        yield* workspaceFileSystem.deleteEntry({
          cwd,
          relativePath: "folder",
          recursive: true,
        });
        const stat = yield* fileSystem
          .stat(path.join(cwd, "folder"))
          .pipe(Effect.orElseSucceed(() => null));
        expect(stat).toBeNull();
      }),
    );

    it.effect("rejects traversal and symlinks whose realpath escapes the root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const outsideDir = yield* makeTempDir;
        yield* writeTextFile(outsideDir, "keep.md", "outside\n");

        const traversalError = yield* workspaceFileSystem
          .deleteEntry({ cwd, relativePath: "../keep.md", recursive: false })
          .pipe(Effect.flip);
        expect(traversalError).toBeInstanceOf(WorkspacePaths.WorkspacePathOutsideRootError);

        yield* fileSystem.symlink(
          path.join(outsideDir, "keep.md"),
          path.join(cwd, "outside-link.md"),
        );
        const symlinkError = yield* workspaceFileSystem
          .deleteEntry({ cwd, relativePath: "outside-link.md", recursive: false })
          .pipe(Effect.flip);
        expect(symlinkError).toBeInstanceOf(WorkspaceFileSystem.WorkspaceFilePathEscapeError);
        expect(
          yield* fileSystem.readFileString(path.join(outsideDir, "keep.md")).pipe(Effect.orDie),
        ).toBe("outside\n");
      }),
    );
  });
});
