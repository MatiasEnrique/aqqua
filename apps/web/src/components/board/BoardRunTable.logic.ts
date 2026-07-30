import type { CardStatus, OrchestrationCard } from "@t3tools/contracts";

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
  cancelled: { label: "Cancelled", variant: "secondary" },
};

export function cardStatusPresentation(card: OrchestrationCard): BoardStatusPresentation | null {
  if (card.position.kind === "done") {
    return { label: "Done", variant: "success" };
  }
  return card.status === null ? null : STATUS_PRESENTATIONS[card.status];
}

/** The current segment borrows the status color; a clean run stays neutral. */
export function currentSegmentVariant(card: OrchestrationCard): BoardBadgeVariant {
  if (card.status === null) return "info";
  return STATUS_PRESENTATIONS[card.status].variant;
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

const FLAGGED_STATUSES: ReadonlySet<CardStatus> = new Set<CardStatus>([
  "needs-input",
  "failed",
  "cancelled",
  "paused",
]);

/**
 * Recovery actions on an in-flight row: cancel what is running, retry what is
 * flagged, continue what is parked. Position never changes for status reasons,
 * so a row keeps its place whichever one the user hits.
 */
export function inFlightRowActions(card: OrchestrationCard): BoardRowActions {
  if (card.position.kind !== "step") {
    return { cancel: false, retry: false, continue: false };
  }
  const status = card.status;
  return {
    cancel: status === "running",
    retry: status !== null && FLAGGED_STATUSES.has(status),
    continue: status === "paused",
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

/** `issue_id: T3-482 · scope: web` — the card's inputs, in template order. */
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
