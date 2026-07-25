import { assert, it } from "@effect/vitest";
import {
  AgentProfileName,
  type AgentProfileMap,
  type ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as Result from "effect/Result";

import {
  AGENT_PROFILE_FALLBACK_MODEL,
  type AgentInstanceCandidate,
  resolveAgentProfile,
} from "./Profiles.ts";

const implementer = AgentProfileName.make("implementer");
const reviewer = AgentProfileName.make("reviewer");

const instance = (
  instanceId: string,
  driverKind: string,
  enabled = true,
): AgentInstanceCandidate => ({
  instanceId: ProviderInstanceId.make(instanceId),
  driverKind: ProviderDriverKind.make(driverKind),
  enabled,
});

const codexInstances: ReadonlyArray<AgentInstanceCandidate> = [
  instance("claudeAgent", "claudeAgent"),
  instance("codex", "codex"),
];

const resolve = (input: {
  profile?: AgentProfileName;
  profiles?: AgentProfileMap;
  instances?: ReadonlyArray<AgentInstanceCandidate>;
  projectDefaultModelSelection?: ModelSelection | null;
}) =>
  resolveAgentProfile({
    profile: input.profile ?? implementer,
    profiles: input.profiles ?? ({} as AgentProfileMap),
    instances: input.instances ?? codexInstances,
    projectDefaultModelSelection: input.projectDefaultModelSelection ?? null,
  });

const expectSuccess = <A, E>(result: Result.Result<A, E>): A => {
  assert.ok(Result.isSuccess(result), "expected profile resolution to succeed");
  return result.success;
};

const expectFailure = <A, E>(result: Result.Result<A, E>): E => {
  assert.ok(Result.isFailure(result), "expected profile resolution to fail");
  return result.failure;
};

it("resolves the default role on a machine with no agent profiles configured", () => {
  const resolved = expectSuccess(resolve({}));

  assert.equal(resolved.modelSelection.instanceId, ProviderInstanceId.make("codex"));
  assert.equal(resolved.modelSelection.model, AGENT_PROFILE_FALLBACK_MODEL);
  assert.equal(resolved.runtime, "session");
  // A delegated sub-agent has nobody to answer approval prompts while its
  // orchestrator waits, so it must not start in a mode that can block.
  assert.equal(resolved.runtimeMode, "full-access");
  assert.equal(resolved.interactionMode, "default");
  assert.equal(resolved.titlePrefix, "implementer");
});

it("rejects an unconfigured role that is not the default, listing what exists", () => {
  const failure = expectFailure(
    resolve({
      profile: reviewer,
      profiles: {
        [implementer]: { runtime: "session", runtimeMode: "auto", interactionMode: "default" },
      } as AgentProfileMap,
    }),
  );

  assert.equal(failure._tag, "AgentProfileUnknownError");
  assert.match(failure.message, /reviewer/);
  assert.match(failure.message, /implementer/);
});

it("inherits the project model only when the project targets the resolved instance", () => {
  const matching = expectSuccess(
    resolve({
      projectDefaultModelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4-codex-mini",
      },
    }),
  );
  assert.equal(matching.modelSelection.model, "gpt-5.4-codex-mini");

  // A model name from another provider is meaningless on the resolved instance.
  const mismatched = expectSuccess(
    resolve({
      projectDefaultModelSelection: {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-opus-5",
      },
    }),
  );
  assert.equal(mismatched.modelSelection.model, AGENT_PROFILE_FALLBACK_MODEL);
});

it("prefers the profile's explicit model over the project default", () => {
  const resolved = expectSuccess(
    resolve({
      profiles: {
        [implementer]: {
          runtime: "session",
          model: "gpt-5.4-codex",
          runtimeMode: "full-access",
          interactionMode: "default",
        },
      } as AgentProfileMap,
      projectDefaultModelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4-codex-mini",
      },
    }),
  );

  assert.equal(resolved.modelSelection.model, "gpt-5.4-codex");
});

it("falls back to the first enabled instance of the profile's driver", () => {
  const resolved = expectSuccess(
    resolve({
      profiles: {
        [implementer]: {
          runtime: "session",
          driver: "claudeAgent",
          runtimeMode: "full-access",
          interactionMode: "default",
        },
      } as AgentProfileMap,
      instances: [
        instance("claude_disabled", "claudeAgent", false),
        instance("claude_work", "claudeAgent"),
        instance("codex", "codex"),
      ],
    }),
  );

  assert.equal(resolved.modelSelection.instanceId, ProviderInstanceId.make("claude_work"));
});

it("reports a disabled explicit instance differently from a missing one", () => {
  const profiles = (instanceId: string) =>
    ({
      [implementer]: {
        runtime: "session",
        instanceId: ProviderInstanceId.make(instanceId),
        runtimeMode: "full-access",
        interactionMode: "default",
      },
    }) as AgentProfileMap;

  const disabled = expectFailure(
    resolve({
      profiles: profiles("codex_work"),
      instances: [instance("codex_work", "codex", false)],
    }),
  );
  assert.equal(disabled._tag, "AgentProfileUnavailableError");
  assert.match(disabled.message, /disabled/);

  const missing = expectFailure(
    resolve({ profiles: profiles("codex_missing"), instances: [instance("codex", "codex")] }),
  );
  assert.equal(missing._tag, "AgentProfileUnavailableError");
  assert.match(missing.message, /not available/);
});

it("never leaks the provider instance id into a failure message", () => {
  const failure = expectFailure(
    resolve({
      profiles: {
        [implementer]: {
          runtime: "session",
          instanceId: ProviderInstanceId.make("codex_secret_work_account"),
          runtimeMode: "full-access",
          interactionMode: "default",
        },
      } as AgentProfileMap,
      instances: [],
    }),
  );

  assert.notMatch(failure.message, /codex_secret_work_account/);
});

it("explains that no provider of the requested driver is configured", () => {
  const failure = expectFailure(resolve({ instances: [instance("claudeAgent", "claudeAgent")] }));

  assert.equal(failure._tag, "AgentProfileUnavailableError");
  assert.match(failure.message, /no 'codex' provider is configured/);
});

it("distinguishes all-disabled from none-configured for the driver fallback", () => {
  const failure = expectFailure(resolve({ instances: [instance("codex", "codex", false)] }));

  assert.match(failure.message, /every configured 'codex' provider is disabled/);
});

it("carries the configured runtime, modes, and title prefix through", () => {
  const resolved = expectSuccess(
    resolve({
      profiles: {
        [implementer]: {
          runtime: "terminal",
          runtimeMode: "approval-required",
          interactionMode: "plan",
          titlePrefix: "impl",
        },
      } as AgentProfileMap,
    }),
  );

  assert.equal(resolved.runtime, "terminal");
  assert.equal(resolved.runtimeMode, "approval-required");
  assert.equal(resolved.interactionMode, "plan");
  assert.equal(resolved.titlePrefix, "impl");
});
