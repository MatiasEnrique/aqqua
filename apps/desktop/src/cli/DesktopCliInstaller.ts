import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

export interface DesktopCliInstallInput {
  readonly baseDirectoryPath: string;
  readonly electronExecutablePath: string;
  readonly backendEntryPath: string;
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
}

export interface InstalledDesktopCli {
  readonly shimDirectoryPath: string;
  readonly shimPath: string;
}

export function prependDesktopCliPath(
  pathValue: string | undefined,
  entry: string,
  platform: NodeJS.Platform,
): string {
  const delimiter = platform === "win32" ? ";" : ":";
  const comparisonKey = (value: string) => (platform === "win32" ? value.toLowerCase() : value);
  const entryKey = comparisonKey(entry);
  const existingEntries = (pathValue ?? "")
    .split(delimiter)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && comparisonKey(segment) !== entryKey);

  return [entry, ...existingEntries].join(delimiter);
}

export function resolveDesktopCliExecutablePath(input: {
  readonly platform: NodeJS.Platform;
  readonly electronExecutablePath: string;
  readonly appImagePath: string | undefined;
}): string {
  if (input.platform === "linux" && input.appImagePath?.trim()) {
    return input.appImagePath;
  }
  return input.electronExecutablePath;
}

export function createPosixDesktopCliShim(input: {
  readonly electronExecutablePath: string;
  readonly backendEntryPath: string;
  readonly resolveBackendFromResources?: boolean;
}): string {
  if (input.resolveBackendFromResources) {
    const bootstrap = createResourcesResolvedDesktopCliBootstrap();
    return `#!/bin/sh
export ELECTRON_RUN_AS_NODE=1
exec ${quotePosixShellArg(input.electronExecutablePath)} -e ${quotePosixShellArg(bootstrap)} "$@"
`;
  }

  return `#!/bin/sh
export ELECTRON_RUN_AS_NODE=1
exec ${quotePosixShellArg(input.electronExecutablePath)} ${quotePosixShellArg(input.backendEntryPath)} "$@"
`;
}

export const createResourcesResolvedDesktopCliBootstrap = (): string =>
  [
    'const path = require("node:path")',
    'const { spawn } = require("node:child_process")',
    'const entry = path.join(process.resourcesPath, "app.asar/apps/server/dist/bin.mjs")',
    'const child = spawn(process.execPath, [entry, ...process.argv.slice(1)], { stdio: "inherit", env: process.env })',
    'const signals = ["SIGINT", "SIGTERM", "SIGHUP"]',
    "const forwarders = new Map(signals.map((signal) => [signal, () => child.kill(signal)]))",
    "for (const [signal, forward] of forwarders) process.on(signal, forward)",
    'child.once("error", (error) => { console.error(error); process.exitCode = 1 })',
    'child.once("exit", (code, signal) => { for (const [name, forward] of forwarders) process.off(name, forward); if (signal) process.kill(process.pid, signal); else process.exit(code ?? 1) })',
  ].join(";");

export function createWindowsDesktopCliShim(input: {
  readonly electronExecutablePath: string;
  readonly backendEntryPath: string;
}): string {
  return `@echo off\r
setlocal\r
set "ELECTRON_RUN_AS_NODE=1"\r
"${escapeWindowsCommandArgument(input.electronExecutablePath)}" "${escapeWindowsCommandArgument(input.backendEntryPath)}" %*\r
`;
}

export const installDesktopCli = Effect.fn("desktop.cli.install")(function* (
  input: DesktopCliInstallInput,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const shimDirectoryPath = path.join(input.baseDirectoryPath, "bin");
  const shimPath = path.join(shimDirectoryPath, input.platform === "win32" ? "aqqua.cmd" : "aqqua");
  const contents =
    input.platform === "win32"
      ? createWindowsDesktopCliShim(input)
      : createPosixDesktopCliShim({
          ...input,
          resolveBackendFromResources: input.platform === "linux" && Boolean(input.env.APPIMAGE),
        });

  yield* fs.makeDirectory(shimDirectoryPath, { recursive: true });
  yield* fs.writeFileString(shimPath, contents);
  if (input.platform !== "win32") {
    yield* fs.chmod(shimPath, 0o755);
  }

  input.env.PATH = prependDesktopCliPath(input.env.PATH, shimDirectoryPath, input.platform);
  return { shimDirectoryPath, shimPath } satisfies InstalledDesktopCli;
});

function quotePosixShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function escapeWindowsCommandArgument(value: string): string {
  return value.replaceAll("%", "%%").replaceAll('"', '""');
}
