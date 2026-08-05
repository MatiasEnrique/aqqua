import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  ProviderInstanceId,
  ProviderListSkillsError,
  type ServerProviderSkill,
} from "@aqqua/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { toCodexListSkillsError } from "./Drivers/CodexDriver.ts";
import { discoverClaudeSkills } from "./Drivers/ClaudeSkills.ts";
import type { ProviderInstance } from "./ProviderDriver.ts";
import * as ProviderInstanceRegistry from "./Services/ProviderInstanceRegistry.ts";

const isProviderListSkillsError = Schema.is(ProviderListSkillsError);
const unsupportedSessionCapabilities = {
  listSessions: () => Effect.succeed({ sessions: [], supported: false }),
  readSession: (() =>
    Effect.die(
      new Error("unused external-session test capability"),
    )) as ProviderInstance["readSession"],
  makeResumeCursor: (_sessionId: string) => undefined,
  matchesResumeCursor: (_sessionId: string, _cursor: unknown) => false,
};

/**
 * Mirrors the `provider.listSkills` RPC handler: look up a live instance and
 * forward the requested cwd to its captured `listSkills` capability.
 */
const listSkillsForInstance = Effect.fn("listSkillsForInstance")(function* (input: {
  readonly instanceId: ProviderInstanceId;
  readonly cwd: string;
}) {
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const instance = yield* registry.getInstance(input.instanceId);
  if (instance === undefined) {
    return yield* new ProviderListSkillsError({
      instanceId: input.instanceId,
      reason: `No provider instance bound to id '${input.instanceId}'`,
    });
  }
  const skills = yield* instance.listSkills(input.cwd);
  return { skills };
});

const makeStubInstance = (input: {
  readonly instanceId: ProviderInstanceId;
  readonly listSkills: ProviderInstance["listSkills"];
}): ProviderInstance =>
  ({
    instanceId: input.instanceId,
    driverKind: "codex" as ProviderInstance["driverKind"],
    continuationIdentity: {
      driverKind: "codex" as ProviderInstance["driverKind"],
      continuationKey: `${input.instanceId}:test`,
    },
    displayName: undefined,
    enabled: true,
    snapshot: {} as ProviderInstance["snapshot"],
    adapter: {} as ProviderInstance["adapter"],
    textGeneration: {} as ProviderInstance["textGeneration"],
    listSkills: input.listSkills,
    ...unsupportedSessionCapabilities,
  }) satisfies ProviderInstance;

const makeStubRegistry = (
  instances: ReadonlyArray<ProviderInstance>,
): ProviderInstanceRegistry.ProviderInstanceRegistry["Service"] => {
  const byId = new Map(instances.map((instance) => [instance.instanceId, instance] as const));
  return {
    getInstance: (id) => Effect.succeed(byId.get(id)),
    listInstances: Effect.succeed(instances),
    listUnavailable: Effect.succeed([]),
    streamChanges: Stream.empty,
    subscribeChanges: Effect.flatMap(PubSub.unbounded<void>(), (pubsub) =>
      PubSub.subscribe(pubsub),
    ),
  };
};

const writeSkill = Effect.fn(function* (
  skillsDir: string,
  directoryName: string,
  contents: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const skillDir = path.join(skillsDir, directoryName);
  yield* fs.makeDirectory(skillDir, { recursive: true });
  yield* fs.writeFileString(path.join(skillDir, "SKILL.md"), contents);
});

