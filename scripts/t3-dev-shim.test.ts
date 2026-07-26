import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  createPosixT3ShimContents,
  createWindowsT3ShimContents,
  installT3DevShim,
  prependPathEntry,
} from "./t3-dev-shim.ts";

it.layer(NodeServices.layer)("t3-dev-shim", (it) => {
  describe("prependPathEntry", () => {
    it.effect("prepends the shim directory without duplicating an existing entry", () =>
      Effect.sync(() => {
        assert.equal(
          prependPathEntry("/usr/bin:/repo/.t3/bin:/bin", "/repo/.t3/bin", "linux"),
          "/repo/.t3/bin:/usr/bin:/bin",
        );
      }),
    );

    it.effect("uses the Windows path delimiter when needed", () =>
      Effect.sync(() => {
        assert.equal(
          prependPathEntry(
            "C:\\Windows\\System32;C:\\repo\\.t3\\bin",
            "C:\\repo\\.t3\\bin",
            "win32",
          ),
          "C:\\repo\\.t3\\bin;C:\\Windows\\System32",
        );
      }),
    );
  });

  describe("shim contents", () => {
    it.effect("quotes paths in the POSIX shim", () =>
      Effect.sync(() => {
        assert.equal(
          createPosixT3ShimContents({
            nodeExecutablePath: "/Applications/Node JS/bin/node",
            launcherPath: "/repo/apps/server/src/cli/t3-launcher.ts",
          }),
          "#!/bin/sh\nexec '/Applications/Node JS/bin/node' '/repo/apps/server/src/cli/t3-launcher.ts' \"$@\"\n",
        );
      }),
    );

    it.effect("quotes paths in the Windows shim", () =>
      Effect.sync(() => {
        assert.equal(
          createWindowsT3ShimContents({
            nodeExecutablePath: "C:\\Program Files\\nodejs\\node.exe",
            launcherPath: "C:\\repo\\apps\\server\\src\\cli\\t3-launcher.ts",
          }),
          '@echo off\r\n"C:\\Program Files\\nodejs\\node.exe" "C:\\repo\\apps\\server\\src\\cli\\t3-launcher.ts" %*\r\n',
        );
      }),
    );
  });

  describe("installT3DevShim", () => {
    it.effect("writes executable shims into the chosen base directory", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const baseDirectoryPath = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3-dev-shim-",
        });

        const installed = yield* installT3DevShim({
          baseDirectoryPath,
          nodeExecutablePath: "/usr/local/bin/node",
        });

        assert.equal(installed.shimDirectoryPath, path.join(baseDirectoryPath, "bin"));
        assert.equal(
          installed.launcherPath,
          path.join(
            "/Users/matias/Development/t3code",
            "apps",
            "server",
            "src",
            "cli",
            "t3-launcher.ts",
          ),
        );
        assert.isTrue(yield* fileSystem.exists(installed.posixShimPath));
        assert.isTrue(yield* fileSystem.exists(installed.windowsShimPath));
        assert.equal(
          yield* fileSystem.readFileString(installed.posixShimPath),
          createPosixT3ShimContents({
            nodeExecutablePath: "/usr/local/bin/node",
            launcherPath: installed.launcherPath,
          }),
        );
        assert.equal(
          yield* fileSystem.readFileString(installed.windowsShimPath),
          createWindowsT3ShimContents({
            nodeExecutablePath: "/usr/local/bin/node",
            launcherPath: installed.launcherPath,
          }),
        );
      }),
    );
  });
});
