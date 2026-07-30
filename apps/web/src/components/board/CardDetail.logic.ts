import type { OrchestrationBoard, OrchestrationCard, ThreadId } from "@t3tools/contracts";
import {
  boardArtifactFileName,
  cardCurrentStepIndex,
  cardStepThreadId,
  selectCardSteps,
  selectSubAgentThreads,
  type CardStepState,
} from "@t3tools/client-runtime/state/boards";

import { formatElapsed } from "./BoardRunTable.logic";

/**
 * One card tree, one detail slot: what is selected in the rail is what the
 * right-hand side renders. Every selection names the step it belongs to, so
 * the rail can keep that step expanded and the card actions always know which
 * step they would act on.
 */
export type CardSelection =
  | { readonly kind: "step"; readonly stepIndex: number }
  | { readonly kind: "subagent"; readonly stepIndex: number; readonly threadId: ThreadId }
  | { readonly kind: "artifact"; readonly stepIndex: number };

/** URL form of a selection — short enough to read in the address bar. */
export function formatCardSelection(selection: CardSelection): string {
  switch (selection.kind) {
    case "step":
      return `step:${selection.stepIndex}`;
    case "subagent":
      return `sub:${selection.stepIndex}:${selection.threadId}`;
    case "artifact":
      return `artifact:${selection.stepIndex}`;
  }
}

function parseStepIndex(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function parseCardSelection(raw: string | null | undefined): CardSelection | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const [kind, first, second] = raw.split(":");
  const stepIndex = parseStepIndex(first);
  if (stepIndex === null) return null;
  if (kind === "step") return { kind: "step", stepIndex };
  if (kind === "artifact") return { kind: "artifact", stepIndex };
  if (kind === "sub" && second !== undefined && second !== "") {
    return { kind: "subagent", stepIndex, threadId: second as ThreadId };
  }
  return null;
}

/**
 * Where the detail slot lands when the URL says nothing: the step the card
 * sits in, the last step it reached once it is Done, step 0 otherwise.
 */
export function defaultCardSelection(
  card: OrchestrationCard,
  board: OrchestrationBoard,
): CardSelection {
  const current = cardCurrentStepIndex(card);
  if (current !== null) {
    return { kind: "step", stepIndex: current };
  }
  const steps = selectCardSteps(card, board);
  const lastWithThread = steps.toReversed().find((step) => step.threadId !== null);
  return { kind: "step", stepIndex: lastWithThread?.stepIndex ?? 0 };
}

/**
 * A selection that survives the card moving on. Steps that vanished with a
 * board edit, or sub-agents that never existed, fall back to the default.
 */
export function resolveCardSelection(input: {
  readonly card: OrchestrationCard;
  readonly board: OrchestrationBoard;
  readonly requested: CardSelection | null;
  readonly subAgentThreadIds: ReadonlySet<string>;
}): CardSelection {
  const { card, board, requested } = input;
  const steps = selectCardSteps(card, board);
  if (requested === null || steps[requested.stepIndex] === undefined) {
    return defaultCardSelection(card, board);
  }
  if (requested.kind === "subagent" && !input.subAgentThreadIds.has(requested.threadId)) {
    return { kind: "step", stepIndex: requested.stepIndex };
  }
  return requested;
}

/** The thread the detail slot binds to — an artifact keeps its step's thread. */
export function selectionThreadId(
  card: OrchestrationCard,
  selection: CardSelection,
): ThreadId | null {
  if (selection.kind === "subagent") {
    return selection.threadId;
  }
  return cardStepThreadId(card, selection.stepIndex);
}

// ── Tree model ─────────────────────────────────────────────────

/** Icon states of the app's sidebar status map, at the board's badge colors. */
export type CardTreeIconState = "done" | "working" | "needsInput" | "failed" | "idle";

export interface CardTreeThread {
  readonly id: ThreadId;
  readonly title: string;
  readonly parentThreadId?: ThreadId | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly isWorking: boolean;
  readonly needsInput: boolean;
}

export interface CardTreeDiffStat {
  readonly filesChanged: number;
  readonly additions: number;
  readonly deletions: number;
}

export interface CardTreeArtifactStat {
  readonly exists: boolean;
  readonly sizeBytes: number;
}

export type CardTreeLeaf =
  | {
      readonly kind: "subagent";
      readonly stepIndex: number;
      readonly threadId: ThreadId;
      readonly title: string;
      readonly status: CardTreeIconState;
      readonly elapsed: string | null;
    }
  | {
      readonly kind: "diff";
      readonly stepIndex: number;
      readonly threadId: ThreadId;
      readonly label: string;
      readonly stat: CardTreeDiffStat | null;
    }
  | {
      readonly kind: "artifact";
      readonly stepIndex: number;
      readonly stepName: string;
      readonly fileName: string;
      readonly trailing: string;
      readonly draft: boolean;
    };

