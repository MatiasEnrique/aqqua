import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  createPosixAqquaShimContents,
  createWindowsAqquaShimContents,
  installAqquaDevShim,
  prependPathEntry,
} from "./aqqua-dev-shim.ts";

it.layer(NodeServices.layer)("aqqua-dev-shim", (it) => {
  describe("prependPathEntry", () => {
    it.effect("prepends the shim directory without duplicating an existing entry", () =>
      Effect.sync(() => {
        assert.equal(
          prependPathEntry("/usr/bin:/repo/.aqqua/bin:/bin", "/repo/.aqqua/bin", "linux"),
          "/repo/.aqqua/bin:/usr/bin:/bin",
        );
      }),
    );

    it.effect("uses the Windows path delimiter when needed", () =>
      Effect.sync(() => {
        assert.equal(
          prependPathEntry(
            "C:\\Windows\\System32;C:\\repo\\.aqqua\\bin",
            "C:\\repo\\.aqqua\\bin",
            "win32",
          ),
          "C:\\repo\\.aqqua\\bin;C:\\Windows\\System32",
        );
      }),
    );
  });

  describe("shim contents", () => {
    it.effect("quotes paths in the POSIX shim", () =>
      Effect.sync(() => {
        assert.equal(
          createPosixAqquaShimContents({
            nodeExecutablePath: "/Applications/Node JS/bin/node",
            launcherPath: "/repo/apps/server/src/cli/aqqua-launcher.ts",
          }),
          "#!/bin/sh\nexec '/Applications/Node JS/bin/node' '/repo/apps/server/src/cli/aqqua-launcher.ts' \"$@\"\n",
        );
      }),
    );

    it.effect("quotes paths in the Windows shim", () =>
      Effect.sync(() => {
        assert.equal(
          createWindowsAqquaShimContents({
            nodeExecutablePath: "C:\\Program Files\\nodejs\\node.exe",
            launcherPath: "C:\\repo\\apps\\server\\src\\cli\\aqqua-launcher.ts",
          }),
          '@echo off\r\n"C:\\Program Files\\nodejs\\node.exe" "C:\\repo\\apps\\server\\src\\cli\\aqqua-launcher.ts" %*\r\n',
        );
      }),
    );
  });

  describe("installAqquaDevShim", () => {
    it.effect("writes executable shims into the chosen base directory", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const baseDirectoryPath = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "aqqua-dev-shim-",
        });

        const installed = yield* installAqquaDevShim({
          baseDirectoryPath,
          nodeExecutablePath: "/usr/local/bin/node",
        });

        assert.equal(installed.shimDirectoryPath, path.join(baseDirectoryPath, "bin"));
        const expectedLauncherPath = yield* path.fromFileUrl(
          new URL("../apps/server/src/cli/aqqua-launcher.ts", import.meta.url),
        );
        assert.equal(installed.launcherPath, expectedLauncherPath);
        assert.isTrue(yield* fileSystem.exists(installed.posixShimPath));
        assert.isTrue(yield* fileSystem.exists(installed.windowsShimPath));
        assert.equal(
          yield* fileSystem.readFileString(installed.posixShimPath),
          createPosixAqquaShimContents({
            nodeExecutablePath: "/usr/local/bin/node",
            launcherPath: installed.launcherPath,
          }),
        );
        assert.equal(
          yield* fileSystem.readFileString(installed.windowsShimPath),
          createWindowsAqquaShimContents({
            nodeExecutablePath: "/usr/local/bin/node",
            launcherPath: installed.launcherPath,
          }),
        );
      }),
    );
  });
});
