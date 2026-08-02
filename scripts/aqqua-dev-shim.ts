// @effect-diagnostics nodeBuiltinImport:off - Dev shim generation writes tiny host launchers before any package runtime starts.
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

const REPO_ROOT = NodeURL.fileURLToPath(new URL("../", import.meta.url));
const AQQUA_LAUNCHER_PATH = NodePath.join(
  REPO_ROOT,
  "apps",
  "server",
  "src",
  "cli",
  "aqqua-launcher.ts",
);

export interface InstalledAqquaDevShim {
  readonly shimDirectoryPath: string;
  readonly launcherPath: string;
  readonly posixShimPath: string;
  readonly windowsShimPath: string;
}

export function prependPathEntry(
  pathValue: string | undefined,
  entry: string,
  platform: NodeJS.Platform,
): string {
  const delimiter = platform === "win32" ? ";" : ":";
  const existingEntries = (pathValue ?? "")
    .split(delimiter)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  return [entry, ...existingEntries.filter((segment) => segment !== entry)].join(delimiter);
}

export function createPosixAqquaShimContents(input: {
  readonly nodeExecutablePath: string;
  readonly launcherPath: string;
}): string {
  return `#!/bin/sh
exec ${quotePosixShellArg(input.nodeExecutablePath)} ${quotePosixShellArg(input.launcherPath)} "$@"
`;
}

export function createWindowsAqquaShimContents(input: {
  readonly nodeExecutablePath: string;
  readonly launcherPath: string;
}): string {
  return `@echo off\r
"${escapeWindowsCommandArgument(input.nodeExecutablePath)}" "${escapeWindowsCommandArgument(input.launcherPath)}" %*\r
`;
}

export const installAqquaDevShim = Effect.fn("installAqquaDevShim")(function* (input: {
  readonly baseDirectoryPath: string;
  readonly nodeExecutablePath: string;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const shimDirectoryPath = path.join(input.baseDirectoryPath, "bin");
  const posixShimPath = path.join(shimDirectoryPath, "aqqua");
  const windowsShimPath = path.join(shimDirectoryPath, "aqqua.cmd");

  yield* fileSystem.makeDirectory(shimDirectoryPath, { recursive: true }).pipe(Effect.orDie);
  yield* fileSystem
    .writeFileString(
      posixShimPath,
      createPosixAqquaShimContents({
        nodeExecutablePath: input.nodeExecutablePath,
        launcherPath: AQQUA_LAUNCHER_PATH,
      }),
    )
    .pipe(Effect.orDie);
  yield* fileSystem.chmod(posixShimPath, 0o755).pipe(Effect.orDie);
  yield* fileSystem
    .writeFileString(
      windowsShimPath,
      createWindowsAqquaShimContents({
        nodeExecutablePath: input.nodeExecutablePath,
        launcherPath: AQQUA_LAUNCHER_PATH,
      }),
    )
    .pipe(Effect.orDie);

  return {
    shimDirectoryPath,
    launcherPath: AQQUA_LAUNCHER_PATH,
    posixShimPath,
    windowsShimPath,
  };
});

function quotePosixShellArg(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function escapeWindowsCommandArgument(value: string): string {
  return value.replaceAll('"', '""');
}
