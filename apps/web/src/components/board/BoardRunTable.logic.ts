import {
  type CardOperationKind,
  cardOperation,
  cardOperationFailure,
  isCardDeleting,
} from "@aqqua/client-runtime/state/boards";
import type { BoardId, CardStatus, OrchestrationBoard, OrchestrationCard } from "@aqqua/contracts";
import { isContinuableCardStatus } from "@aqqua/contracts";

import type { SidebarSummaryState } from "../sidebar-v2/SidebarStatusPresentations";

/**
 * Position and status are orthogonal: the track below says where a card is,
 * the badge beside it says how it is doing. Neither derives from the other.
 */
export type BoardSegmentState = "complete" | "current" | "pending";

export interface BoardSegment {
  readonly index: number;
  readonly state: BoardSegmentState;
  readonly stepName: string | null;
}

/**
 * One segment per step of the card's own pipeline: steps behind it are
 * complete, the step it sits in is current, later steps are not reached.
 * To-Do cards get an empty track, Done cards a full one.
 */
export function buildPositionSegments(
  card: OrchestrationCard,
  stepNames: ReadonlyArray<string>,
): ReadonlyArray<BoardSegment> {
  return stepNames.map((stepName, index) => ({
    index,
    stepName,
    state: segmentState(card, index),
  }));
}

function segmentState(card: OrchestrationCard, index: number): BoardSegmentState {
  switch (card.position.kind) {
    case "todo":
      return "pending";
    case "done":
      return "complete";
    case "step":
      if (index < card.position.stepIndex) return "complete";
      return index === card.position.stepIndex ? "current" : "pending";
  }
}

export type BoardBadgeVariant = "info" | "warning" | "error" | "success" | "secondary";

export interface BoardStatusPresentation {
  readonly label: string;
  readonly variant: BoardBadgeVariant;
}

const STATUS_PRESENTATIONS: Record<CardStatus, BoardStatusPresentation> = {
  running: { label: "Running", variant: "info" },
  // Paused and needs-input both mean "this card is waiting on you" — the spec
  // groups them, and amber is the shared cue.
  paused: { label: "Paused", variant: "warning" },
  "needs-input": { label: "Needs input", variant: "warning" },
  failed: { label: "Failed", variant: "error" },
  // Cancelling the current step conversation parks the card in place.
  cancelled: { label: "Cancelled", variant: "secondary" },
  deleting: { label: "Deleting", variant: "secondary" },
};

const NEEDS_YOU_STATUSES: ReadonlySet<CardStatus> = new Set<CardStatus>([
  "needs-input",
  "paused",
  "failed",
]);

/** The board's urgent bucket: work a human has to unblock. */
export function cardNeedsYou(card: OrchestrationCard): boolean {
  return card.status !== null && NEEDS_YOU_STATUSES.has(card.status);
}

const OPERATION_PRESENTATIONS: Record<CardOperationKind, BoardStatusPresentation> = {
  starting: { label: "Starting", variant: "info" },
  advancing: { label: "Advancing", variant: "info" },
  retrying: { label: "Retrying", variant: "info" },
  resetting: { label: "Resetting", variant: "warning" },
  deleting: { label: "Deleting", variant: "secondary" },
};

/** How an in-flight operation reads on a badge — one label per operation. */
export function cardOperationPresentation(operation: CardOperationKind): BoardStatusPresentation {
  return OPERATION_PRESENTATIONS[operation];
}

/**
 * What the card is doing right now, in one badge. An operation the server is
 * running outranks position and status: while a card is being deleted it says
 * Deleting, not Done, wherever it appears.
 */
export function cardStatusPresentation(card: OrchestrationCard): BoardStatusPresentation | null {
  const operation = cardOperation(card);
  if (operation !== null) return OPERATION_PRESENTATIONS[operation];
  if (cardOperationFailure(card) !== null) return STATUS_PRESENTATIONS.failed;
  if (card.position.kind === "done" && card.status !== "failed") {
    return { label: "Done", variant: "success" };
  }
  return card.status === null ? null : STATUS_PRESENTATIONS[card.status];
}

