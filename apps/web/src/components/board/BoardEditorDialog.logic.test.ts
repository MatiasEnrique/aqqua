import { describe, expect, it } from "vite-plus/test";

import { BoardId, BoardStepId, ProjectId, ProviderInstanceId } from "@aqqua/contracts";
import type { OrchestrationBoard } from "@aqqua/contracts";

import {
  type BoardDraft,
  type BoardStepDraft,
  buildPlaceholderOptions,
  createStepDraft,
  draftFromBoard,
  insertSkillToken,
  isBoardDraftSubmittable,
  moveStep,
  removeStep,
  resolveProfileSkillsProvider,
  resolveStepAgentDisplay,
  segmentTemplate,
  stepAgentSelection,
  toBoardSteps,
  updateStep,
  validateBoardDraft,
} from "./BoardEditorDialog.logic";

function stepDraft(overrides: Partial<BoardStepDraft> = {}): BoardStepDraft {
  return {
    id: BoardStepId.make("step-1"),
    name: "Implement",
    promptTemplate: "Implement ${issue_id}",
    profileName: "implementer",
    continuation: "auto",
    ...overrides,
  };
}

function draft(steps: ReadonlyArray<BoardStepDraft>): BoardDraft {
  return { name: "Delivery", steps };
}

describe("step editing", () => {
  const steps = [
    stepDraft({ id: BoardStepId.make("a"), name: "Plan" }),
    stepDraft({ id: BoardStepId.make("b"), name: "Implement" }),
    stepDraft({ id: BoardStepId.make("c"), name: "Review" }),
  ];

  it("patches one step and leaves the rest untouched", () => {
    const next = updateStep(steps, 1, { continuation: "manual" });
    expect(next[1]?.continuation).toBe("manual");
    expect(next[0]).toBe(steps[0]);
    expect(next[2]).toBe(steps[2]);
  });

  it("removes a step by index", () => {
    expect(removeStep(steps, 0).map((s) => s.name)).toEqual(["Implement", "Review"]);
  });

  it("swaps steps with the neighbour", () => {
    expect(moveStep(steps, 1, "up").map((s) => s.name)).toEqual(["Implement", "Plan", "Review"]);
    expect(moveStep(steps, 1, "down").map((s) => s.name)).toEqual(["Plan", "Review", "Implement"]);
  });

  it("ignores moves off either end", () => {
    expect(moveStep(steps, 0, "up")).toBe(steps);
    expect(moveStep(steps, 2, "down")).toBe(steps);
    expect(moveStep(steps, 9, "up")).toBe(steps);
  });

  it("seeds a new step with the default continuation", () => {
    const created = createStepDraft(BoardStepId.make("new"), "implementer");
    expect(created).toEqual({
      id: "new",
      name: "",
      promptTemplate: "",
      profileName: "implementer",
      continuation: "auto",
    });
  });
});

describe("validateBoardDraft", () => {
  it("accepts a complete draft", () => {
    const errors = validateBoardDraft(draft([stepDraft()]));
    expect(errors).toEqual({ name: null, general: null, steps: {} });
    expect(isBoardDraftSubmittable(errors)).toBe(true);
  });

  it("requires a flow name and at least one step", () => {
    const errors = validateBoardDraft({ name: "   ", steps: [] });
    expect(errors.name).toBe("Give the flow a name.");
    expect(errors.general).toBe("Add at least one step.");
    expect(isBoardDraftSubmittable(errors)).toBe(false);
  });

  it("reports the first problem per step, keyed by step id", () => {
    const errors = validateBoardDraft(
      draft([
        stepDraft({ id: BoardStepId.make("a"), name: "  " }),
        stepDraft({ id: BoardStepId.make("b"), promptTemplate: " " }),
        stepDraft({ id: BoardStepId.make("c"), name: "Review", profileName: "" }),
      ]),
    );
    expect(errors.steps).toEqual({
      a: "Give the step a name.",
      b: "Give the step a prompt template.",
      c: "Pick an agent.",
    });
  });

  it("rejects duplicate step names regardless of case", () => {
    const errors = validateBoardDraft(
      draft([
        stepDraft({ id: BoardStepId.make("a"), name: "Review" }),
        stepDraft({ id: BoardStepId.make("b"), name: "review" }),
      ]),
    );
    expect(errors.steps).toEqual({ b: "Step names must be unique." });
  });

  it("caps the step count", () => {
    const many = Array.from({ length: 21 }, (_, i) =>
      stepDraft({ id: BoardStepId.make(`s-${i}`), name: `Step ${i}` }),
    );
    expect(validateBoardDraft(draft(many)).general).toBe("A flow holds at most 20 steps.");
  });
});

