import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_RUNTIME_MODE, ProviderInstanceId, ThreadId } from "@aqqua/contracts";
import {
  classifyThreadPresentation,
  hasUnacknowledgedDoneState,
  hasUnseenFailure,
  resolveSidebarConversationAggregateState,
  resolveSidebarConversationSummaryState,
  resolveSidebarV2Status,
  toConversationSummaryState,
  toSidebarV2Status,
} from "./threadPresentationState";

const session = {
  threadId: ThreadId.make("thread-1"),
  status: "running" as const,
  providerName: "Codex",
  providerInstanceId: ProviderInstanceId.make("codex"),
  runtimeMode: DEFAULT_RUNTIME_MODE,
  activeTurnId: "turn-1" as never,
  lastError: null,
  updatedAt: "2026-03-09T10:00:00.000Z",
};

const completedTurn = {
  state: "completed" as const,
  completedAt: "2026-03-09T10:05:00.000Z",
  startedAt: "2026-03-09T10:00:00.000Z",
};

describe("classifyThreadPresentation", () => {
  it("keeps approval/input ahead of activity and treats error as failed", () => {
    expect(
      classifyThreadPresentation({
        hasPendingApprovals: true,
        hasPendingUserInput: true,
        session,
      }).phase,
    ).toBe("approval");
    expect(
      classifyThreadPresentation({
        hasPendingApprovals: false,
        hasPendingUserInput: true,
        session,
      }).phase,
    ).toBe("input");
    expect(
      classifyThreadPresentation({
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        session,
      }).phase,
    ).toBe("working");
    expect(
      classifyThreadPresentation({
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        session: { ...session, status: "starting" },
      }).phase,
    ).toBe("starting");
    expect(
      classifyThreadPresentation({
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        session: { ...session, status: "error" },
        latestTurn: completedTurn,
      }).phase,
    ).toBe("failed");
  });

  it("keeps plan-ready and unseen-completion orthogonal on ready only", () => {
    const presentation = classifyThreadPresentation({
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      hasActionableProposedPlan: true,
      interactionMode: "plan",
      latestTurn: completedTurn,
      lastVisitedAt: "2026-03-09T10:04:00.000Z",
      session: { ...session, status: "ready" },
    });
    expect(presentation.phase).toBe("ready");
    expect(presentation.planReady).toBe(true);
    expect(presentation.unseenCompletion).toBe(true);
  });

  it("never sets planReady while the session is failed", () => {
    const presentation = classifyThreadPresentation({
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      hasActionableProposedPlan: true,
      interactionMode: "plan",
      latestTurn: completedTurn,
      session: { ...session, status: "error" },
    });
    expect(presentation.phase).toBe("failed");
    expect(presentation.planReady).toBe(false);
  });
});

describe("canonical projections stay consistent", () => {
  it("projects session-error + completed turn as failed/stale, never done", () => {
    const thread = {
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      session: { ...session, status: "error" as const, lastError: "boom" },
      latestTurn: completedTurn,
    };
    const presentation = classifyThreadPresentation(thread);
    expect(toSidebarV2Status(presentation)).toBe("failed");
    expect(toConversationSummaryState(presentation, thread)).toBe("stale");
    expect(resolveSidebarV2Status(thread)).toBe("failed");
    expect(resolveSidebarConversationSummaryState(thread)).toBe("stale");
  });
});

describe("hasUnseenFailure", () => {
  it("clears a session failure once its conversation has been opened", () => {
    const failedSession = { ...session, status: "error" as const };

    expect(hasUnseenFailure({ session: failedSession })).toBe(true);
    expect(
      hasUnseenFailure({
        session: failedSession,
        lastVisitedAt: "2026-03-09T09:59:59.000Z",
      }),
    ).toBe(true);
    expect(
      hasUnseenFailure({
        session: failedSession,
        lastVisitedAt: failedSession.updatedAt,
      }),
    ).toBe(false);
  });

  it("uses the failed turn timestamp when the session has returned to ready", () => {
    expect(
      hasUnseenFailure({
        latestTurn: { ...completedTurn, state: "interrupted" },
        session: { ...session, status: "ready" },
        lastVisitedAt: "2026-03-09T10:05:01.000Z",
      }),
    ).toBe(false);
  });
});

describe("hasUnacknowledgedDoneState", () => {
  it("keeps completion visible until the conversation is opened", () => {
    expect(hasUnacknowledgedDoneState({ latestTurn: completedTurn })).toBe(true);
    expect(
      hasUnacknowledgedDoneState({
        latestTurn: completedTurn,
        lastVisitedAt: "2026-03-09T10:04:59.000Z",
      }),
    ).toBe(true);
    expect(
      hasUnacknowledgedDoneState({
        latestTurn: completedTurn,
        lastVisitedAt: completedTurn.completedAt,
      }),
    ).toBe(false);
  });

  it("keeps an initial Done signal until a never-run conversation is opened", () => {
    expect(hasUnacknowledgedDoneState({ latestTurn: null })).toBe(true);
    expect(
      hasUnacknowledgedDoneState({
        latestTurn: null,
        lastVisitedAt: "2026-03-09T10:05:00.000Z",
      }),
    ).toBe(false);
  });
});

describe("toConversationAggregateState", () => {
  const aggregate = (thread: Parameters<typeof resolveSidebarConversationAggregateState>[0]) =>
    resolveSidebarConversationAggregateState(thread);

  it("keeps a failure distinct instead of folding it into the resting state", () => {
    const thread = {
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      session: { ...session, status: "error" as const, lastError: "boom" },
      latestTurn: completedTurn,
    };
    expect(resolveSidebarConversationSummaryState(thread)).toBe("stale");
    expect(aggregate(thread)).toBe("failed");
  });

  it("reports an interrupted turn as failed", () => {
    expect(
      aggregate({
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        session: null,
        latestTurn: { state: "interrupted", startedAt: "2026-03-09T10:00:00.000Z" },
      }),
    ).toBe("failed");
  });

  it("puts pending approval and pending input ahead of a running session", () => {
    expect(aggregate({ hasPendingApprovals: true, session })).toBe("needsInput");
    expect(aggregate({ hasPendingUserInput: true, session })).toBe("needsInput");
  });

  it("treats a running or starting session as working", () => {
    expect(aggregate({ session })).toBe("working");
    expect(aggregate({ session: { ...session, status: "starting" } })).toBe("working");
  });

  it("treats a running turn without a live session as working", () => {
    expect(
      aggregate({
        session: null,
        latestTurn: { state: "running", startedAt: "2026-03-09T10:00:00.000Z" },
      }),
    ).toBe("working");
  });

  it("rests as done rather than failed for a completed, never-run, or unknown thread", () => {
    expect(aggregate({ session: null, latestTurn: completedTurn })).toBe("done");
    // A thread that has never run reports nothing at all. The counter model
    // calls this `stale`; a single label must not call it Failed.
    expect(resolveSidebarConversationSummaryState({ session: null })).toBe("stale");
    expect(aggregate({ session: null })).toBe("done");
    expect(aggregate({ session: null, latestTurn: {} })).toBe("done");
  });
});