/**
 * Why the card's last operation failed, as the server persisted it — the line
 * that explains a card reappearing after a deletion it was supposed to leave on.
 * Non-destructive failures are shown after their claim clears. Destructive
 * cleanup failures keep their claim by design, so their retry reason remains
 * visible beside the Resetting/Deleting receipt.
 */
export function cardFailureNote(card: OrchestrationCard): string | null {
  const operation = cardOperation(card);
  return operation === null || operation === "resetting" || operation === "deleting"
    ? cardOperationFailure(card)
    : null;
}

/** Card lifecycle expressed in the exact state vocabulary used by conversations. */
export function cardSidebarSummaryState(card: OrchestrationCard): SidebarSummaryState {
  if (cardOperation(card) !== null) return "working";
  if (cardOperationFailure(card) !== null) return "stale";
  if (card.settledAt !== null) return "settled";
  switch (card.status) {
    case "running":
      return "working";
    case "paused":
    case "needs-input":
      return "needsInput";
    case "failed":
    case "cancelled":
      return "stale";
    // Unreachable via the operation check above; kept so the status union
    // stays exhaustive.
    case "deleting":
      return "working";
    case null:
      return card.position.kind === "done"
        ? "done"
        : card.position.kind === "step"
          ? "working"
          : "stale";
  }
}

export type SidebarBoardChoice = "all" | string | null;

/** Keep the board containing a newly settled card visible after its route closes. */
export function sidebarBoardChoiceAfterSettle(
  current: SidebarBoardChoice,
  settledCardBoardId: BoardId,
): SidebarBoardChoice {
  return current ?? settledCardBoardId;
}

/**
 * Prefer a board with visible cards when no route or explicit choice supplies
 * context. A card on its way out is not a visible card, so the last deletion on
 * a board cannot keep pinning the sidebar to it.
 */
export function sidebarFallbackBoard(
  boards: ReadonlyArray<OrchestrationBoard>,
  cards: ReadonlyArray<OrchestrationCard>,
): OrchestrationBoard | null {
  const boardIdsWithCards = new Set(
    cards
      .filter((card) => card.archivedAt === null && !isCardDeleting(card))
      .map((card) => card.boardId as string),
  );
  return boards.find((board) => boardIdsWithCards.has(board.id as string)) ?? boards[0] ?? null;
}

/** The current segment borrows the badge's color; a clean run stays neutral. */
export function currentSegmentVariant(card: OrchestrationCard): BoardBadgeVariant {
  return cardStatusPresentation(card)?.variant ?? "info";
}

/** `1 · Implement` — where the card sits, spelled out beside the track. */
export function cardPositionLabel(
  card: OrchestrationCard,
  stepNames: ReadonlyArray<string>,
): string {
  switch (card.position.kind) {
    case "todo":
      return "To-Do";
    case "done":
      return "Done";
    case "step": {
      const index = card.position.stepIndex;
      const name = stepNames[index];
      return name === undefined ? `Step ${index + 1}` : `${index + 1} · ${name}`;
    }
  }
}

export interface BoardRowActions {
  /** Interrupt the running turn. */
  readonly cancel: boolean;
  /** Flagged card — discard the thread and run the step again. */
  readonly retry: boolean;
  /** Manual gate — advance past the step the card is parked on. */
  readonly continue: boolean;
}

/**
 * Recovery actions on an in-flight row: cancel what is running, retry or
 * continue what is flagged. Position never changes for status reasons, so a row
 * keeps its place whichever one the user hits. An operation the server has
 * claimed withholds all of them, the same way `cardActionAvailability` closes
 * the composer — one card cannot offer two different answers.
 *
 * Retry and Continue read the same continuable vocabulary the contract defines
 * and the detail composer uses: Continue is the manual gate on a paused card
 * and "mark this step done" on a stuck one.
 */
