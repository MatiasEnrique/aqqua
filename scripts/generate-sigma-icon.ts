#!/usr/bin/env node

/**
 * generate-sigma-icon - Derive the Sigma channel's icon renditions.
 *
 * A Sigma build sits in the Dock beside the release it was built from, so it
 * cannot wear the same artwork: with identical icons there is no way to tell
 * which tile or window belongs to which app. The released channels export their
 * renditions from Icon Composer projects (see `export-brand-icons`); Sigma is
 * self-built and keeps a single committed source image instead, so changing the
 * icon is dropping a new square PNG at `assets/sigma/sigma-source.png` and
 * rerunning this.
 *
 * `sips` does the resampling, as it already does for the macOS iconset during a
 * desktop build, and the `.ico` goes through the same `encodePngIco` the
 * designed channels use. That makes this macOS-only to *run*; the renditions it
 * writes are committed, so Linux and Windows builds never need it.
 *
 * Run `node scripts/generate-sigma-icon.ts` and commit the regenerated files in
 * `assets/sigma/`.
 *
 * @module generate-sigma-icon
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { encodePngIco } from "./lib/icon-export.ts";

const SOURCE_RELATIVE_PATH = "assets/sigma/sigma-source.png";
const OUTPUT_DIR_SEGMENTS = ["assets", "sigma"] as const;
/** macOS renders the icns from this; Linux downsizes the same square. */
const DESKTOP_RENDITION_SIZE = 1024;
/** electron-builder requires the 256px entry, and one entry is enough. */
const WINDOWS_ICON_SIZE = 256;

export class SigmaIconResizeError extends Schema.TaggedErrorClass<SigmaIconResizeError>()(
  "SigmaIconResizeError",
  {
    size: Schema.Number,
    exitCode: Schema.Number,
  },
) {
  override get message(): string {
    return `Failed to resize the Sigma icon source to ${this.size}px (sips exited ${this.exitCode}).`;
  }
}

const resize = Effect.fn("generateSigmaIcon.resize")(function* (
  sourcePath: string,
  targetPath: string,
  size: number,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const process = yield* spawner.spawn(
    ChildProcess.make({})`sips -z ${size} ${size} ${sourcePath} --out ${targetPath}`,
  );
  const exitCode = yield* process.exitCode;
  if (exitCode !== 0) {
    return yield* new SigmaIconResizeError({ size, exitCode });
  }
});

const generateSigmaIcon = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repoRoot = yield* path.fromFileUrl(new URL("..", import.meta.url));
  const sourcePath = path.join(repoRoot, SOURCE_RELATIVE_PATH);
  const outputDir = path.join(repoRoot, ...OUTPUT_DIR_SEGMENTS);

  yield* fileSystem.makeDirectory(outputDir, { recursive: true });

  const macPath = path.join(outputDir, "sigma-macos-1024.png");
  const linuxPath = path.join(outputDir, "sigma-universal-1024.png");
  const icoPath = path.join(outputDir, "sigma-windows.ico");

  // The source already carries its own rounded plate, so macOS and Linux take
  // the same square; only the pixel size differs from the source.
  yield* resize(sourcePath, macPath, DESKTOP_RENDITION_SIZE);
  yield* resize(sourcePath, linuxPath, DESKTOP_RENDITION_SIZE);

  // Round-trip the Windows rendition through a temp file so `sips` owns the
  // resampling for every size, then wrap it in the shared ICO encoder.
  const windowsPngPath = path.join(outputDir, "sigma-windows-256.png");
  yield* resize(sourcePath, windowsPngPath, WINDOWS_ICON_SIZE);
  const windowsPng = Buffer.from(yield* fileSystem.readFile(windowsPngPath));
  yield* fileSystem.remove(windowsPngPath);
  yield* fileSystem.writeFile(
    icoPath,
    encodePngIco([{ size: WINDOWS_ICON_SIZE, contents: windowsPng }]),
  );

  for (const target of [macPath, linuxPath, icoPath]) {
    const stats = yield* fileSystem.stat(target);
    yield* Console.log(`${path.relative(repoRoot, target)} (${stats.size} bytes)`);
  }
});

const generateSigmaIconCommand = Command.make("generate-sigma-icon", {}, () =>
  // Scoped here, as in `export-brand-icons`: each spawned `sips` binds its
  // process handle to this scope.
  generateSigmaIcon.pipe(Effect.scoped),
).pipe(
  Command.withDescription(
    "Derive the Sigma desktop icon renditions from assets/sigma/sigma-source.png.",
  ),
);

if (import.meta.main) {
  Command.run(generateSigmaIconCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
