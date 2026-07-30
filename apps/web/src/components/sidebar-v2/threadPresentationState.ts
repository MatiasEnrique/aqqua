/**
 * Canonical sidebar presentation for a thread.
 *
 * Phase is mutually exclusive and priority-ordered: pending approval/input
 * outrank activity; running/starting stay active; session error is failure;
 * everything else is ready. Plan-ready and unseen-completion are orthogonal
 * attention/completion signals and must not be folded into phase.
 */
export type ThreadPresentationPhase =
  | "approval"
  | "input"
  | "working"
  | "starting"
  | "failed"
  | "ready";

export type ThreadPresentationState = {
  readonly phase: ThreadPresentationPhase;
  /** Orthogonal: a settled plan turn has an actionable proposed plan. */
  readonly planReady: boolean;
  /** Orthogonal: latest completion is newer than the last visit marker. */
  readonly unseenCompletion: boolean;
};

export type ThreadPresentationInput = {
  readonly hasActionableProposedPlan?: boolean;
  readonly hasPendingApprovals?: boolean;
  readonly hasPendingUserInput?: boolean;
  readonly interactionMode?: string | null;
  readonly latestTurn?: {
    readonly state?: "running" | "interrupted" | "completed" | "error";
    readonly completedAt?: string | null;
    readonly startedAt?: string | null;
  } | null;
  readonly session?: {
    readonly status:
      | "idle"
      | "starting"
      | "running"
      | "ready"
      | "interrupted"
      | "stopped"
      | "error";
    readonly activeTurnId?: unknown;
    readonly lastError?: string | null;
  } | null;
  readonly lastVisitedAt?: string | undefined;
};

/** Aggregate counters for worktree/project summaries. */
export type SidebarConversationSummaryState = "working" | "needsInput" | "done" | "stale";

/** Edge-strip / row status used by Sidebar V2 cards. */
export type SidebarV2Status = "approval" | "input" | "working" | "failed" | "ready";

export function hasUnseenCompletion(thread: ThreadPresentationInput): boolean {
  if (!thread.latestTurn?.completedAt) return false;
  const completedAt = Date.parse(thread.latestTurn.completedAt);
  if (Number.isNaN(completedAt)) return false;
  if (!thread.lastVisitedAt) return false;

  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

function isPresentationTurnSettled(
  latestTurn: ThreadPresentationInput["latestTurn"],
  session: ThreadPresentationInput["session"],
): boolean {
  if (!latestTurn?.startedAt) return false;
  if (!latestTurn.completedAt) return false;
  if (!session) return true;
  if (session.status === "running") return false;
  return true;
}

export function classifyThreadPresentation(
  thread: ThreadPresentationInput,
): ThreadPresentationState {
  let phase: ThreadPresentationPhase;
  if (thread.hasPendingApprovals) {
    phase = "approval";
  } else if (thread.hasPendingUserInput) {
    phase = "input";
  } else if (thread.session?.status === "running") {
    phase = "working";
  } else if (thread.session?.status === "starting") {
    phase = "starting";
  } else if (thread.session?.status === "error") {
    phase = "failed";
  } else {
    phase = "ready";
  }

  // Plan-ready is only meaningful on a ready resting thread — never while
  // the phase already demands action, is mid-flight, or has failed.
  const planReady =
    phase === "ready" &&
    !thread.hasPendingUserInput &&
    thread.interactionMode === "plan" &&
    isPresentationTurnSettled(thread.latestTurn, thread.session) &&
    Boolean(thread.hasActionableProposedPlan);

  return {
    phase,
    planReady,
    unseenCompletion: hasUnseenCompletion(thread),
  };
}

/** Row edge-strip status projected from the canonical phase. */
export function toSidebarV2Status(state: ThreadPresentationState): SidebarV2Status {
  switch (state.phase) {
    case "approval":
      return "approval";
    case "input":
      return "input";
    case "working":
    case "starting":
      return "working";
    case "failed":
      return "failed";
    case "ready":
      return "ready";
  }
}

/**
 * Conversation summary for worktree/project aggregates.
 *
 * Session error is always stale (never done), even when the latest turn
 * completed — the failure must remain visible in aggregate counters.
 */
export function toConversationSummaryState(
  state: ThreadPresentationState,
  thread: ThreadPresentationInput,
): SidebarConversationSummaryState {
  switch (state.phase) {
    case "approval":
    case "input":
      return "needsInput";
    case "working":
    case "starting":
      return "working";
    case "failed":
      return "stale";
    case "ready": {
      if (thread.latestTurn != null) {
        if (thread.latestTurn.state === "completed") return "done";
        if (thread.latestTurn.state === "running") return "working";
        // interrupted/error/missing state → stale
        return "stale";
      }
      if (thread.session?.status === "idle" || thread.session?.status === "ready") {
        return "done";
      }
      return "stale";
    }
  }
}

export function resolveSidebarV2Status(thread: ThreadPresentationInput): SidebarV2Status {
  return toSidebarV2Status(classifyThreadPresentation(thread));
}

export function resolveSidebarConversationSummaryState(
  thread: ThreadPresentationInput,
): SidebarConversationSummaryState {
  const presentation = classifyThreadPresentation(thread);
  return toConversationSummaryState(presentation, thread);
}
