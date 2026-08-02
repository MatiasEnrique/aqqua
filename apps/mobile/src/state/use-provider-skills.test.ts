import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import type { ServerProviderSkill } from "@aqqua/contracts";
import {
  createUseProviderWorkspaceSkills,
  dedupeProviderSkillsByCanonicalName,
  formatProviderSkillSourceBadge,
  PROVIDER_WORKSPACE_SKILLS_LOADING_LABEL,
  resolveProviderWorkspaceSkills,
  shouldShowProviderWorkspaceSkillsLoadingFooter,
} from "@aqqua/client-runtime/state/provider-skills";

function makeSkill(
  input: Partial<ServerProviderSkill> & Pick<ServerProviderSkill, "name">,
): ServerProviderSkill {
  return {
    path: `/tmp/${input.name}/SKILL.md`,
    enabled: true,
    ...input,
  } satisfies ServerProviderSkill;
}

const bindingDir = dirname(fileURLToPath(import.meta.url));
const mobileBindingSource = readFileSync(join(bindingDir, "use-provider-skills.ts"), "utf8");
const webBindingSource = readFileSync(
  join(bindingDir, "../../../web/src/lib/providerSkillsState.ts"),
  "utf8",
);

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

/**
 * Regression for:
 * [plugin:builtin:vite-resolve] "./state/use-provider-workspace-skills" is not
 * exported under the conditions ["module", "browser", "development", "import"]
 * from apps/web/node_modules/@aqqua/client-runtime
 *
 * Both surfaces must bind the shared factory through the pre-existing
 * state/provider-skills export so a cached Vite package export map still resolves.
 */
describe("web and mobile bindings use pre-existing state/provider-skills export", () => {
  it("imports createUseProviderWorkspaceSkills from state/provider-skills with injected useMemo", () => {
    // Avoid importing the binding modules here: mobile pulls connection/runtime → RN.
    expect(typeof createUseProviderWorkspaceSkills).toBe("function");

    for (const [label, source] of [
      ["mobile", mobileBindingSource],
      ["web", webBindingSource],
    ] as const) {
      expect(source, label).toContain('from "@aqqua/client-runtime/state/provider-skills"');
      expect(source, label).not.toContain("use-provider-workspace-skills");
      expect(source, label).toContain("createUseProviderWorkspaceSkills({");
      expect(source, label).toContain("useMemo");
      expect(source, label).toContain("useEnvironmentQuery");
      expect(source, label).toContain("listSkills: providerSkillsEnvironment.listSkills");
      expect(source, label).toContain("export const useProviderWorkspaceSkills =");
    }
  });
});
