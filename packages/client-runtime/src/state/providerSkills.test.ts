import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";

import {
  isProviderWorkspaceSkillsTargetReady,
  normalizeProviderWorkspaceSkillsTarget,
  PROVIDER_WORKSPACE_SKILLS_LOADING_LABEL,
  providerWorkspaceSkillsQueryKey,
  resolveProviderWorkspaceSkillsInstanceId,
  shouldShowProviderWorkspaceSkillsLoadingFooter,
} from "./providerSkills.ts";

describe("providerWorkspaceSkillsQueryKey", () => {
  it("selects a distinct query when cwd changes", () => {
    const environmentId = EnvironmentId.make("env-1");
    const instanceId = ProviderInstanceId.make("codex");
    const rootKey = providerWorkspaceSkillsQueryKey({
      environmentId,
      instanceId,
      cwd: "/workspace/project",
    });
    const worktreeKey = providerWorkspaceSkillsQueryKey({
      environmentId,
      instanceId,
      cwd: "/workspace/project/.worktrees/feature",
    });

    expect(rootKey).not.toBe(worktreeKey);
    expect(rootKey).toContain("/workspace/project");
    expect(worktreeKey).toContain("/workspace/project/.worktrees/feature");
  });

  it("selects a distinct query when provider instance changes", () => {
    const environmentId = EnvironmentId.make("env-1");
    const cwd = "/workspace/project";
    const codexKey = providerWorkspaceSkillsQueryKey({
      environmentId,
      instanceId: ProviderInstanceId.make("codex"),
      cwd,
    });
    const claudeKey = providerWorkspaceSkillsQueryKey({
      environmentId,
      instanceId: ProviderInstanceId.make("claude"),
      cwd,
    });

    expect(codexKey).not.toBe(claudeKey);
  });

  it("selects a distinct query when environment changes", () => {
    const instanceId = ProviderInstanceId.make("codex");
    const cwd = "/workspace/project";
    const left = providerWorkspaceSkillsQueryKey({
      environmentId: EnvironmentId.make("env-a"),
      instanceId,
      cwd,
    });
    const right = providerWorkspaceSkillsQueryKey({
      environmentId: EnvironmentId.make("env-b"),
      instanceId,
      cwd,
    });

    expect(left).not.toBe(right);
  });
});

describe("normalizeProviderWorkspaceSkillsTarget", () => {
  it("treats blank cwd as missing and only enables ready targets", () => {
    const environmentId = EnvironmentId.make("env-1");
    const instanceId = ProviderInstanceId.make("codex");

    expect(
      isProviderWorkspaceSkillsTargetReady(
        normalizeProviderWorkspaceSkillsTarget({
          environmentId,
          instanceId,
          cwd: "   ",
        }),
      ),
    ).toBe(false);

    expect(
      isProviderWorkspaceSkillsTargetReady(
        normalizeProviderWorkspaceSkillsTarget({
          environmentId,
          instanceId,
          cwd: "/workspace",
        }),
      ),
    ).toBe(true);
  });
});

describe("resolveProviderWorkspaceSkillsInstanceId", () => {
  it("uses the resolved status identity for default-provider fallback paths", () => {
    // Preferred thread identity can be null while status resolves to default.
    const preferredInstanceId: ProviderInstanceId | null = null;
    const resolvedStatus = { instanceId: ProviderInstanceId.make("codex") };

    expect(preferredInstanceId).toBeNull();
    expect(resolveProviderWorkspaceSkillsInstanceId(resolvedStatus)).toBe(
      ProviderInstanceId.make("codex"),
    );
    expect(resolveProviderWorkspaceSkillsInstanceId(null)).toBeNull();
  });
});

describe("shouldShowProviderWorkspaceSkillsLoadingFooter", () => {
  it("stays visible while pending even when global fallback rows exist", () => {
    expect(
      shouldShowProviderWorkspaceSkillsLoadingFooter({
        isPending: true,
        isSkillTrigger: true,
      }),
    ).toBe(true);
    expect(
      shouldShowProviderWorkspaceSkillsLoadingFooter({
        isPending: false,
        isSkillTrigger: true,
      }),
    ).toBe(false);
    expect(
      shouldShowProviderWorkspaceSkillsLoadingFooter({
        isPending: true,
        isSkillTrigger: false,
      }),
    ).toBe(false);
    expect(PROVIDER_WORKSPACE_SKILLS_LOADING_LABEL).toBe("Searching workspace skills…");
  });
});
