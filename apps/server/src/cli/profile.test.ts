import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import {
  AgentProfileName,
  DEFAULT_AGENT_PROFILE_NAME,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentHttpNotFoundError,
  ProviderInstanceId,
} from "@aqqua/contracts";
import { assert, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import { HttpClientError, HttpClientRequest } from "effect/unstable/http";

import {
  IMPLICIT_DEFAULT_PROFILE,
  type ProfileApi,
  assertProfileCanDelete,
  executeProfileUpsert,
  formatProfileList,
  liveMutationShouldFallBack,
  mutateProfileFile,
  profileRows,
  resolveProfileForShow,
  validateProfileName,
} from "./profile.ts";
import { loadServerSettingsFromFileStrict, writeServerSettingsToFile } from "../serverSettings.ts";

const reviewer = AgentProfileName.make("reviewer");
const reviewerProfile = {
  ...IMPLICIT_DEFAULT_PROFILE,
  target: { kind: "instance" as const, instanceId: ProviderInstanceId.make("claudeAgent") },
  model: "claude-fable-5",
};
const withFileSystem = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope>,
): Effect.Effect<A, E, Scope.Scope> =>
  effect.pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, Path.layer)));

it.effect("validates the agent profile name contract", () =>
  Effect.gen(function* () {
    assert.equal(yield* validateProfileName("reviewer_2"), "reviewer_2");
    const invalid = yield* Effect.flip(validateProfileName("2-reviewer"));
    assert.include(invalid.message, "must start with a letter");
  }),
);

it("adds only the implicit implementer row when it is not customized", () => {
  const rows = profileRows({ [reviewer]: reviewerProfile });
  assert.deepEqual(
    rows.map(({ name, builtIn }) => ({ name, builtIn })),
    [
      { name: "implementer", builtIn: true },
      { name: "reviewer", builtIn: false },
    ],
  );
  assert.include(formatProfileList({}), "driver:codex");
  assert.include(formatProfileList({}), "inherit");
  assert.include(formatProfileList({}), "built-in");
});

it.effect("shows and protects the never-customized built-in implementer", () =>
  Effect.gen(function* () {
    const shown = yield* resolveProfileForShow({}, DEFAULT_AGENT_PROFILE_NAME);
    assert.isTrue(shown.builtIn);
    assert.deepEqual(shown.profile, IMPLICIT_DEFAULT_PROFILE);
    const error = yield* Effect.flip(assertProfileCanDelete({}, DEFAULT_AGENT_PROFILE_NAME));
    assert.include(error.message, "built in");
  }),
);

it.effect("allows update to materialize the implicit implementer through a fake transport", () =>
  Effect.gen(function* () {
    let received: Parameters<ProfileApi["mutate"]>[0] | undefined;
    const api: ProfileApi = {
      read: Effect.succeed(DEFAULT_SERVER_SETTINGS),
      mutate: (mutation) =>
        Effect.sync(() => {
          received = mutation;
          return "live" as const;
        }),
    };
    const transport = yield* executeProfileUpsert(
      api,
      "update",
      DEFAULT_AGENT_PROFILE_NAME,
      reviewerProfile,
    );
    assert.equal(transport, "live");
    assert.equal(received?.kind, "upsert");
  }),
);

it("does not treat a declared missing-profile response as an old-server endpoint", () => {
  assert.isFalse(
    liveMutationShouldFallBack(
      new EnvironmentHttpNotFoundError({ message: "Agent profile 'reviewer' is not stored." }),
    ),
  );
});

it("falls back only for transport failures and missing endpoints, never timeouts", () => {
  const request = HttpClientRequest.get("http://127.0.0.1:9/api/settings/agent-profiles/reviewer");
  assert.isTrue(
    liveMutationShouldFallBack(
      new HttpClientError.HttpClientError({
        reason: new HttpClientError.TransportError({
          request,
          description: "connection refused",
        }),
      }),
    ),
  );
  // A timeout leaves the server write outcome unknown; offline fallback would race.
  assert.isFalse(liveMutationShouldFallBack(new Cause.TimeoutError()));
});

it.effect("offline create preserves unrelated settings and writes the profile", () =>
  withFileSystem(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "aqqua-profile-cli-" });
      const settingsPath = path.join(directory, "settings.json");
      yield* writeServerSettingsToFile(settingsPath, {
        ...DEFAULT_SERVER_SETTINGS,
        addProjectBaseDirectory: "/tmp/projects",
      });
      yield* mutateProfileFile(settingsPath, {
        kind: "upsert",
        name: reviewer,
        profile: reviewerProfile,
      });
      const settings = yield* loadServerSettingsFromFileStrict(settingsPath);
      assert.equal(settings.addProjectBaseDirectory, "/tmp/projects");
      assert.equal(settings.agentProfiles[reviewer]?.model, "claude-fable-5");
    }),
  ),
);

it.effect("offline writes abort without replacing corrupted settings", () =>
  withFileSystem(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "aqqua-profile-cli-corrupt-" });
      const settingsPath = path.join(directory, "settings.json");
      const corrupt = "{ definitely not json";
      yield* fs.writeFileString(settingsPath, corrupt);
      const error = yield* Effect.flip(
        mutateProfileFile(settingsPath, {
          kind: "upsert",
          name: reviewer,
          profile: reviewerProfile,
        }),
      );
      assert.include(error.message, "could not be decoded");
      assert.equal(yield* fs.readFileString(settingsPath), corrupt);
    }),
  ),
);
