import { describe, expect, it } from "vite-plus/test";
import type { ServerProviderSkill } from "@aqqua/contracts";

import {
  classifyProviderSkillSource,
  compareProviderSkillPreference,
  dedupeProviderSkillsByCanonicalName,
  formatProviderSkillDisplayName,
  formatProviderSkillInstallSource,
  formatProviderSkillSourceBadge,
  formatProviderSkillSourceDetail,
  providerSkillStableId,
  resolveProviderWorkspaceSkills,
} from "./providerSkillPresentation.ts";

function makeSkill(
  input: Partial<ServerProviderSkill> & Pick<ServerProviderSkill, "name">,
): ServerProviderSkill {
  return {
    path: `/tmp/${input.name}/SKILL.md`,
    enabled: true,
    ...input,
  } satisfies ServerProviderSkill;
}

describe("classifyProviderSkillSource", () => {
  it("classifies repo, project, workspace, and local scopes as repo", () => {
    for (const scope of ["repo", "project", "workspace", "local", "REPO", " Project "]) {
      expect(
        classifyProviderSkillSource({
          path: `/workspace/.agents/skills/ui/SKILL.md`,
          scope,
        }),
      ).toBe("repo");
      expect(
        formatProviderSkillSourceBadge({
          path: `/workspace/.agents/skills/ui/SKILL.md`,
          scope,
        }),
      ).toBe("Repo");
    }
  });

  it("classifies user, personal, system, app, and other scopes as global", () => {
    expect(
      classifyProviderSkillSource({
        path: "/Users/me/.agents/skills/ui/SKILL.md",
        scope: "user",
      }),
    ).toBe("global");
    expect(
      classifyProviderSkillSource({
        path: "/Users/me/.agents/skills/ui/SKILL.md",
        scope: "personal",
      }),
    ).toBe("global");
    expect(
      classifyProviderSkillSource({
        path: "/usr/local/share/skills/ui/SKILL.md",
        scope: "system",
      }),
    ).toBe("global");
    expect(
      classifyProviderSkillSource({
        path: "/Users/me/.codex/plugins/cache/openai-curated/github/skills/gh-fix-ci/SKILL.md",
        scope: "user",
      }),
    ).toBe("global");
    expect(
      classifyProviderSkillSource({
        path: "/opt/skills/ui/SKILL.md",
      }),
    ).toBe("global");
    expect(
      formatProviderSkillSourceBadge({
        path: "/Users/me/.agents/skills/ui/SKILL.md",
        scope: "user",
      }),
    ).toBe("Global");
  });
});

describe("formatProviderSkillSourceDetail", () => {
  it("preserves finer global provenance", () => {
    expect(
      formatProviderSkillSourceDetail({
        path: "/Users/me/.codex/plugins/cache/openai-curated/github/skills/gh-fix-ci/SKILL.md",
        scope: "user",
      }),
    ).toBe("Global · App");
    expect(
      formatProviderSkillSourceDetail({
        path: "/usr/local/share/skills/imagegen/SKILL.md",
        scope: "system",
      }),
    ).toBe("Global · System");
    expect(
      formatProviderSkillSourceDetail({
        path: "/Users/me/.agents/skills/agent-browser/SKILL.md",
        scope: "user",
      }),
    ).toBe("Global · Personal");
  });

  it("keeps repo badge compact when install source is project", () => {
    expect(
      formatProviderSkillSourceDetail({
        path: "/workspace/.codex/skills/review-follow-up/SKILL.md",
        scope: "project",
      }),
    ).toBe("Repo");
  });
});