describe("board <-> draft round trip", () => {
  const board: OrchestrationBoard = {
    id: BoardId.make("board-1"),
    projectId: ProjectId.make("project-1"),
    name: "Delivery",
    steps: [
      {
        id: BoardStepId.make("a"),
        name: "Implement",
        promptTemplate: "Implement ${issue_id}",
        profileName: "implementer" as OrchestrationBoard["steps"][number]["profileName"],
        continuation: "manual",
      },
    ],
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    deletedAt: null,
  };

  it("loads an existing board into the editor and back out unchanged", () => {
    expect(toBoardSteps(draftFromBoard(board))).toEqual(board.steps);
  });

  it("preserves a canonical model selector through the legacy-profile editor", () => {
    const canonicalBoard: OrchestrationBoard = {
      ...board,
      steps: [
        {
          id: board.steps[0]!.id,
          name: board.steps[0]!.name,
          promptTemplate: board.steps[0]!.promptTemplate,
          continuation: board.steps[0]!.continuation,
          agent: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.6-sol",
            reasoning: "high",
          },
        },
      ],
    };

    expect(toBoardSteps(draftFromBoard(canonicalBoard))).toEqual(canonicalBoard.steps);
  });

  it("trims whitespace on the way out", () => {
    const steps = toBoardSteps(
      draft([
        stepDraft({ name: "  Implement  ", promptTemplate: "  do it  ", profileName: " cc " }),
      ]),
    );
    expect(steps[0]).toEqual({
      id: "step-1",
      name: "Implement",
      promptTemplate: "do it",
      profileName: "cc",
      continuation: "auto",
    });
  });
});

describe("segmentTemplate", () => {
  it("round-trips the template text verbatim", () => {
    const template =
      "Implement ${issue_id} per ${artifact:Plan}.\nWrite to ${artifact}. ${bad name} ${}";
    const joined = segmentTemplate(template)
      .map((segment) => segment.text)
      .join("");
    expect(joined).toBe(template);
  });

  it("classifies parameters, artifacts, and invalid tokens", () => {
    const kinds = segmentTemplate(
      "${issue_id} ${artifact} ${artifact:Plan} ${card_title} ${not valid}",
    ).map((segment) => segment.kind);
    expect(kinds).toEqual([
      "parameter",
      "text",
      "artifact",
      "text",
      "artifact",
      "text",
      "parameter",
      "text",
      "text",
    ]);
  });

  it("exposes the token body without delimiters", () => {
    const segments = segmentTemplate("${artifact:Plan}");
    expect(segments).toEqual([
      { kind: "artifact", text: "${artifact:Plan}", body: "artifact:Plan" },
    ]);
  });
});

describe("skill tokens", () => {
  it("highlights $skill references on word boundaries, including at end of input", () => {
    const segments = segmentTemplate("Run $tdd first then $code-review");
    expect(segments).toEqual([
      { kind: "text", text: "Run " },
      { kind: "skill", text: "$tdd", body: "tdd" },
      { kind: "text", text: " first then " },
      { kind: "skill", text: "$code-review", body: "code-review" },
    ]);
  });

  it("does not treat ${...} placeholders or mid-word dollars as skills", () => {
    const segments = segmentTemplate("Pay us$5 for ${issue_id}");
    expect(segments.map((segment) => segment.kind)).toEqual(["text", "parameter"]);
  });

  it("round-trips templates containing skill tokens", () => {
    const template = "Use $tdd\n$plan and finish.";
    const joined = segmentTemplate(template)
      .map((segment) => segment.text)
      .join("");
    expect(joined).toBe(template);
  });
});

describe("insertSkillToken", () => {
  it("pads with spaces so the token sits on word boundaries", () => {
    expect(insertSkillToken("Implement the fix.", 18, "tdd")).toEqual({
      text: "Implement the fix. $tdd ",
      caret: 24,
    });
  });

  it("reuses existing whitespace instead of doubling it", () => {
    expect(insertSkillToken("before  after", 7, "tdd")).toEqual({
      text: "before $tdd after",
      caret: 11,
    });
  });

  it("inserts into an empty template without a leading space", () => {
    expect(insertSkillToken("", 0, "tdd")).toEqual({ text: "$tdd ", caret: 5 });
  });
});