describe("provider.listSkills", () => {
  it.effect("forwards the requested cwd exactly to the instance capability", () =>
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("codex");
      const seenCwds: string[] = [];
      const instance = makeStubInstance({
        instanceId,
        listSkills: (cwd) => {
          seenCwds.push(cwd);
          return Effect.succeed([
            {
              name: "from-cwd",
              path: `${cwd}/.codex/skills/from-cwd/SKILL.md`,
              enabled: true,
              scope: "repo",
            },
          ]);
        },
      });

      const result = yield* listSkillsForInstance({
        instanceId,
        cwd: "/exact/project/cwd",
      }).pipe(
        Effect.provideService(
          ProviderInstanceRegistry.ProviderInstanceRegistry,
          makeStubRegistry([instance]),
        ),
      );

      assert.deepEqual(seenCwds, ["/exact/project/cwd"]);
      assert.equal(result.skills[0]?.path, "/exact/project/cwd/.codex/skills/from-cwd/SKILL.md");
    }),
  );

  it.effect("returns distinct repo skill sets for two cwd values", () =>
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("codex");
      const skillsByCwd: Record<string, ReadonlyArray<ServerProviderSkill>> = {
        "/repo/a": [
          {
            name: "skill-a",
            path: "/repo/a/.codex/skills/skill-a/SKILL.md",
            enabled: true,
            scope: "repo",
          },
        ],
        "/repo/b": [
          {
            name: "skill-b",
            path: "/repo/b/.codex/skills/skill-b/SKILL.md",
            enabled: true,
            scope: "repo",
          },
        ],
      };
      const instance = makeStubInstance({
        instanceId,
        listSkills: (cwd) => Effect.succeed(skillsByCwd[cwd] ?? []),
      });
      const registry = makeStubRegistry([instance]);

      const skillsA = yield* listSkillsForInstance({
        instanceId,
        cwd: "/repo/a",
      }).pipe(Effect.provideService(ProviderInstanceRegistry.ProviderInstanceRegistry, registry));
      const skillsB = yield* listSkillsForInstance({
        instanceId,
        cwd: "/repo/b",
      }).pipe(Effect.provideService(ProviderInstanceRegistry.ProviderInstanceRegistry, registry));

      assert.deepEqual(
        skillsA.skills.map((skill) => skill.name),
        ["skill-a"],
      );
      assert.deepEqual(
        skillsB.skills.map((skill) => skill.name),
        ["skill-b"],
      );
    }),
  );

  it.effect("preserves same-name repo and global entries for the client to resolve", () =>
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("codex");
      const instance = makeStubInstance({
        instanceId,
        listSkills: () =>
          Effect.succeed([
            {
              name: "review",
              path: "/home/user/.codex/skills/review/SKILL.md",
              enabled: true,
              scope: "user",
              description: "Global",
            },
            {
              name: "review",
              path: "/repo/.codex/skills/review/SKILL.md",
              enabled: true,
              scope: "repo",
              description: "Repo",
            },
          ]),
      });

      const result = yield* listSkillsForInstance({
        instanceId,
        cwd: "/repo",
      }).pipe(
        Effect.provideService(
          ProviderInstanceRegistry.ProviderInstanceRegistry,
          makeStubRegistry([instance]),
        ),
      );

      assert.equal(result.skills.length, 2);
      assert.deepEqual(
        result.skills.map((skill) => skill.scope),
        ["user", "repo"],
      );
    }),
  );

  it.effect("returns ProviderListSkillsError for an unknown provider instance", () =>
    Effect.gen(function* () {
      const missingId = ProviderInstanceId.make("missing-instance");
      const result = yield* listSkillsForInstance({
        instanceId: missingId,
        cwd: "/repo",
      }).pipe(
        Effect.provideService(
          ProviderInstanceRegistry.ProviderInstanceRegistry,
          makeStubRegistry([]),
        ),
        Effect.result,
      );

      assert.equal(result._tag, "Failure");
      if (result._tag !== "Failure") {
        return;
      }
      assert.equal(isProviderListSkillsError(result.failure), true);
      if (isProviderListSkillsError(result.failure)) {
        assert.equal(result.failure.instanceId, missingId);
        assert.match(result.failure.reason, /No provider instance bound/);
      }
    }),
  );

  it.effect("surfaces Codex listing failures as ProviderListSkillsError, not empty success", () =>
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("codex");
      const underlying = new Error("Codex CLI (`codex`) is not installed or not on PATH.");
      // Mirrors CodexDriver.listSkills: map app-server failures to the wire error.
      const instance = makeStubInstance({
        instanceId,
        listSkills: () => Effect.fail(toCodexListSkillsError(instanceId, underlying)),
      });

      const result = yield* listSkillsForInstance({
        instanceId,
        cwd: "/repo",
      }).pipe(
        Effect.provideService(
          ProviderInstanceRegistry.ProviderInstanceRegistry,
          makeStubRegistry([instance]),
        ),
        Effect.result,
      );

      assert.equal(result._tag, "Failure");
      if (result._tag !== "Failure") {
        return;
      }
      assert.equal(isProviderListSkillsError(result.failure), true);
      if (isProviderListSkillsError(result.failure)) {
        assert.equal(result.failure.instanceId, instanceId);
        assert.match(result.failure.reason, /Codex skills\/list failed/);
        assert.match(result.failure.reason, /not installed/);
        // Failure is the declared wire error, not a successful empty list.
        assert.equal("skills" in result.failure, false);
      }

      // Mapping helper itself must produce a non-empty reason on the wire error.
      const mapped = toCodexListSkillsError(instanceId, underlying);
      assert.equal(isProviderListSkillsError(mapped), true);
      assert.equal(mapped.instanceId, instanceId);
      assert.ok(mapped.reason.trim().length > 0);
    }),
  );
});

it.layer(NodeServices.layer)("Claude listSkills cwd discovery", (it) => {
  it.effect("returns project skills for the requested cwd with project-over-user precedence", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "aqqua-provider-list-skills-" });
      const configDir = path.join(tempDir, "claude-home");
      const workspaceA = path.join(tempDir, "workspace-a");
      const workspaceB = path.join(tempDir, "workspace-b");

      yield* writeSkill(
        path.join(configDir, "skills"),
        "shared",
        ["---", "name: shared", "description: User shared.", "---"].join("\n"),
      );
      yield* writeSkill(
        path.join(workspaceA, ".claude", "skills"),
        "shared",
        ["---", "name: shared", "description: Project A shared.", "---"].join("\n"),
      );
      yield* writeSkill(
        path.join(workspaceA, ".claude", "skills"),
        "only-a",
        ["---", "name: only-a", "description: Only in A.", "---"].join("\n"),
      );
      yield* writeSkill(
        path.join(workspaceB, ".claude", "skills"),
        "only-b",
        ["---", "name: only-b", "description: Only in B.", "---"].join("\n"),
      );

      const skillsA = yield* discoverClaudeSkills({ homePath: configDir }, workspaceA);
      const skillsB = yield* discoverClaudeSkills({ homePath: configDir }, workspaceB);

      const sharedA = skillsA.find((skill) => skill.name === "shared");
      assert.equal(sharedA?.scope, "project");
      assert.equal(sharedA?.description, "Project A shared.");
      assert.deepEqual(skillsA.map((skill) => skill.name).toSorted(), ["only-a", "shared"]);
      assert.deepEqual(skillsB.map((skill) => skill.name).toSorted(), ["only-b", "shared"]);
      assert.equal(skillsB.find((skill) => skill.name === "shared")?.scope, "user");
    }),
  );
});
