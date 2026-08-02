import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopConfig from "./DesktopConfig.ts";

const defaultInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "0.0.22",
  appPath: "/Applications/aqqua.app/Contents/Resources/app.asar",
  isPackaged: false,
  resourcesPath: "/Applications/aqqua.app/Contents/Resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

const makeEnvironmentLayer = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) =>
  DesktopEnvironment.layer({
    ...defaultInput,
    ...overrides,
  }).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest(env))));

const makeEnvironment = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) =>
  DesktopEnvironment.DesktopEnvironment.pipe(Effect.provide(makeEnvironmentLayer(overrides, env)));

describe("DesktopEnvironment", () => {
  it.effect("derives state paths and development identity inside Effect", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment(
        {},
        {
          AQQUA_HOME: " /tmp/aqqua ",
          AQQUA_COMMIT_HASH: " 0123456789abcdef ",
          AQQUA_PORT: "4949",
          VITE_DEV_SERVER_URL: "http://localhost:5173",
          AQQUA_DEV_REMOTE_AQQUA_SERVER_ENTRY_PATH: " /remote/server.mjs ",
          AQQUA_OTLP_TRACES_URL: " http://127.0.0.1:4318/v1/traces ",
          AQQUA_OTLP_EXPORT_INTERVAL_MS: "2500",
        },
      );

      assert.equal(environment.isDevelopment, true);
      assert.equal(environment.appDataDirectory, "/Users/alice/Library/Application Support");
      assert.equal(environment.baseDir, "/tmp/aqqua");
      assert.equal(environment.stateDir, "/tmp/aqqua/userdata");
      assert.equal(environment.desktopSettingsPath, "/tmp/aqqua/userdata/desktop-settings.json");
      assert.equal(environment.clientSettingsPath, "/tmp/aqqua/userdata/client-settings.json");
      assert.equal(
        environment.savedEnvironmentRegistryPath,
        "/tmp/aqqua/userdata/saved-environments.json",
      );
      assert.equal(environment.serverSettingsPath, "/tmp/aqqua/userdata/settings.json");
      assert.equal(environment.logDir, "/tmp/aqqua/userdata/logs");
      assert.equal(environment.browserArtifactsDir, "/tmp/aqqua/userdata/browser-artifacts");
      assert.equal(environment.rootDir, "/repo");
      assert.equal(environment.appRoot, "/repo");
      assert.equal(environment.backendEntryPath, "/repo/apps/server/dist/bin.mjs");
      assert.equal(environment.backendCwd, "/repo");
      assert.equal(environment.appUserModelId, "com.aqqua.aqqua.dev");
      assert.equal(environment.linuxWmClass, "aqqua-dev");
      assert.deepEqual(
        Option.map(environment.devServerUrl, (url) => url.href),
        Option.some("http://localhost:5173/"),
      );
      assert.deepEqual(
        environment.devRemoteAqquaServerEntryPath,
        Option.some("/remote/server.mjs"),
      );
      assert.deepEqual(environment.configuredBackendPort, Option.some(4949));
      assert.deepEqual(environment.commitHashOverride, Option.some("0123456789abcdef"));
      assert.deepEqual(environment.otlpTracesUrl, Option.some("http://127.0.0.1:4318/v1/traces"));
      assert.equal(environment.otlpExportIntervalMs, 2500);
    }),
  );

  it.effect("stores production state under userdata in an explicit home", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment(
        {},
        {
          AQQUA_HOME: "/tmp/aqqua",
        },
      );

      assert.equal(environment.isDevelopment, false);
      assert.equal(environment.stateDir, "/tmp/aqqua/userdata");
      assert.equal(environment.logDir, "/tmp/aqqua/userdata/logs");
      assert.equal(environment.browserArtifactsDir, "/tmp/aqqua/userdata/browser-artifacts");
      assert.equal(environment.serverSettingsPath, "/tmp/aqqua/userdata/settings.json");
    }),
  );

  it.effect("keeps implicit development state separate from production state", () =>
    Effect.gen(function* () {
      const development = yield* makeEnvironment(
        {},
        { VITE_DEV_SERVER_URL: "http://localhost:5173" },
      );
      const production = yield* makeEnvironment();

      assert.equal(development.stateDir, "/Users/alice/.aqqua/dev");
      assert.equal(production.stateDir, "/Users/alice/.aqqua/userdata");
    }),
  );

  it.effect("keeps a Sigma build's identity and state clear of an installed release", () =>
    Effect.gen(function* () {
      const sigma = yield* makeEnvironment({ appVersion: "0.0.28-sigma" });
      const release = yield* makeEnvironment({ appVersion: "0.0.28" });

      // Two servers sharing one state.sqlite corrupt the projection and stop
      // each other's sessions, so a Sigma build never lands in the release home.
      assert.equal(sigma.baseDir, "/Users/alice/.aqqua-sigma");
      assert.equal(sigma.stateDir, "/Users/alice/.aqqua-sigma/userdata");
      assert.equal(release.stateDir, "/Users/alice/.aqqua/userdata");

      assert.equal(sigma.branding.stageLabel, "Sigma");
      assert.equal(sigma.displayName, "aqqua (Sigma)");
      assert.equal(sigma.appUserModelId, "com.aqqua.aqqua.sigma");
      assert.equal(sigma.userDataDirName, "aqqua-sigma");
      assert.equal(sigma.linuxWmClass, "aqqua-sigma");
      assert.equal(sigma.linuxDesktopEntryName, "aqqua-sigma.desktop");

      assert.equal(release.branding.stageLabel, "Alpha");
      assert.equal(release.appUserModelId, "com.aqqua.aqqua");
      assert.equal(release.userDataDirName, "aqqua");
    }),
  );

  it.effect("lets an explicit AQQUA_HOME override a Sigma build's default home", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment(
        { appVersion: "0.0.28-sigma" },
        { AQQUA_HOME: "/tmp/aqqua-elsewhere" },
      );

      assert.equal(environment.stateDir, "/tmp/aqqua-elsewhere/userdata");
    }),
  );

  it.effect("uses a configured app user model id override", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment(
        {},
        {
          AQQUA_DESKTOP_APP_USER_MODEL_ID: " com.aqqua.aqqua.dev.local ",
          VITE_DEV_SERVER_URL: "http://localhost:5173",
        },
      );

      assert.equal(environment.appUserModelId, "com.aqqua.aqqua.dev.local");
    }),
  );

  it.effect("resolves picker defaults without nullish sentinels", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment();

      assert.deepEqual(environment.resolvePickFolderDefaultPath(null), Option.none());
      assert.deepEqual(
        environment.resolvePickFolderDefaultPath({ initialPath: " " }),
        Option.none(),
      );
      assert.deepEqual(
        environment.resolvePickFolderDefaultPath({ initialPath: "~" }),
        Option.some("/Users/alice"),
      );
      assert.deepEqual(
        environment.resolvePickFolderDefaultPath({ initialPath: "~/project" }),
        Option.some("/Users/alice/project"),
      );
    }),
  );
});