describe("resolveProfileSkillsProvider", () => {
  const provider = (overrides: Record<string, unknown>) =>
    ({
      instanceId: "claude-1",
      driver: "claude",
      enabled: true,
      ...overrides,
    }) as unknown as Parameters<typeof resolveProfileSkillsProvider>[1][number];

  it("pins an instance target even when disabled", () => {
    const pinned = provider({ instanceId: "codex-2", driver: "codex", enabled: false });
    expect(
      resolveProfileSkillsProvider({ kind: "instance", instanceId: pinned.instanceId }, [
        provider({}),
        pinned,
      ]),
    ).toBe(pinned);
  });

  it("falls back to the first enabled instance of a driver target", () => {
    const disabled = provider({ instanceId: "claude-0", enabled: false });
    const enabled = provider({ instanceId: "claude-1" });
    expect(
      resolveProfileSkillsProvider({ kind: "driver", driver: enabled.driver }, [disabled, enabled]),
    ).toBe(enabled);
  });

  it("returns null for a missing profile target", () => {
    expect(resolveProfileSkillsProvider(null, [provider({})])).toBeNull();
  });
});

describe("buildPlaceholderOptions", () => {
  const steps = [
    stepDraft({ id: BoardStepId.make("a"), name: "Plan", promptTemplate: "Plan ${issue_id}" }),
    stepDraft({ id: BoardStepId.make("b"), name: "Implement", promptTemplate: "Do ${scope}" }),
    stepDraft({ id: BoardStepId.make("c"), name: "Review", promptTemplate: "Check" }),
  ];

  it("offers no artifact tokens for the first step", () => {
    const tokens = buildPlaceholderOptions(steps, 0).map((option) => option.token);
    expect(tokens).toEqual(["${issue_id}", "${scope}", "${card_title}"]);
  });

  it("offers the previous artifact and earlier steps only", () => {
    const tokens = buildPlaceholderOptions(steps, 2).map((option) => option.token);
    expect(tokens).toEqual([
      "${artifact}",
      "${artifact:Plan}",
      "${artifact:Implement}",
      "${issue_id}",
      "${scope}",
      "${card_title}",
    ]);
  });

  it("names the previous step in the ${artifact} description", () => {
    const artifact = buildPlaceholderOptions(steps, 1).find(
      (option) => option.token === "${artifact}",
    );
    expect(artifact?.description).toContain("Plan");
  });

  it("skips unnamed steps for named artifact tokens", () => {
    const unnamed = [stepDraft({ id: BoardStepId.make("a"), name: "  " }), steps[1]!];
    const tokens = buildPlaceholderOptions(unnamed, 1).map((option) => option.token);
    expect(tokens).not.toContainEqual(expect.stringContaining("${artifact:"));
    expect(tokens).toContain("${artifact}");
  });
});

describe("step agent display and selection", () => {
  const codexEntry = {
    instanceId: ProviderInstanceId.make("codex"),
    driverKind: "codex",
    enabled: true,
    models: [
      {
        slug: "gpt-5-codex",
        name: "GPT-5 Codex",
        isCustom: false,
        capabilities: {
          optionDescriptors: [
            {
              id: "reasoningEffort",
              label: "Reasoning",
              type: "select",
              semantic: "reasoning",
              options: [
                { id: "medium", label: "Medium" },
                { id: "high", label: "High" },
              ],
            },
          ],
        },
      },
      { slug: "gpt-5", name: "GPT-5", isCustom: false, isDefault: true, capabilities: {} },
    ],
  } as unknown as Parameters<typeof resolveStepAgentDisplay>[2][number];

  it("shows the canonical agent, or resolves the legacy profile to an entry", () => {
    const canonical = resolveStepAgentDisplay(
      stepDraft({
        profileName: "",
        agent: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
          reasoning: "high",
        },
      }),
      undefined,
      [codexEntry],
    );
    expect(canonical).toEqual({ entry: codexEntry, model: "gpt-5-codex", reasoning: "high" });

    // Legacy profile (built-in implementer fallback): codex driver, default model.
    const legacy = resolveStepAgentDisplay(stepDraft(), undefined, [codexEntry]);
    expect(legacy).toEqual({ entry: codexEntry, model: "gpt-5", reasoning: null });

    expect(resolveStepAgentDisplay(stepDraft(), undefined, [])).toBeNull();
  });

  it("keeps a reasoning level only when the chosen model advertises it", () => {
    expect(stepAgentSelection(codexEntry, "gpt-5-codex", "high")).toEqual({
      instanceId: "codex",
      model: "gpt-5-codex",
      reasoning: "high",
    });
    // gpt-5 has no reasoning descriptor, so the level is dropped.
    expect(stepAgentSelection(codexEntry, "gpt-5", "high")).toEqual({
      instanceId: "codex",
      model: "gpt-5",
    });
  });
});
