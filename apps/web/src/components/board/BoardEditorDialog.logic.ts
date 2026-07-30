import {
  BoardStepId,
  type BoardStep,
  type BoardStepContinuation,
  type OrchestrationBoard,
} from "@t3tools/contracts";

/** Editing shape: plain strings, so a half-typed step is always representable. */
export interface BoardStepDraft {
  readonly id: BoardStepId;
  readonly name: string;
  readonly promptTemplate: string;
  readonly profileName: string;
  readonly continuation: BoardStepContinuation;
}

export interface BoardDraft {
  readonly name: string;
  readonly steps: ReadonlyArray<BoardStepDraft>;
}

export const CONTINUATION_OPTIONS: ReadonlyArray<{
  readonly value: BoardStepContinuation;
  readonly label: string;
  readonly description: string;
}> = [
  {
    value: "auto",
    label: "Auto",
    description: "Success advances the card to the next step immediately.",
  },
  {
    value: "manual",
    label: "Manual",
    description: "Success pauses the card here so you can review the artifact before continuing.",
  },
];

export function createStepDraft(id: BoardStepId, profileName: string): BoardStepDraft {
  return { id, name: "", promptTemplate: "", profileName, continuation: "auto" };
}

export function draftFromBoard(board: OrchestrationBoard): BoardDraft {
  return {
    name: board.name,
    steps: board.steps.map((step) => ({
      id: step.id,
      name: step.name,
      promptTemplate: step.promptTemplate,
      profileName: step.profileName,
      continuation: step.continuation,
    })),
  };
}

export function updateStep(
  steps: ReadonlyArray<BoardStepDraft>,
  index: number,
  patch: Partial<Omit<BoardStepDraft, "id">>,
): ReadonlyArray<BoardStepDraft> {
  return steps.map((step, i) => (i === index ? { ...step, ...patch } : step));
}

export function removeStep(
  steps: ReadonlyArray<BoardStepDraft>,
  index: number,
): ReadonlyArray<BoardStepDraft> {
  return steps.filter((_, i) => i !== index);
}

/** Up/down reorder. Out-of-range moves are no-ops so the buttons can stay dumb. */
export function moveStep(
  steps: ReadonlyArray<BoardStepDraft>,
  index: number,
  direction: "up" | "down",
): ReadonlyArray<BoardStepDraft> {
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= steps.length || target < 0 || target >= steps.length) {
    return steps;
  }
  const next = [...steps];
  const moved = next[index]!;
  next[index] = next[target]!;
  next[target] = moved;
  return next;
}

export interface BoardDraftErrors {
  readonly name: string | null;
  /** Board-level problems that belong to no single step. */
  readonly general: string | null;
  /** Keyed by step id so a reorder carries the message with its step. */
  readonly steps: Readonly<Record<string, string>>;
}

const MAX_BOARD_NAME_CHARS = 120;
const MAX_STEP_NAME_CHARS = 64;
const MAX_STEPS = 20;

export function validateBoardDraft(draft: BoardDraft): BoardDraftErrors {
  const stepErrors: Record<string, string> = {};
  const seenNames = new Set<string>();

  for (const step of draft.steps) {
    const name = step.name.trim();
    const message =
      name === ""
        ? "Give the step a name."
        : name.length > MAX_STEP_NAME_CHARS
          ? `Step names are at most ${MAX_STEP_NAME_CHARS} characters.`
          : seenNames.has(name.toLowerCase())
            ? // Artifact placeholders address steps by name (`${artifact:Review}`),
              // so duplicates would be ambiguous downstream.
              "Step names must be unique."
            : step.promptTemplate.trim() === ""
              ? "Give the step a prompt template."
              : step.profileName.trim() === ""
                ? "Pick an agent profile."
                : null;
    if (name !== "") seenNames.add(name.toLowerCase());
    if (message !== null) stepErrors[step.id] = message;
  }

  const name = draft.name.trim();
  const nameError =
    name === ""
      ? "Give the board a name."
      : name.length > MAX_BOARD_NAME_CHARS
        ? `Board names are at most ${MAX_BOARD_NAME_CHARS} characters.`
        : null;

  const general =
    draft.steps.length === 0
      ? "Add at least one step."
      : draft.steps.length > MAX_STEPS
        ? `A board holds at most ${MAX_STEPS} steps.`
        : null;

  return { name: nameError, general, steps: stepErrors };
}

export function isBoardDraftSubmittable(errors: BoardDraftErrors): boolean {
  return errors.name === null && errors.general === null && Object.keys(errors.steps).length === 0;
}

/** Trimmed steps, ready for `board.create` / `board.update` (replaced wholesale). */
export function toBoardSteps(draft: BoardDraft): ReadonlyArray<BoardStep> {
  return draft.steps.map((step) => ({
    id: step.id,
    name: step.name.trim(),
    promptTemplate: step.promptTemplate.trim(),
    profileName: step.profileName.trim() as BoardStep["profileName"],
    continuation: step.continuation,
  }));
}

export function makeBoardStepId(id: string): BoardStepId {
  return BoardStepId.make(id);
}
