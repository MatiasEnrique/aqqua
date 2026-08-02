import { describe, expect, it } from "vite-plus/test";
import type { ServerProviderSkill } from "@aqqua/contracts";

import {
  classifyProviderSkillSource,
  dedupeProviderSkillsByCanonicalName,
  formatProviderSkillDisplayName,
  formatProviderSkillInstallSource,
  formatProviderSkillSourceBadge,
  formatProviderSkillSourceDetail,
} from "./providerSkillPresentation";

function makeSkill(
  input: Partial<ServerProviderSkill> & Pick<ServerProviderSkill, "name">,
): ServerProviderSkill {
  return {
    path: `/tmp/${input.name}/SKILL.md`,
    enabled: true,
    ...input,
  } satisfies ServerProviderSkill;
}

describe("formatProviderSkillDisplayName", () => {
  it("prefers the provider display name", () => {
    expect(
      formatProviderSkillDisplayName({
        name: "review-follow-up",
        displayName: "Review Follow-up",
      }),
    ).toBe("Review Follow-up");
  });

  it("falls back to a title-cased skill name", () => {
    expect(
      formatProviderSkillDisplayName({
        name: "review-follow-up",
      }),
    ).toBe("Review Follow Up");
  });
});

describe("formatProviderSkillInstallSource", () => {
  it("marks plugin-backed skills as app installs", () => {
    expect(
      formatProviderSkillInstallSource({
        path: "/Users/julius/.codex/plugins/cache/openai-curated/github/skills/gh-fix-ci/SKILL.md",
        scope: "user",
      }),
    ).toBe("App");
  });

  it("maps standard scopes to user-facing labels", () => {
    expect(
      formatProviderSkillInstallSource({
        path: "/Users/julius/.agents/skills/agent-browser/SKILL.md",
        scope: "user",
      }),
    ).toBe("Personal");
    expect(
      formatProviderSkillInstallSource({
        path: "/usr/local/share/codex/skills/imagegen/SKILL.md",
        scope: "system",
      }),
    ).toBe("System");
    expect(
      formatProviderSkillInstallSource({
        path: "/workspace/.codex/skills/review-follow-up/SKILL.md",
        scope: "project",
      }),
    ).toBe("Project");
  });
});

describe("Repo/Global presentation", () => {
  it("exposes Repo and Global badges for web rows", () => {
    const repo = makeSkill({
      name: "ui",
      scope: "workspace",
      path: "/workspace/.agents/skills/ui/SKILL.md",
    });
    const global = makeSkill({
      name: "agent-browser",
      scope: "user",
      path: "/Users/me/.agents/skills/agent-browser/SKILL.md",
    });

    expect(formatProviderSkillSourceBadge(repo)).toBe("Repo");
    expect(formatProviderSkillSourceBadge(global)).toBe("Global");
    expect(formatProviderSkillSourceDetail(global)).toBe("Global · Personal");
    expect(classifyProviderSkillSource(repo)).toBe("repo");
  });

  it("dedupes repo over global before rendering", () => {
    const repo = makeSkill({
      name: "ui",
      scope: "local",
      path: "/workspace/.agents/skills/ui/SKILL.md",
    });
    const global = makeSkill({
      name: "ui",
      scope: "user",
      path: "/Users/me/.agents/skills/ui/SKILL.md",
    });

    expect(dedupeProviderSkillsByCanonicalName([global, repo])).toEqual([repo]);
  });
});
