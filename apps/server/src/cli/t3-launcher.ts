#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - CLI launcher needs direct Node process exec and entrypoint probing before the Effect runtime boots.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

export interface ResolvedT3Entrypoint {
  readonly distEntrypointPath: string;
  readonly sourceEntrypointPath: string;
  readonly selectedEntrypointPath: string;
}

export function resolveT3Entrypoint(
  packageRoot: string,
  exists: (path: string) => boolean = NodeFS.existsSync,
): ResolvedT3Entrypoint {
  const distEntrypointPath = NodePath.join(packageRoot, "dist", "bin.mjs");
  const sourceEntrypointPath = NodePath.join(packageRoot, "src", "bin.ts");

  return {
    distEntrypointPath,
    sourceEntrypointPath,
    selectedEntrypointPath: exists(distEntrypointPath) ? distEntrypointPath : sourceEntrypointPath,
  };
}

export function runT3Entrypoint(input: {
  readonly nodePath: string;
  readonly entrypointPath: string;
  readonly args: ReadonlyArray<string>;
  readonly env?: NodeJS.ProcessEnv;
}) {
  return NodeChildProcess.spawnSync(input.nodePath, [input.entrypointPath, ...input.args], {
    stdio: "inherit",
    env: input.env ?? process.env,
  });
}

if (import.meta.main) {
  const packageRoot = NodePath.dirname(
    NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url))),
  );
  const { selectedEntrypointPath } = resolveT3Entrypoint(packageRoot);
  const result = runT3Entrypoint({
    nodePath: process.execPath,
    entrypointPath: selectedEntrypointPath,
    args: process.argv.slice(2),
  });

  if (result.error) {
    throw result.error;
  }

  if (result.signal) {
    process.kill(process.pid, result.signal);
  }

  process.exit(result.status ?? 1);
}
