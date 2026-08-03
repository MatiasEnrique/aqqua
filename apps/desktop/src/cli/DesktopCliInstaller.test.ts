// @effect-diagnostics nodeBuiltinImport:off - The launcher must be exercised as an OS process.
import * as NodeChildProcess from "node:child_process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { HostProcessPlatform } from "@aqqua/shared/hostProcess";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  createPosixDesktopCliShim,
  createResourcesResolvedDesktopCliBootstrap,
  createWindowsDesktopCliShim,
  installDesktopCli,
  prependDesktopCliPath,
  resolveDesktopCliExecutablePath,
} from "./DesktopCliInstaller.ts";

describe("DesktopCliInstaller", () => {
  it("creates an Electron-as-Node POSIX launcher", () => {
    assert.equal(
      createPosixDesktopCliShim({
        electronExecutablePath: "/Applications/aqqua's app/Contents/MacOS/aqqua",
        backendEntryPath:
          "/Applications/aqqua's app/Contents/Resources/app.asar/apps/server/dist/bin.mjs",
      }),
      "#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec '/Applications/aqqua'\"'\"'s app/Contents/MacOS/aqqua' '/Applications/aqqua'\"'\"'s app/Contents/Resources/app.asar/apps/server/dist/bin.mjs' \"$@\"\n",
    );
  });

  it("creates a Windows launcher without expanding percent signs in installed paths", () => {
    assert.equal(
      createWindowsDesktopCliShim({
        electronExecutablePath: "C:\\Users\\100% User\\aqqua.exe",
        backendEntryPath:
          "C:\\Program Files\\aqqua\\resources\\app.asar\\apps\\server\\dist\\bin.mjs",
      }),
      '@echo off\r\nsetlocal\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"C:\\Users\\100%% User\\aqqua.exe" "C:\\Program Files\\aqqua\\resources\\app.asar\\apps\\server\\dist\\bin.mjs" %*\r\n',
    );
  });

  it("prepends the installed bin directory without duplicates", () => {
    assert.equal(
      prependDesktopCliPath("/usr/bin:/Users/test/.aqqua/bin", "/Users/test/.aqqua/bin", "darwin"),
      "/Users/test/.aqqua/bin:/usr/bin",
    );
    assert.equal(
      prependDesktopCliPath(
        "C:\\Users\\test\\.aqqua\\bin;C:\\Windows",
        "c:\\users\\test\\.aqqua\\bin",
        "win32",
      ),
      "c:\\users\\test\\.aqqua\\bin;C:\\Windows",
    );
  });

  it("uses the stable AppImage path for Linux launchers", () => {
    assert.equal(
      resolveDesktopCliExecutablePath({
        platform: "linux",
        electronExecutablePath: "/tmp/.mount_aqqua/aqqua",
        appImagePath: "/home/test/Applications/aqqua.AppImage",
      }),
      "/home/test/Applications/aqqua.AppImage",
    );
    assert.equal(
      resolveDesktopCliExecutablePath({
        platform: "darwin",
        electronExecutablePath: "/Applications/aqqua.app/Contents/MacOS/aqqua",
        appImagePath: undefined,
      }),
      "/Applications/aqqua.app/Contents/MacOS/aqqua",
    );
  });

  it("resolves the AppImage backend from its current resources mount", () => {
    const shim = createPosixDesktopCliShim({
      electronExecutablePath: "/home/test/Applications/aqqua.AppImage",
      backendEntryPath: "/tmp/.mount_aqqua/resources/app.asar/apps/server/dist/bin.mjs",
      resolveBackendFromResources: true,
    });

    assert.include(shim, "process.resourcesPath");
    assert.include(shim, "app.asar/apps/server/dist/bin.mjs");
    assert.include(shim, "spawn(process.execPath");
    assert.notInclude(shim, "/tmp/.mount_aqqua");
  });

  it.effect("preserves a resources-resolved backend's signal exit", () =>
    Effect.gen(function* () {
      const platform = yield* HostProcessPlatform;
      if (platform === "win32") return;

      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const resourcesPath = yield* fs.makeTempDirectoryScoped({
        prefix: "aqqua-appimage-cli-",
      });
      const entryPath = path.join(resourcesPath, "app.asar/apps/server/dist/bin.mjs");
      yield* fs.makeDirectory(path.dirname(entryPath), { recursive: true });
      yield* fs.writeFileString(entryPath, 'process.kill(process.pid, "SIGTERM");\n');

      const result = NodeChildProcess.spawnSync(
        process.execPath,
        [
          "-e",
          `Object.defineProperty(process, "resourcesPath", { value: process.env.TEST_RESOURCES_PATH });${createResourcesResolvedDesktopCliBootstrap()}`,
        ],
        {
          env: { ...process.env, TEST_RESOURCES_PATH: resourcesPath },
          encoding: "utf8",
        },
      );

      assert.equal(result.status, null);
      assert.equal(result.signal, "SIGTERM");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("installs an executable launcher and exposes it to desktop child processes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDirectoryPath = yield* fs.makeTempDirectoryScoped({
        prefix: "aqqua-desktop-cli-",
      });
      const backendEntryPath = path.join(baseDirectoryPath, "backend.mjs");
      yield* fs.writeFileString(
        backendEntryPath,
        'console.log(process.argv.slice(2).join("\\n"));\nconsole.log(process.env.ELECTRON_RUN_AS_NODE);\n',
      );
      const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
      const installed = yield* installDesktopCli({
        baseDirectoryPath,
        electronExecutablePath: process.execPath,
        backendEntryPath,
        platform: "darwin",
        env,
      });

      assert.equal(installed.shimDirectoryPath, path.join(baseDirectoryPath, "bin"));
      assert.equal(installed.shimPath, path.join(baseDirectoryPath, "bin", "aqqua"));
      assert.isTrue(yield* fs.exists(installed.shimPath));
      assert.equal(env.PATH, `${installed.shimDirectoryPath}:/usr/bin`);
      assert.equal(
        yield* fs.readFileString(installed.shimPath),
        createPosixDesktopCliShim({
          electronExecutablePath: process.execPath,
          backendEntryPath,
        }),
      );
      assert.equal(
        NodeChildProcess.execFileSync(installed.shimPath, ["hello world", "$literal"], {
          encoding: "utf8",
        }),
        "hello world\n$literal\n1\n",
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
