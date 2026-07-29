export type SidebarConversationSummaryState = "working" | "done" | "stale";

type SidebarConversationSummaryStateInput = {
  readonly latestTurn?: {
    readonly state: "running" | "interrupted" | "completed" | "error";
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
  } | null;
};

export function resolveSidebarConversationSummaryState(
  thread: SidebarConversationSummaryStateInput,
): SidebarConversationSummaryState {
  if (thread.session?.status === "running" || thread.session?.status === "starting") {
    return "working";
  }
  if (thread.latestTurn != null) {
    return thread.latestTurn.state === "completed"
      ? "done"
      : thread.latestTurn.state === "running"
        ? "working"
        : "stale";
  }
  if (thread.session?.status === "idle" || thread.session?.status === "ready") {
    return "done";
  }
  return "stale";
}