export function inFlightRowActions(card: OrchestrationCard): BoardRowActions {
  if (card.position.kind !== "step" || cardOperation(card) !== null) {
    return { cancel: false, retry: false, continue: false };
  }
  const flagged = isContinuableCardStatus(card.status);
  return {
    cancel: card.status === "running",
    retry: flagged,
    continue: flagged,
  };
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Coarse elapsed label since release. Coarse on purpose: a once-a-second tick
 * that only ever changes the seconds place keeps the table cheap to repaint.
 */
export function formatElapsed(startIso: string | null, nowMs: number): string | null {
  if (startIso === null) return null;
  const startMs = Date.parse(startIso);
  if (Number.isNaN(startMs)) return null;
  const elapsed = Math.max(0, nowMs - startMs);
  if (elapsed < MINUTE_MS) {
    return `${Math.floor(elapsed / 1000)}s`;
  }
  if (elapsed < HOUR_MS) {
    return `${Math.floor(elapsed / MINUTE_MS)}m`;
  }
  if (elapsed < DAY_MS) {
    const hours = Math.floor(elapsed / HOUR_MS);
    const minutes = Math.floor((elapsed % HOUR_MS) / MINUTE_MS);
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }
  const days = Math.floor(elapsed / DAY_MS);
  const hours = Math.floor((elapsed % DAY_MS) / HOUR_MS);
  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}

/**
 * `Implement 2/3 · 12m` — where the card is and how long it has been there.
 * The step is named *and* counted: the name says what is happening, the count
 * says how much pipeline is left, which the segment track only hints at. State
 * has its own badge, so this line never repeats it.
 */
export function cardStatusLine(
  card: OrchestrationCard,
  stepNames: ReadonlyArray<string>,
  nowMs: number,
): string {
  const position = cardStepLabel(card, stepNames);
  if (card.status !== "running") return position;
  const elapsed = formatElapsed(card.releasedAt, nowMs);
  return elapsed === null ? `${position} · running` : `${position} · ${elapsed}`;
}

function cardStepLabel(card: OrchestrationCard, stepNames: ReadonlyArray<string>): string {
  switch (card.position.kind) {
    case "todo":
      return "To-Do";
    case "done":
      return "Done";
    case "step": {
      const index = card.position.stepIndex;
      const name = stepNames[index];
      if (name === undefined) return `Step ${index + 1}`;
      return `${name} ${index + 1}/${stepNames.length}`;
    }
  }
}

export interface CardWorktreeLabel {
  /** What the row shows: the branch without the `board/` namespace. */
  readonly label: string;
  /** What the tooltip shows: the full branch, and the path when there is one. */
  readonly title: string;
}

/**
 * The worktree a card owns, said the way a person thinks of it: the branch
 * name. Cards live under a `board/` namespace nobody needs repeated on every
 * row, so the row drops it and the tooltip keeps the unabbreviated truth.
 * Null until release, and it survives a reset — the worktree does too.
 */
export function cardWorktreeLabel(card: OrchestrationCard): CardWorktreeLabel | null {
  const branch = card.branch?.trim();
  if (branch === undefined || branch === "") return null;
  const label = branch.startsWith(BOARD_BRANCH_PREFIX)
    ? branch.slice(BOARD_BRANCH_PREFIX.length)
    : branch;
  return {
    label: label === "" ? branch : label,
    title: card.worktreePath === null ? branch : `${branch}\n${card.worktreePath}`,
  };
}

const BOARD_BRANCH_PREFIX = "board/";

/** `issue_id: aqqua-482 · scope: web` — the card's inputs, in template order. */
export function summarizeCardParameters(
  parameters: Readonly<Record<string, string>>,
  parameterNames: ReadonlyArray<string>,
): string | null {
  const ordered = parameterNames.length > 0 ? parameterNames : Object.keys(parameters);
  const parts = ordered.flatMap((name) => {
    const value = parameters[name];
    return value === undefined || value.trim() === "" ? [] : [`${name}: ${value.trim()}`];
  });
  return parts.length === 0 ? null : parts.join(" · ");
}
