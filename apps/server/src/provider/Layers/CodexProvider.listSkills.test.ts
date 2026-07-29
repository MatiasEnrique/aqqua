import { assert, describe, it } from "@effect/vitest";
import type * as CodexSchema from "effect-codex-app-server/schema";

import { parseCodexSkillsListResponse } from "./CodexProvider.ts";

function skill(
  input: Partial<CodexSchema.V2SkillsListResponse__SkillMetadata> &
    Pick<CodexSchema.V2SkillsListResponse__SkillMetadata, "name" | "path" | "scope">,
): CodexSchema.V2SkillsListResponse__SkillMetadata {
  return {
    description: input.description ?? `${input.name} description`,
    enabled: input.enabled ?? true,
    name: input.name,
    path: input.path,
    scope: input.scope,
    ...(input.shortDescription !== undefined ? { shortDescription: input.shortDescription } : {}),
    ...(input.interface !== undefined ? { interface: input.interface } : {}),
  };
}

describe("parseCodexSkillsListResponse", () => {
  it("returns only skills for the exact requested cwd and does not flatten others", () => {
    const cwdA = "/tmp/workspace-a";
    const cwdB = "/tmp/workspace-b";
    const response = {
      data: [
        {
          cwd: cwdA,
          errors: [],
          skills: [
            skill({
              name: "deploy",
              path: `${cwdA}/.codex/skills/deploy/SKILL.md`,
              scope: "repo",
            }),
          ],
        },
        {
          cwd: cwdB,
          errors: [],
          skills: [
            skill({
              name: "ship",
              path: `${cwdB}/.codex/skills/ship/SKILL.md`,
              scope: "repo",
            }),
          ],
        },
      ],
    } satisfies CodexSchema.V2SkillsListResponse;

    const skillsA = parseCodexSkillsListResponse(response, cwdA);
    const skillsB = parseCodexSkillsListResponse(response, cwdB);

    assert.deepEqual(
      skillsA.map((entry) => entry.name),
      ["deploy"],
    );
    assert.deepEqual(
      skillsB.map((entry) => entry.name),
      ["ship"],
    );
  });

  it("returns an empty list when no entry matches the requested cwd", () => {
    const response = {
      data: [
        {
          cwd: "/tmp/other",
          errors: [],
          skills: [
            skill({
              name: "unrelated",
              path: "/tmp/other/.codex/skills/unrelated/SKILL.md",
              scope: "repo",
            }),
          ],
        },
      ],
    } satisfies CodexSchema.V2SkillsListResponse;

    assert.deepEqual(parseCodexSkillsListResponse(response, "/tmp/requested"), []);
  });

  it("preserves same-name repo and global entries in provider order", () => {
    const cwd = "/tmp/workspace";
    const response = {
      data: [
        {
          cwd,
          errors: [],
          skills: [
            skill({
              name: "review",
              path: "/Users/me/.codex/skills/review/SKILL.md",
              scope: "user",
              description: "Global review",
            }),
            skill({
              name: "review",
              path: `${cwd}/.codex/skills/review/SKILL.md`,
              scope: "repo",
              description: "Repo review",
            }),
          ],
        },
      ],
    } satisfies CodexSchema.V2SkillsListResponse;

    const skills = parseCodexSkillsListResponse(response, cwd);

    assert.equal(skills.length, 2);
    assert.deepEqual(
      skills.map((entry) => ({
        name: entry.name,
        scope: entry.scope,
        description: entry.description,
      })),
      [
        { name: "review", scope: "user", description: "Global review" },
        { name: "review", scope: "repo", description: "Repo review" },
      ],
    );
  });

  it("preserves provider metadata fields", () => {
    const cwd = "/tmp/workspace";
    const response = {
      data: [
        {
          cwd,
          errors: [],
          skills: [
            skill({
              name: "design",
              path: `${cwd}/.codex/skills/design/SKILL.md`,
              scope: "repo",
              description: "Long description",
              shortDescription: "Short",
              enabled: false,
              interface: {
                displayName: "Design Skill",
                shortDescription: "Interface short",
              },
            }),
          ],
        },
      ],
    } satisfies CodexSchema.V2SkillsListResponse;

    const [parsed] = parseCodexSkillsListResponse(response, cwd);
    assert.deepEqual(parsed, {
      name: "design",
      path: `${cwd}/.codex/skills/design/SKILL.md`,
      enabled: false,
      description: "Long description",
      scope: "repo",
      displayName: "Design Skill",
      // Prefer SKILL.md shortDescription when present (existing probe behavior).
      shortDescription: "Short",
    });
  });
});
