import { describe, expect, it } from "vite-plus/test";
import type { ServerProviderSkill } from "@t3tools/contracts";
import {
  dedupeProviderSkillsByCanonicalName,
  formatProviderSkillSourceBadge,
  PROVIDER_WORKSPACE_SKILLS_LOADING_LABEL,
  resolveProviderWorkspaceSkills,
  shouldShowProviderWorkspaceSkillsLoadingFooter,
} from "@t3tools/client-runtime/state/provider-skills";

function makeSkill(
  input: Partial<ServerProviderSkill> & Pick<ServerProviderSkill, "name">,
): ServerProviderSkill {
  return {
    path: `/tmp/${input.name}/SKILL.md`,
    enabled: true,
    ...input,
  } satisfies ServerProviderSkill;
}

describe("mobile provider skill presentation", () => {
  it("exposes Repo and Global badges for mobile rows", () => {
    expect(
      formatProviderSkillSourceBadge({
        path: "/workspace/.agents/skills/ui/SKILL.md",
        scope: "project",
      }),
    ).toBe("Repo");
    expect(
      formatProviderSkillSourceBadge({
        path: "/Users/me/.agents/skills/agent-browser/SKILL.md",
        scope: "user",
      }),
    ).toBe("Global");
  });

  it("dedupes before a 20-item mobile picker limit", () => {
    const skills = [
      ...Array.from({ length: 22 }, (_, index) =>
        makeSkill({
          name: `skill-${index}`,
          scope: "user",
          path: `/home/skills/skill-${index}/SKILL.md`,
        }),
      ),
      makeSkill({
        name: "skill-0",
        scope: "repo",
        path: "/workspace/skills/skill-0/SKILL.md",
      }),
    ];

    const deduped = dedupeProviderSkillsByCanonicalName(skills);
    expect(deduped).toHaveLength(22);
    expect(deduped.find((skill) => skill.name === "skill-0")?.path).toBe(
      "/workspace/skills/skill-0/SKILL.md",
    );
    expect(deduped.slice(0, 20)).toHaveLength(20);
    expect(
      deduped.slice(0, 20).some((skill) => skill.path.startsWith("/home/skills/skill-0/")),
    ).toBe(false);
  });

  it("keeps global-only snapshot fallback while workspace skills load", () => {
    const resolved = resolveProviderWorkspaceSkills({
      querySkills: null,
      queryError: null,
      queryPending: true,
      snapshotSkills: [
        makeSkill({ name: "repo-only", scope: "project", path: "/ws/repo/SKILL.md" }),
        makeSkill({ name: "global-only", scope: "user", path: "/home/global/SKILL.md" }),
      ],
    });

    expect(resolved.skills.map((skill) => skill.name)).toEqual(["global-only"]);
    expect(resolved.isPending).toBe(true);
    // Fallback rows do not hide the non-actionable loading footer.
    expect(
      shouldShowProviderWorkspaceSkillsLoadingFooter({
        isPending: resolved.isPending,
        isSkillTrigger: true,
      }),
    ).toBe(true);
    expect(PROVIDER_WORKSPACE_SKILLS_LOADING_LABEL).toBe("Searching workspace skills…");
  });
});
