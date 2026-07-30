import type { OrchestrationThreadActivity } from "@t3tools/contracts";

const TRANSIENT_THREAD_ACTIVITY_KINDS = new Set([
  "tool.updated",
  "context-window.updated",
  "task.progress",
]);

export function isTransientThreadActivity(
  activity: Pick<OrchestrationThreadActivity, "kind">,
): boolean {
  return TRANSIENT_THREAD_ACTIVITY_KINDS.has(activity.kind);
}
