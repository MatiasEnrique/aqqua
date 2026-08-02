import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_RUNTIME_MODE, ProviderInstanceId, ThreadId } from "@aqqua/contracts";
import {
  classifyThreadPresentation,
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
