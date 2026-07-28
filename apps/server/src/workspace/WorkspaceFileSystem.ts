// @effect-diagnostics nodeBuiltinImport:off
/**
 * WorkspaceFileSystem - Effect service contract for workspace file mutations.
 *
 * Owns workspace-root-relative file read/write operations and their associated
 * safety checks and cache invalidation hooks.
 *
 * @module WorkspaceFileSystem
 */
import * as NodeFSP from "node:fs/promises";

import type {
  ProjectCreateEntryInput,
  ProjectCreateEntryResult,
  ProjectDeleteEntryInput,
  ProjectDeleteEntryResult,
  ProjectMoveEntryInput,
  ProjectMoveEntryResult,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as WorkspaceEntries from "./WorkspaceEntries.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";

const PROJECT_READ_FILE_MAX_BYTES = 1024 * 1024;

type WorkspaceEntryMutationOperation =
  | "realpath-workspace-root"
  | "realpath-target"
  | "realpath-existing-ancestor"
  | "make-directory"
  | "create-file"
  | "rename"
  | "stat"
  | "remove";

export class WorkspaceFileSystemOperationError extends Schema.TaggedErrorClass<WorkspaceFileSystemOperationError>()(
  "WorkspaceFileSystemOperationError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedPath: Schema.String,
    operationPath: Schema.String,
    operation: Schema.Literals([
      "realpath-workspace-root",
      "realpath-target",
      "open",
      "stat",
      "read",
      "close",
      "make-directory",
      "write-file",
      "realpath-existing-ancestor",
      "create-file",
      "rename",
      "remove",
    ]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Workspace file operation '${this.operation}' failed at '${this.operationPath}' for resolved path '${this.resolvedPath}' (requested as '${this.relativePath}' in '${this.workspaceRoot}').`;
  }
}

export class WorkspaceFilePathEscapeError extends Schema.TaggedErrorClass<WorkspaceFilePathEscapeError>()(
  "WorkspaceFilePathEscapeError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedWorkspaceRoot: Schema.String,
    resolvedPath: Schema.String,
  },
) {
  override get message(): string {
    return `Workspace file '${this.relativePath}' resolves outside workspace root '${this.workspaceRoot}': ${this.resolvedPath}`;
  }
}

export class WorkspacePathNotFileError extends Schema.TaggedErrorClass<WorkspacePathNotFileError>()(
  "WorkspacePathNotFileError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedPath: Schema.String,
  },
) {
  override get message(): string {
    return `Workspace path '${this.relativePath}' in '${this.workspaceRoot}' is not a file: ${this.resolvedPath}`;
  }
}

export class WorkspaceBinaryFileError extends Schema.TaggedErrorClass<WorkspaceBinaryFileError>()(
  "WorkspaceBinaryFileError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedPath: Schema.String,
  },
) {
  override get message(): string {
    return `Workspace file '${this.relativePath}' in '${this.workspaceRoot}' is binary and cannot be previewed as text.`;
  }
}

export class WorkspaceEntryCollisionError extends Schema.TaggedErrorClass<WorkspaceEntryCollisionError>()(
  "WorkspaceEntryCollisionError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedPath: Schema.String,
  },
) {
  override get message(): string {
    return `Workspace entry already exists at '${this.relativePath}' in '${this.workspaceRoot}'.`;
  }
}

export class WorkspaceDirectoryNotEmptyError extends Schema.TaggedErrorClass<WorkspaceDirectoryNotEmptyError>()(
  "WorkspaceDirectoryNotEmptyError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedPath: Schema.String,
  },
) {
  override get message(): string {
    return `Workspace directory '${this.relativePath}' in '${this.workspaceRoot}' is not empty.`;
  }
}

export const WorkspaceFileSystemError = Schema.Union([
  WorkspaceFileSystemOperationError,
  WorkspaceFilePathEscapeError,
  WorkspacePathNotFileError,
  WorkspaceBinaryFileError,
]);
export type WorkspaceFileSystemError = typeof WorkspaceFileSystemError.Type;

export const WorkspaceEntryMutationError = Schema.Union([
  WorkspaceFileSystemOperationError,
  WorkspaceFilePathEscapeError,
  WorkspaceEntryCollisionError,
  WorkspaceDirectoryNotEmptyError,
]);
export type WorkspaceEntryMutationError = typeof WorkspaceEntryMutationError.Type;

/** Service tag for workspace file operations. */
export class WorkspaceFileSystem extends Context.Service<
  WorkspaceFileSystem,
  {
    /** Read a UTF-8 text file relative to the workspace root. */
    readonly readFile: (
      input: ProjectReadFileInput,
    ) => Effect.Effect<
      ProjectReadFileResult,
      WorkspaceFileSystemError | WorkspacePaths.WorkspacePathOutsideRootError
    >;
    /**
     * Write a file relative to the workspace root.
     *
     * Creates parent directories as needed and rejects paths that escape the
     * workspace root.
     */
    readonly writeFile: (
      input: ProjectWriteFileInput,
    ) => Effect.Effect<
      ProjectWriteFileResult,
      WorkspaceFileSystemError | WorkspacePaths.WorkspacePathOutsideRootError
    >;
    /** Create an empty file or directory without replacing an existing entry. */
    readonly createEntry: (
      input: ProjectCreateEntryInput,
    ) => Effect.Effect<
      ProjectCreateEntryResult,
      WorkspaceEntryMutationError | WorkspacePaths.WorkspacePathOutsideRootError
    >;
    /** Move or rename an entry without replacing an existing destination. */
    readonly moveEntry: (
      input: ProjectMoveEntryInput,
    ) => Effect.Effect<
      ProjectMoveEntryResult,
      WorkspaceEntryMutationError | WorkspacePaths.WorkspacePathOutsideRootError
    >;
    /** Permanently delete an entry, requiring recursive opt-in for non-empty directories. */
    readonly deleteEntry: (
      input: ProjectDeleteEntryInput,
    ) => Effect.Effect<
      ProjectDeleteEntryResult,
      WorkspaceEntryMutationError | WorkspacePaths.WorkspacePathOutsideRootError
    >;
  }
>()("t3/workspace/WorkspaceFileSystem") {}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;

  const isOutsideRoot = (root: string, candidate: string): boolean => {
    const relativePath = path.relative(root, candidate);
    return (
      relativePath.startsWith(`..${path.sep}`) ||
      relativePath === ".." ||
      path.isAbsolute(relativePath)
    );
  };

  const operationError = (input: {
    readonly workspaceRoot: string;
    readonly relativePath: string;
    readonly resolvedPath: string;
    readonly operationPath: string;
    readonly operation: WorkspaceEntryMutationOperation;
    readonly cause: unknown;
  }) =>
    new WorkspaceFileSystemOperationError({
      ...input,
      operation: input.operation as WorkspaceFileSystemOperationError["operation"],
    });

  const assertRealPathWithinRoot = Effect.fn("WorkspaceFileSystem.assertRealPathWithinRoot")(
    function* (input: {
      readonly workspaceRoot: string;
      readonly relativePath: string;
      readonly resolvedWorkspaceRoot: string;
      readonly resolvedPath: string;
    }) {
      if (isOutsideRoot(input.resolvedWorkspaceRoot, input.resolvedPath)) {
        return yield* new WorkspaceFilePathEscapeError(input);
      }
      return input.resolvedPath;
    },
  );

  const realWorkspaceRoot = Effect.fn("WorkspaceFileSystem.realWorkspaceRoot")(function* (input: {
    readonly workspaceRoot: string;
    readonly relativePath: string;
    readonly resolvedPath: string;
  }) {
    return yield* Effect.tryPromise({
      try: () => NodeFSP.realpath(input.workspaceRoot),
      catch: (cause) =>
        operationError({
          ...input,
          operationPath: input.workspaceRoot,
          operation: "realpath-workspace-root",
          cause,
        }),
    });
  });

  const realExistingTargetWithinRoot = Effect.fn(
    "WorkspaceFileSystem.realExistingTargetWithinRoot",
  )(function* (input: {
    readonly workspaceRoot: string;
    readonly relativePath: string;
    readonly absolutePath: string;
  }) {
    const resolvedWorkspaceRoot = yield* realWorkspaceRoot({
      workspaceRoot: input.workspaceRoot,
      relativePath: input.relativePath,
      resolvedPath: input.absolutePath,
    });
    const resolvedPath = yield* Effect.tryPromise({
      try: () => NodeFSP.realpath(input.absolutePath),
      catch: (cause) =>
        operationError({
          workspaceRoot: input.workspaceRoot,
          relativePath: input.relativePath,
          resolvedPath: input.absolutePath,
          operationPath: input.absolutePath,
          operation: "realpath-target",
          cause,
        }),
    });
    return yield* assertRealPathWithinRoot({
      workspaceRoot: input.workspaceRoot,
      relativePath: input.relativePath,
      resolvedWorkspaceRoot,
      resolvedPath,
    });
  });

  const mutationTargetWithinRoot = Effect.fn("WorkspaceFileSystem.mutationTargetWithinRoot")(
    function* (input: {
      readonly workspaceRoot: string;
      readonly relativePath: string;
      readonly absolutePath: string;
    }) {
      const resolvedWorkspaceRoot = yield* realWorkspaceRoot({
        workspaceRoot: input.workspaceRoot,
        relativePath: input.relativePath,
        resolvedPath: input.absolutePath,
      });
      let existingAncestor = input.absolutePath;
      const missingSegments: string[] = [];
      let resolvedExistingAncestor: string;
      while (true) {
        const attempt = yield* Effect.promise(() =>
          NodeFSP.realpath(existingAncestor).then(
            (value) => ({ ok: true as const, value }),
            (cause: unknown) => ({ ok: false as const, cause }),
          ),
        );
        if (attempt.ok) {
          resolvedExistingAncestor = attempt.value;
          break;
        }
        if ((attempt.cause as NodeJS.ErrnoException).code !== "ENOENT") {
          return yield* operationError({
            workspaceRoot: input.workspaceRoot,
            relativePath: input.relativePath,
            resolvedPath: input.absolutePath,
            operationPath: existingAncestor,
            operation: "realpath-existing-ancestor",
            cause: attempt.cause,
          });
        }
        const parent = path.dirname(existingAncestor);
        if (parent === existingAncestor) {
          return yield* operationError({
            workspaceRoot: input.workspaceRoot,
            relativePath: input.relativePath,
            resolvedPath: input.absolutePath,
            operationPath: existingAncestor,
            operation: "realpath-existing-ancestor",
            cause: attempt.cause,
          });
        }
        missingSegments.unshift(path.basename(existingAncestor));
        existingAncestor = parent;
      }
      yield* assertRealPathWithinRoot({
        workspaceRoot: input.workspaceRoot,
        relativePath: input.relativePath,
        resolvedWorkspaceRoot,
        resolvedPath: resolvedExistingAncestor,
      });
      return {
        resolvedWorkspaceRoot,
        resolvedPath: path.join(resolvedExistingAncestor, ...missingSegments),
        exists: missingSegments.length === 0,
      };
    },
  );

  const readFile: WorkspaceFileSystem["Service"]["readFile"] = Effect.fn(
    "WorkspaceFileSystem.readFile",
  )(function* (input) {
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });

    const realWorkspaceRoot = yield* Effect.tryPromise({
      try: () => NodeFSP.realpath(input.cwd),
      catch: (cause) =>
        new WorkspaceFileSystemOperationError({
          workspaceRoot: input.cwd,
          relativePath: input.relativePath,
          resolvedPath: target.absolutePath,
          operationPath: input.cwd,
          operation: "realpath-workspace-root",
          cause,
        }),
    });
    const realTargetPath = yield* Effect.tryPromise({
      try: () => NodeFSP.realpath(target.absolutePath),
      catch: (cause) =>
        new WorkspaceFileSystemOperationError({
          workspaceRoot: input.cwd,
          relativePath: input.relativePath,
          resolvedPath: target.absolutePath,
          operationPath: target.absolutePath,
          operation: "realpath-target",
          cause,
        }),
    });
    if (isOutsideRoot(realWorkspaceRoot, realTargetPath)) {
      return yield* new WorkspaceFilePathEscapeError({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
        resolvedWorkspaceRoot: realWorkspaceRoot,
        resolvedPath: realTargetPath,
      });
    }

    return yield* Effect.acquireUseRelease(
      Effect.tryPromise({
        try: () => NodeFSP.open(realTargetPath, "r"),
        catch: (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: realTargetPath,
            operationPath: realTargetPath,
            operation: "open",
            cause,
          }),
      }),
      (handle) =>
        Effect.gen(function* () {
          const stat = yield* Effect.tryPromise({
            try: () => handle.stat(),
            catch: (cause) =>
              new WorkspaceFileSystemOperationError({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                resolvedPath: realTargetPath,
                operationPath: realTargetPath,
                operation: "stat",
                cause,
              }),
          });
          if (!stat.isFile()) {
            return yield* new WorkspacePathNotFileError({
              workspaceRoot: input.cwd,
              relativePath: input.relativePath,
              resolvedPath: realTargetPath,
            });
          }

          const bytesToRead = Math.min(stat.size, PROJECT_READ_FILE_MAX_BYTES);
          const buffer = Buffer.alloc(bytesToRead);
          const { bytesRead } = yield* Effect.tryPromise({
            try: () => handle.read(buffer, 0, bytesToRead, 0),
            catch: (cause) =>
              new WorkspaceFileSystemOperationError({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                resolvedPath: realTargetPath,
                operationPath: realTargetPath,
                operation: "read",
                cause,
              }),
          });
          const fileBytes = buffer.subarray(0, bytesRead);
          if (fileBytes.includes(0)) {
            return yield* new WorkspaceBinaryFileError({
              workspaceRoot: input.cwd,
              relativePath: input.relativePath,
              resolvedPath: realTargetPath,
            });
          }

          return {
            relativePath: target.relativePath,
            contents: new TextDecoder("utf-8").decode(fileBytes),
            byteLength: stat.size,
            truncated: stat.size > PROJECT_READ_FILE_MAX_BYTES,
          };
        }),
      (handle) =>
        Effect.tryPromise({
          try: () => handle.close(),
          catch: (cause) =>
            new WorkspaceFileSystemOperationError({
              workspaceRoot: input.cwd,
              relativePath: input.relativePath,
              resolvedPath: realTargetPath,
              operationPath: realTargetPath,
              operation: "close",
              cause,
            }),
        }),
    );
  });

  const writeFile: WorkspaceFileSystem["Service"]["writeFile"] = Effect.fn(
    "WorkspaceFileSystem.writeFile",
  )(function* (input) {
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });

    yield* fileSystem.makeDirectory(path.dirname(target.absolutePath), { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: target.absolutePath,
            operationPath: path.dirname(target.absolutePath),
            operation: "make-directory",
            cause,
          }),
      ),
    );
    yield* fileSystem.writeFileString(target.absolutePath, input.contents).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: target.absolutePath,
            operationPath: target.absolutePath,
            operation: "write-file",
            cause,
          }),
      ),
    );
    yield* workspaceEntries.refresh(input.cwd);
    return { relativePath: target.relativePath };
  });

  const createEntry: WorkspaceFileSystem["Service"]["createEntry"] = Effect.fn(
    "WorkspaceFileSystem.createEntry",
  )(function* (input) {
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });
    const mutationTarget = yield* mutationTargetWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
      absolutePath: target.absolutePath,
    });
    if (mutationTarget.exists) {
      return yield* new WorkspaceEntryCollisionError({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
        resolvedPath: mutationTarget.resolvedPath,
      });
    }

    yield* Effect.tryPromise({
      try: () => NodeFSP.mkdir(path.dirname(mutationTarget.resolvedPath), { recursive: true }),
      catch: (cause) =>
        operationError({
          workspaceRoot: input.cwd,
          relativePath: input.relativePath,
          resolvedPath: mutationTarget.resolvedPath,
          operationPath: path.dirname(mutationTarget.resolvedPath),
          operation: "make-directory",
          cause,
        }),
    });
    if (input.kind === "directory") {
      yield* Effect.tryPromise({
        try: () => NodeFSP.mkdir(mutationTarget.resolvedPath),
        catch: (cause) =>
          (cause as NodeJS.ErrnoException).code === "EEXIST"
            ? new WorkspaceEntryCollisionError({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                resolvedPath: mutationTarget.resolvedPath,
              })
            : operationError({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                resolvedPath: mutationTarget.resolvedPath,
                operationPath: mutationTarget.resolvedPath,
                operation: "make-directory",
                cause,
              }),
      });
    } else {
      const handle = yield* Effect.tryPromise({
        try: () => NodeFSP.open(mutationTarget.resolvedPath, "wx"),
        catch: (cause) =>
          (cause as NodeJS.ErrnoException).code === "EEXIST"
            ? new WorkspaceEntryCollisionError({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                resolvedPath: mutationTarget.resolvedPath,
              })
            : operationError({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                resolvedPath: mutationTarget.resolvedPath,
                operationPath: mutationTarget.resolvedPath,
                operation: "create-file",
                cause,
              }),
      });
      yield* Effect.tryPromise({
        try: () => handle.close(),
        catch: (cause) =>
          operationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: mutationTarget.resolvedPath,
            operationPath: mutationTarget.resolvedPath,
            operation: "create-file",
            cause,
          }),
      });
    }

    yield* realExistingTargetWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
      absolutePath: mutationTarget.resolvedPath,
    });
    yield* workspaceEntries.refresh(input.cwd);
    return { relativePath: target.relativePath, kind: input.kind };
  });

  const moveEntry: WorkspaceFileSystem["Service"]["moveEntry"] = Effect.fn(
    "WorkspaceFileSystem.moveEntry",
  )(function* (input) {
    const source = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.sourcePath,
    });
    const destination = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.destinationPath,
    });
    const resolvedSourcePath = yield* realExistingTargetWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.sourcePath,
      absolutePath: source.absolutePath,
    });
    const resolvedDestination = yield* mutationTargetWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.destinationPath,
      absolutePath: destination.absolutePath,
    });
    if (resolvedDestination.exists) {
      return yield* new WorkspaceEntryCollisionError({
        workspaceRoot: input.cwd,
        relativePath: input.destinationPath,
        resolvedPath: resolvedDestination.resolvedPath,
      });
    }
    const sourceStat = yield* Effect.tryPromise({
      try: () => NodeFSP.lstat(source.absolutePath),
      catch: (cause) =>
        operationError({
          workspaceRoot: input.cwd,
          relativePath: input.sourcePath,
          resolvedPath: resolvedSourcePath,
          operationPath: source.absolutePath,
          operation: "stat",
          cause,
        }),
    });
    yield* Effect.tryPromise({
      try: async () => {
        try {
          await NodeFSP.cp(source.absolutePath, resolvedDestination.resolvedPath, {
            recursive: sourceStat.isDirectory(),
            force: false,
            errorOnExist: true,
            preserveTimestamps: true,
          });
        } catch (cause) {
          const code = (cause as NodeJS.ErrnoException).code;
          if (code !== "EEXIST" && code !== "ENOTEMPTY") {
            await NodeFSP.rm(resolvedDestination.resolvedPath, {
              recursive: true,
              force: true,
            }).catch(() => undefined);
          }
          throw cause;
        }
        try {
          await NodeFSP.rm(source.absolutePath, {
            recursive: sourceStat.isDirectory(),
          });
        } catch (cause) {
          await NodeFSP.rm(resolvedDestination.resolvedPath, {
            recursive: true,
            force: true,
          }).catch(() => undefined);
          throw cause;
        }
      },
      catch: (cause) =>
        ["EEXIST", "ENOTEMPTY"].includes((cause as NodeJS.ErrnoException).code ?? "")
          ? new WorkspaceEntryCollisionError({
              workspaceRoot: input.cwd,
              relativePath: input.destinationPath,
              resolvedPath: resolvedDestination.resolvedPath,
            })
          : operationError({
              workspaceRoot: input.cwd,
              relativePath: input.sourcePath,
              resolvedPath: resolvedSourcePath,
              operationPath: resolvedDestination.resolvedPath,
              operation: "rename",
              cause,
            }),
    });
    yield* realExistingTargetWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.destinationPath,
      absolutePath: resolvedDestination.resolvedPath,
    });
    yield* workspaceEntries.refresh(input.cwd);
    return {
      sourcePath: source.relativePath,
      destinationPath: destination.relativePath,
    };
  });

  const deleteEntry: WorkspaceFileSystem["Service"]["deleteEntry"] = Effect.fn(
    "WorkspaceFileSystem.deleteEntry",
  )(function* (input) {
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });
    const resolvedPath = yield* realExistingTargetWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
      absolutePath: target.absolutePath,
    });
    const stat = yield* Effect.tryPromise({
      try: () => NodeFSP.lstat(target.absolutePath),
      catch: (cause) =>
        operationError({
          workspaceRoot: input.cwd,
          relativePath: input.relativePath,
          resolvedPath,
          operationPath: target.absolutePath,
          operation: "stat",
          cause,
        }),
    });
    yield* Effect.tryPromise({
      try: () =>
        stat.isDirectory()
          ? input.recursive
            ? NodeFSP.rm(target.absolutePath, { recursive: true })
            : NodeFSP.rmdir(target.absolutePath)
          : NodeFSP.unlink(target.absolutePath),
      catch: (cause) =>
        (cause as NodeJS.ErrnoException).code === "ENOTEMPTY"
          ? new WorkspaceDirectoryNotEmptyError({
              workspaceRoot: input.cwd,
              relativePath: input.relativePath,
              resolvedPath,
            })
          : operationError({
              workspaceRoot: input.cwd,
              relativePath: input.relativePath,
              resolvedPath,
              operationPath: target.absolutePath,
              operation: "remove",
              cause,
            }),
    });
    yield* workspaceEntries.refresh(input.cwd);
    return { relativePath: target.relativePath };
  });

  return WorkspaceFileSystem.of({ readFile, writeFile, createEntry, moveEntry, deleteEntry });
});

export const layer = Layer.effect(WorkspaceFileSystem, make);