export interface CardTreeStepRow {
  readonly stepIndex: number;
  readonly name: string;
  readonly label: string;
  readonly state: CardStepState;
  readonly status: CardTreeIconState;
  readonly threadId: ThreadId | null;
  readonly trailing: string | null;
  readonly leaves: ReadonlyArray<CardTreeLeaf>;
}

export interface CardTreeModel {
  readonly steps: ReadonlyArray<CardTreeStepRow>;
  /** Done is a terminal row, not a step: it can only ever be reached. */
  readonly done: { readonly reached: boolean; readonly trailing: string };
}

function stepIconState(
  state: CardStepState,
  isCurrent: boolean,
  cardStatus: OrchestrationCard["status"],
): CardTreeIconState {
  if (state === "complete") return "done";
  if (!isCurrent) return "idle";
  switch (cardStatus) {
    case "running":
      return "working";
    case "paused":
    case "needs-input":
      return "needsInput";
    case "failed":
      return "failed";
    case "cancelled":
    case null:
      return "idle";
  }
}

function threadIconState(thread: CardTreeThread): CardTreeIconState {
  if (thread.isWorking) return "working";
  if (thread.needsInput) return "needsInput";
  return "done";
}

/** Elapsed between two instants, tolerant of the end being unknown. */
function durationLabel(startIso: string | null, endMs: number): string | null {
  return Number.isFinite(endMs) ? formatElapsed(startIso, endMs) : null;
}

const KILOBYTE = 1024;

/** `3.4 KB` — file weight at the precision the rail can show. */
export function formatArtifactSize(sizeBytes: number): string {
  if (sizeBytes < KILOBYTE) {
    return `${sizeBytes} B`;
  }
  const kilobytes = sizeBytes / KILOBYTE;
  return kilobytes < 100 ? `${kilobytes.toFixed(1)} KB` : `${Math.round(kilobytes)} KB`;
}

/** `14 files changed` / `1 file changed` — the diff leaf's own label. */
export function formatDiffFilesLabel(stat: CardTreeDiffStat | null): string {
  if (stat === null) return "Changes";
  return `${stat.filesChanged} file${stat.filesChanged === 1 ? "" : "s"} changed`;
}

/**
 * The card tree: steps as top-level rows, with their sub-agent threads, diff,
 * and artifact as leaves. Threads and artifacts are the same kind of thing to
 * the tree, which is what makes one detail slot work.
 */
export function buildCardTree(input: {
  readonly card: OrchestrationCard;
  readonly board: OrchestrationBoard;
  readonly threads: ReadonlyArray<CardTreeThread>;
  readonly diffByThreadId: ReadonlyMap<string, CardTreeDiffStat>;
  readonly artifactByStepIndex: ReadonlyMap<number, CardTreeArtifactStat>;
  readonly nowMs: number;
}): CardTreeModel {
  const { card, board, threads, nowMs } = input;
  const threadsById = new Map(threads.map((thread) => [thread.id as string, thread]));
  const current = cardCurrentStepIndex(card);

  const steps = selectCardSteps(card, board).map((step): CardTreeStepRow => {
    const thread = step.threadId === null ? null : (threadsById.get(step.threadId) ?? null);
    const isCurrent = step.stepIndex === current;
    const leaves: CardTreeLeaf[] = [];

    for (const subAgent of selectSubAgentThreads(threads, step.threadId)) {
      leaves.push({
        kind: "subagent",
        stepIndex: step.stepIndex,
        threadId: subAgent.id,
        title: subAgent.title,
        status: threadIconState(subAgent),
        elapsed: durationLabel(
          subAgent.createdAt,
          subAgent.isWorking ? nowMs : Date.parse(subAgent.updatedAt),
        ),
      });
    }

    if (step.threadId !== null) {
      const stat = input.diffByThreadId.get(step.threadId) ?? null;
      leaves.push({
        kind: "diff",
        stepIndex: step.stepIndex,
        threadId: step.threadId,
        label: formatDiffFilesLabel(stat),
        stat,
      });
    }

    const artifact = input.artifactByStepIndex.get(step.stepIndex) ?? null;
    if (step.state !== "pending") {
      leaves.push({
        kind: "artifact",
        stepIndex: step.stepIndex,
        stepName: step.name,
        fileName: boardArtifactFileName(step.name),
        trailing:
          artifact === null || !artifact.exists ? "draft" : formatArtifactSize(artifact.sizeBytes),
        draft: artifact === null || !artifact.exists,
      });
    }

    return {
      stepIndex: step.stepIndex,
      name: step.name,
      label: `${step.stepIndex + 1} · ${step.name}`,
      state: step.state,
      status: stepIconState(step.state, isCurrent, card.status),
      threadId: step.threadId,
      trailing:
        thread === null
          ? null
          : durationLabel(
              thread.createdAt,
              step.state === "complete" ? Date.parse(thread.updatedAt) : nowMs,
            ),
      leaves,
    };
  });

  const reached = card.position.kind === "done";
  return {
    steps,
    done: {
      reached,
      trailing: reached
        ? (durationLabel(card.releasedAt, Date.parse(card.completedAt ?? "")) ?? "reached")
        : "not reached",
    },
  };
}
