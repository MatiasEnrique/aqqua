import { describe, expect, it } from "vite-plus/test";

import type { ServerProviderSkill } from "@t3tools/contracts";

import { searchProviderSkills } from "./providerSkillSearch";

function makeSkill(input: Partial<ServerProviderSkill> & Pick<ServerProviderSkill, "name">) {
  return {
    path: `/tmp/${input.name}/SKILL.md`,
    enabled: true,
    ...input,
  } satisfies ServerProviderSkill;
}

describe("searchProviderSkills", () => {
  it("moves exact ui matches ahead of broader ui matches", () => {
    const skills = [
      makeSkill({
        name: "agent-browser",
        displayName: "Agent Browser",
        shortDescription: "Browser automation CLI for AI agents",
      }),
      makeSkill({
        name: "building-native-ui",
        displayName: "Building Native Ui",
        shortDescription: "Complete guide for building beautiful apps with Expo Router",
      }),
      makeSkill({
        name: "ui",
        displayName: "Ui",
        shortDescription: "Explore, build, and refine UI.",
      }),
    ];

    expect(searchProviderSkills(skills, "ui").map((skill) => skill.name)).toEqual([
      "ui",
      "building-native-ui",
    ]);
  });

  it("uses fuzzy ranking for abbreviated queries", () => {
    const skills = [
      makeSkill({ name: "gh-fix-ci", displayName: "Gh Fix Ci" }),
      makeSkill({ name: "github", displayName: "Github" }),
      makeSkill({ name: "agent-browser", displayName: "Agent Browser" }),
    ];

    expect(searchProviderSkills(skills, "gfc").map((skill) => skill.name)).toEqual(["gh-fix-ci"]);
  });

  it("omits disabled skills from results", () => {
    const skills = [
      makeSkill({ name: "ui", displayName: "Ui", enabled: false }),
      makeSkill({ name: "frontend-design", displayName: "Frontend Design" }),
    ];

    expect(searchProviderSkills(skills, "ui").map((skill) => skill.name)).toEqual([]);
  });

  it("dedupes repo over global before ranking and limits", () => {
    const skills = [
      makeSkill({
        name: "ui",
        scope: "user",
        path: "/home/.agents/skills/ui/SKILL.md",
        shortDescription: "Global UI",
      }),
      makeSkill({
        name: "ui",
        scope: "project",
        path: "/workspace/.agents/skills/ui/SKILL.md",
        shortDescription: "Repo UI",
      }),
      makeSkill({
        name: "agent-browser",
        scope: "user",
        path: "/home/.agents/skills/agent-browser/SKILL.md",
      }),
    ];

    const results = searchProviderSkills(skills, "ui", 20);
    expect(results.map((skill) => skill.path)).toEqual(["/workspace/.agents/skills/ui/SKILL.md"]);
    expect(results.some((skill) => skill.path.includes("/home/.agents/skills/ui/"))).toBe(false);
  });
});
