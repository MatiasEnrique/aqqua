import { resolveBoardArtifactPath } from "../boardArtifacts.ts";
import { renderBoardTemplate } from "@t3tools/shared/boardTemplate";

/**
 * Injected after the rendered step template so every step thread knows where to
 * write its artifact and how to signal completion. Exported so the wording can
 * be tuned in one place without hunting through the reactor.
 */
export const BOARD_STEP_COMPLETION_BOILERPLATE = [
  "",
  "---",
  "Board step instructions (injected by T3 Code):",
  "1. Write this step's artifact file to exactly this path:",
  "   ${artifactOutputPath}",
  "2. When the step's work is done, call the `board_complete` MCP tool with",
  "   outcome `success`. Call it with outcome `blocked` if you cannot proceed",
  "   and need human input.",
  "3. Do not invent other completion signals — only `board_complete` advances",
  "   the card.",
].join("\n");

export type BoardPromptStep = {
  readonly name: string;
};

export type AssembleBoardStepPromptInput = {
  readonly template: string;
  readonly parameters: Record<string, string>;
  readonly cardTitle: string;
  readonly cardId: string;
  readonly stepIndex: number;
  readonly steps: ReadonlyArray<BoardPromptStep>;
  readonly stateDir: string;
};

export type AssembleBoardStepPromptResult =
  | {
      readonly ok: true;
      readonly text: string;
      readonly artifactOutputPath: string;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly missing: ReadonlyArray<string>;
    };

/**
 * Resolve artifact paths for a card step from the snapshot step list, render
 * the template, and append the completion boilerplate.
 *
 * Snapshot-deterministic: paths come from cardId + step names, never the live
 * board definition.
 */
export function assembleBoardStepPrompt(
  input: AssembleBoardStepPromptInput,
): AssembleBoardStepPromptResult {
  const step = input.steps[input.stepIndex];
  if (step === undefined) {
    return {
      ok: false,
      reason: `Step index ${input.stepIndex} is out of range (snapshot has ${input.steps.length} steps).`,
      missing: [],
    };
  }

  const outputResolved = resolveBoardArtifactPath({
    stateDir: input.stateDir,
    cardId: input.cardId,
    stepName: step.name,
  });
  if (outputResolved === null) {
    return {
      ok: false,
      reason: `Invalid artifact step name '${step.name}'.`,
      missing: [],
    };
  }

  const previousStep = input.stepIndex > 0 ? input.steps[input.stepIndex - 1] : undefined;
  const previousResolved =
    previousStep === undefined
      ? null
      : resolveBoardArtifactPath({
          stateDir: input.stateDir,
          cardId: input.cardId,
          stepName: previousStep.name,
        });

  const artifactPathForStep = (stepName: string): string | null => {
    const match = input.steps.find((entry) => entry.name === stepName);
    if (match === undefined) {
      return null;
    }
    const resolved = resolveBoardArtifactPath({
      stateDir: input.stateDir,
      cardId: input.cardId,
      stepName: match.name,
    });
    return resolved?.path ?? null;
  };

  const rendered = renderBoardTemplate(input.template, {
    parameters: input.parameters,
    artifactPathForPrevious: previousResolved?.path ?? null,
    artifactPathForStep,
    cardTitle: input.cardTitle,
  });

  if (rendered.missing.length > 0) {
    return {
      ok: false,
      reason: `Unresolved placeholders: ${rendered.missing.join(", ")}.`,
      missing: rendered.missing,
    };
  }

  const boilerplate = BOARD_STEP_COMPLETION_BOILERPLATE.replaceAll(
    "${artifactOutputPath}",
    outputResolved.path,
  );

  return {
    ok: true,
    text: `${rendered.text}${boilerplate}`,
    artifactOutputPath: outputResolved.path,
  };
}