describe("formatProviderSkillDisplayName / install source", () => {
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

  it("maps standard install sources", () => {
    expect(
      formatProviderSkillInstallSource({
        path: "/Users/julius/.codex/plugins/cache/openai-curated/github/skills/gh-fix-ci/SKILL.md",
        scope: "user",
      }),
    ).toBe("App");
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

describe("dedupeProviderSkillsByCanonicalName", () => {
  it("keeps the repo skill and drops the global on name conflict regardless of order", () => {
    const repo = makeSkill({
      name: "ui",
      scope: "project",
      path: "/workspace/.agents/skills/ui/SKILL.md",
    });
    const global = makeSkill({
      name: "ui",
      scope: "user",
      path: "/Users/me/.agents/skills/ui/SKILL.md",
    });

    expect(dedupeProviderSkillsByCanonicalName([global, repo]).map((skill) => skill.path)).toEqual([
      repo.path,
    ]);
    expect(dedupeProviderSkillsByCanonicalName([repo, global]).map((skill) => skill.path)).toEqual([
      repo.path,
    ]);
    expect(
      dedupeProviderSkillsByCanonicalName([global, repo]).some(
        (skill) => skill.path === global.path,
      ),
    ).toBe(false);
  });

  it("keeps non-conflicting globals", () => {
    const repo = makeSkill({
      name: "ui",
      scope: "repo",
      path: "/workspace/.agents/skills/ui/SKILL.md",
    });
    const global = makeSkill({
      name: "agent-browser",
      scope: "user",
      path: "/Users/me/.agents/skills/agent-browser/SKILL.md",
    });

    expect(
      dedupeProviderSkillsByCanonicalName([global, repo])
        .map((skill) => skill.name)
        .sort(),
    ).toEqual(["agent-browser", "ui"]);
  });

  it("uses path as a stable same-scope tie breaker", () => {
    const laterPath = makeSkill({
      name: "ui",
      scope: "project",
      path: "/workspace/b/ui/SKILL.md",
    });
    const earlierPath = makeSkill({
      name: "ui",
      scope: "project",
      path: "/workspace/a/ui/SKILL.md",
    });

    expect(
      dedupeProviderSkillsByCanonicalName([laterPath, earlierPath]).map((skill) => skill.path),
    ).toEqual([earlierPath.path]);
    expect(
      dedupeProviderSkillsByCanonicalName([earlierPath, laterPath]).map((skill) => skill.path),
    ).toEqual([earlierPath.path]);
    expect(compareProviderSkillPreference(earlierPath, laterPath)).toBeLessThan(0);
  });

  it("dedupes before a mobile-style 20-item limit would apply", () => {
    const skills: ServerProviderSkill[] = [];
    for (let index = 0; index < 25; index += 1) {
      const name = `skill-${String(index).padStart(2, "0")}`;
      skills.push(
        makeSkill({
          name,
          scope: "user",
          path: `/home/skills/${name}/SKILL.md`,
        }),
      );
    }
    // Shadow the first few globals with repo skills after they appear.
    for (let index = 0; index < 5; index += 1) {
      const name = `skill-${String(index).padStart(2, "0")}`;
      skills.push(
        makeSkill({
          name,
          scope: "project",
          path: `/workspace/skills/${name}/SKILL.md`,
        }),
      );
    }

    const deduped = dedupeProviderSkillsByCanonicalName(skills);
    expect(skills).toHaveLength(30);
    expect(deduped).toHaveLength(25);
    expect(deduped.slice(0, 20)).toHaveLength(20);
    expect(deduped.find((skill) => skill.name === "skill-00")?.path).toBe(
      "/workspace/skills/skill-00/SKILL.md",
    );
    expect(
      deduped.slice(0, 20).some((skill) => skill.path.startsWith("/home/skills/skill-00/")),
    ).toBe(false);
  });
});

describe("resolveProviderWorkspaceSkills", () => {
  it("uses the workspace query as the source of truth when present", () => {
    const querySkills = [
      makeSkill({ name: "repo-ui", scope: "project", path: "/ws/repo-ui/SKILL.md" }),
    ];
    const snapshotSkills = [
      makeSkill({ name: "stale-repo", scope: "project", path: "/other/stale/SKILL.md" }),
      makeSkill({ name: "global-ui", scope: "user", path: "/home/global-ui/SKILL.md" }),
    ];

    expect(
      resolveProviderWorkspaceSkills({
        querySkills,
        queryError: null,
        queryPending: false,
        snapshotSkills,
      }).skills.map((skill) => skill.name),
    ).toEqual(["repo-ui"]);
  });

  it("falls back to global-only snapshot skills while pending", () => {
    const snapshotSkills = [
      makeSkill({ name: "stale-repo", scope: "project", path: "/other/stale/SKILL.md" }),
      makeSkill({ name: "global-ui", scope: "user", path: "/home/global-ui/SKILL.md" }),
    ];

    const resolved = resolveProviderWorkspaceSkills({
      querySkills: null,
      queryError: null,
      queryPending: true,
      snapshotSkills,
    });

    expect(resolved.isPending).toBe(true);
    expect(resolved.error).toBeNull();
    expect(resolved.skills.map((skill) => skill.name)).toEqual(["global-ui"]);
  });

  it("surfaces query failures instead of an empty success", () => {
    const resolved = resolveProviderWorkspaceSkills({
      querySkills: null,
      queryError: "Failed to list skills for provider instance 'codex'",
      queryPending: false,
      snapshotSkills: [
        makeSkill({ name: "global-ui", scope: "user", path: "/home/global-ui/SKILL.md" }),
      ],
    });

    expect(resolved.skills).toEqual([]);
    expect(resolved.error).toContain("Failed to list skills");
    expect(resolved.isPending).toBe(false);
  });
});

describe("providerSkillStableId", () => {
  it("includes installation path so duplicate names cannot collide as React keys", () => {
    const left = makeSkill({ name: "ui", path: "/a/ui/SKILL.md" });
    const right = makeSkill({ name: "ui", path: "/b/ui/SKILL.md" });
    expect(providerSkillStableId(left, "codex")).not.toBe(providerSkillStableId(right, "codex"));
    expect(providerSkillStableId(left, "codex")).toContain(left.path);
  });
});
