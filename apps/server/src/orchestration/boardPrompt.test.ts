import { describe, expect, it } from "vite-plus/test";

import { assembleBoardStepPrompt, BOARD_STEP_COMPLETION_BOILERPLATE } from "./boardPrompt.ts";

const STATE_DIR = "/tmp/aqqua-state";
const CARD_ID = "card-abc12345";
const STEPS = [{ name: "Implement" }, { name: "Review" }, { name: "Ship" }];

describe("assembleBoardStepPrompt", () => {
  it("renders parameters, card title, and injects completion boilerplate", () => {
    const result = assembleBoardStepPrompt({
      template: "Implement ${ticket_id} for ${card_title}",
      parameters: { ticket_id: "aqqua-482" },
      cardTitle: "Fix flaky test",
      cardId: CARD_ID,
      stepIndex: 0,
      steps: STEPS,
      stateDir: STATE_DIR,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const expectedArtifact = `${STATE_DIR}/board-artifacts/${CARD_ID}/Implement.md`;
    expect(result.artifactOutputPath).toBe(expectedArtifact);
    expect(result.text).toContain("Implement aqqua-482 for Fix flaky test");
    expect(result.text).toContain(expectedArtifact);
    expect(result.text).toContain("board_complete");
    expect(result.text).toContain("outcome `success`");
    expect(result.text).toContain("outcome `blocked`");
    expect(BOARD_STEP_COMPLETION_BOILERPLATE).toContain("${artifactOutputPath}");
  });

  it("resolves ${artifact} to the previous step path and ${artifact:name} by step name", () => {
    const result = assembleBoardStepPrompt({
      template:
        "Review ${artifact} and compare with ${artifact:Implement}. Ship later uses ${artifact:Review}.",
      parameters: {},
      cardTitle: "Fix flaky test",
      cardId: CARD_ID,
      stepIndex: 1,
      steps: STEPS,
      stateDir: STATE_DIR,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const implementPath = `${STATE_DIR}/board-artifacts/${CARD_ID}/Implement.md`;
    const reviewPath = `${STATE_DIR}/board-artifacts/${CARD_ID}/Review.md`;
    expect(result.text).toContain(implementPath);
    expect(result.text).toContain(reviewPath);
    expect(result.artifactOutputPath).toBe(reviewPath);
  });

  it("fails when a required parameter is missing", () => {
    const result = assembleBoardStepPrompt({
      template: "Do ${ticket_id}",
      parameters: {},
      cardTitle: "Card",
      cardId: CARD_ID,
      stepIndex: 0,
      steps: STEPS,
      stateDir: STATE_DIR,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toContain("ticket_id");
    expect(result.reason).toMatch(/Unresolved placeholders/);
  });

  it("fails when ${artifact} is used on the first step (no previous)", () => {
    const result = assembleBoardStepPrompt({
      template: "Use ${artifact}",
      parameters: {},
      cardTitle: "Card",
      cardId: CARD_ID,
      stepIndex: 0,
      steps: STEPS,
      stateDir: STATE_DIR,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toContain("artifact");
  });

  it("fails when ${artifact:Unknown} names a step not in the snapshot", () => {
    const result = assembleBoardStepPrompt({
      template: "Need ${artifact:Unknown}",
      parameters: {},
      cardTitle: "Card",
      cardId: CARD_ID,
      stepIndex: 1,
      steps: STEPS,
      stateDir: STATE_DIR,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toContain("artifact:Unknown");
  });

  it("fails on out-of-range step index", () => {
    const result = assembleBoardStepPrompt({
      template: "Hello",
      parameters: {},
      cardTitle: "Card",
      cardId: CARD_ID,
      stepIndex: 99,
      steps: STEPS,
      stateDir: STATE_DIR,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/out of range/);
  });
});
