import { EnvironmentId, ProviderInstanceId, type ServerProviderSkill } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

// Manifest behind @t3tools/client-runtime/state/provider-skills (pre-existing export).
import packageJson from "../../package.json" with { type: "json" };
import {
  createUseProviderWorkspaceSkills,
  isProviderWorkspaceSkillsTargetReady,
  normalizeProviderWorkspaceSkillsTarget,
  PROVIDER_WORKSPACE_SKILLS_LOADING_LABEL,
  providerWorkspaceSkillsQueryKey,
  resolveProviderWorkspaceSkillsInstanceId,
  shouldShowProviderWorkspaceSkillsLoadingFooter,
  type ProviderWorkspaceSkillsQueryView,
} from "./providerSkills.ts";

function makeSkill(
  input: Partial<ServerProviderSkill> & Pick<ServerProviderSkill, "name">,
): ServerProviderSkill {
  return {
    path: `/tmp/${input.name}/SKILL.md`,
    enabled: true,
    ...input,
  } satisfies ServerProviderSkill;
}

const eagerUseMemo = <T>(factory: () => T, _deps: readonly unknown[]): T => factory();

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

describe("createUseProviderWorkspaceSkills", () => {
  it("skips the query atom until environment, instance, and cwd are ready", () => {
    const listSkills = vi.fn(() => "atom" as const);
    const useEnvironmentQuery = vi.fn(
      (_atom: "atom" | null): ProviderWorkspaceSkillsQueryView => ({
        data: null,
        error: null,
        isPending: false,
        refresh: () => undefined,
      }),
    );

    const useProviderWorkspaceSkills = createUseProviderWorkspaceSkills({
      useMemo: eagerUseMemo,
      useEnvironmentQuery,
      listSkills,
    });

    const state = useProviderWorkspaceSkills({
      environmentId: EnvironmentId.make("env-1"),
      instanceId: ProviderInstanceId.make("codex"),
      cwd: "   ",
    });

    expect(listSkills).not.toHaveBeenCalled();
    expect(useEnvironmentQuery).toHaveBeenCalledWith(null);
    expect(state.skills).toEqual([]);
    expect(state.isPending).toBe(false);
    expect(state.error).toBeNull();
  });

  it("queries listSkills with the normalized ready target", () => {
    const listSkills = vi.fn(() => "atom" as const);
    const useEnvironmentQuery = vi.fn(
      (_atom: "atom" | null): ProviderWorkspaceSkillsQueryView => ({
        data: {
          skills: [makeSkill({ name: "repo-ui", scope: "project", path: "/ws/ui/SKILL.md" })],
        },
        error: null,
        isPending: false,
        refresh: () => undefined,
      }),
    );

    const useProviderWorkspaceSkills = createUseProviderWorkspaceSkills({
      useMemo: eagerUseMemo,
      useEnvironmentQuery,
      listSkills,
    });

    const environmentId = EnvironmentId.make("env-1");
    const instanceId = ProviderInstanceId.make("codex");
    const state = useProviderWorkspaceSkills({
      environmentId,
      instanceId,
      cwd: " /workspace/project ",
    });

    expect(listSkills).toHaveBeenCalledWith({
      environmentId,
      input: {
        instanceId,
        cwd: "/workspace/project",
      },
    });
    expect(useEnvironmentQuery).toHaveBeenCalledWith("atom");
    expect(state.skills.map((skill) => skill.name)).toEqual(["repo-ui"]);
    expect(state.isPending).toBe(false);
    expect(state.error).toBeNull();
  });

  it("keeps global-only snapshot fallback while the query is pending", () => {
    const useProviderWorkspaceSkills = createUseProviderWorkspaceSkills({
      useMemo: eagerUseMemo,
      listSkills: () => "atom" as const,
      useEnvironmentQuery: () => ({
        data: null,
        error: null,
        isPending: true,
        refresh: () => undefined,
      }),
    });

    const state = useProviderWorkspaceSkills(
      {
        environmentId: EnvironmentId.make("env-1"),
        instanceId: ProviderInstanceId.make("codex"),
        cwd: "/workspace",
      },
      [
        makeSkill({ name: "repo-only", scope: "project", path: "/ws/repo/SKILL.md" }),
        makeSkill({ name: "global-only", scope: "user", path: "/home/global/SKILL.md" }),
      ],
    );

    expect(state.skills.map((skill) => skill.name)).toEqual(["global-only"]);
    expect(state.isPending).toBe(true);
    expect(state.error).toBeNull();
  });

  it("surfaces query errors and does not keep snapshot skills", () => {
    const useProviderWorkspaceSkills = createUseProviderWorkspaceSkills({
      useMemo: eagerUseMemo,
      listSkills: () => "atom" as const,
      useEnvironmentQuery: () => ({
        data: null,
        error: "Failed to list skills for provider instance 'codex'",
        isPending: false,
        refresh: () => undefined,
      }),
    });

    const state = useProviderWorkspaceSkills(
      {
        environmentId: EnvironmentId.make("env-1"),
        instanceId: ProviderInstanceId.make("codex"),
        cwd: "/workspace",
      },
      [makeSkill({ name: "global-only", scope: "user", path: "/home/global/SKILL.md" })],
    );

    expect(state.skills).toEqual([]);
    expect(state.isPending).toBe(false);
    expect(state.error).toContain("Failed to list skills");
  });

  it("forwards refresh from the surface query binding", () => {
    const refresh = vi.fn();
    const useProviderWorkspaceSkills = createUseProviderWorkspaceSkills({
      useMemo: eagerUseMemo,
      listSkills: () => "atom" as const,
      useEnvironmentQuery: () => ({
        data: null,
        error: null,
        isPending: false,
        refresh,
      }),
    });

    const state = useProviderWorkspaceSkills({
      environmentId: EnvironmentId.make("env-1"),
      instanceId: ProviderInstanceId.make("codex"),
      cwd: "/workspace",
    });

    state.refresh();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("treats queryPending as false when the target is not ready even if the query view is pending", () => {
    const useProviderWorkspaceSkills = createUseProviderWorkspaceSkills({
      useMemo: eagerUseMemo,
      listSkills: () => "atom" as const,
      useEnvironmentQuery: () => ({
        data: null,
        error: null,
        isPending: true,
        refresh: () => undefined,
      }),
    });

    const state = useProviderWorkspaceSkills({
      environmentId: null,
      instanceId: null,
      cwd: null,
    });

    expect(state.isPending).toBe(false);
  });
});

/**
 * Regression for live-dev Vite failure:
 * [plugin:builtin:vite-resolve] "./state/use-provider-workspace-skills" is not
 * exported under the conditions ["module", "browser", "development", "import"]
 * from apps/web/node_modules/@t3tools/client-runtime
 *
 * New package subpaths added mid-session are not a safe HMR seam: Vite caches the
 * package export map. Shared factory must ship on the pre-existing provider-skills export.
 */
describe('package export map must not reintroduce "./state/use-provider-workspace-skills" Vite resolve failure', () => {
  it("exports createUseProviderWorkspaceSkills only via the pre-existing state/provider-skills subpath", () => {
    const exportsMap = packageJson.exports as Record<string, unknown>;
    const devDependencies = packageJson.devDependencies as Record<string, string>;
    expect(exportsMap["./state/provider-skills"]).toEqual({
      types: "./src/state/providerSkills.ts",
      default: "./src/state/providerSkills.ts",
    });
    expect("./state/use-provider-workspace-skills" in exportsMap).toBe(false);
    expect("peerDependencies" in packageJson).toBe(false);
    expect("react" in devDependencies).toBe(false);
    expect("@types/react" in devDependencies).toBe(false);
    expect(typeof createUseProviderWorkspaceSkills).toBe("function");
  });
});
