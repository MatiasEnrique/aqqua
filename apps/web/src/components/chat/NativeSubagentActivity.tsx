import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/models";
import { scopeThreadRef } from "@aqqua/client-runtime/environment";
import type { ScopedThreadRef, ThreadId } from "@aqqua/contracts";
import { memo, useMemo } from "react";

import { cn } from "~/lib/utils";
import { providerSubagentProviderLabel } from "../ChatView.logic";
import { resolveSidebarConversationAggregateState } from "../Sidebar.summaryState";
import { StatusIndicator } from "../StatusIndicator";

export interface NativeSubagentActivityItem {
  readonly thread: EnvironmentThreadShell;
  readonly threadRef: ScopedThreadRef;
  readonly providerLabel: string;
  readonly state: ReturnType<typeof resolveSidebarConversationAggregateState>;
}

type NativeSubagentThreadShell = EnvironmentThreadShell & {
  readonly providerSubagent: NonNullable<EnvironmentThreadShell["providerSubagent"]>;
};

/**
 * Stable, spawn-order presentation for native children sharing one owner
 * session. The list is computed once per shell snapshot, not per rendered row.
 */
export function buildNativeSubagentActivityItems(
  threads: readonly EnvironmentThreadShell[],
): NativeSubagentActivityItem[] {
  return threads
    .filter((thread): thread is NativeSubagentThreadShell => thread.providerSubagent != null)
    .sort((left, right) => {
      const byCreatedAt = Date.parse(left.createdAt) - Date.parse(right.createdAt);
      return Number.isFinite(byCreatedAt) && byCreatedAt !== 0
        ? byCreatedAt
        : String(left.id).localeCompare(String(right.id));
    })
    .map((thread) => ({
      thread,
      threadRef: scopeThreadRef(thread.environmentId, thread.id),
      providerLabel: providerSubagentProviderLabel(thread.providerSubagent.provider),
      state: resolveSidebarConversationAggregateState(thread),
    }));
}

/**
 * Native harness children are subordinate activity inside one provider
 * session, so they never earn a conversation tab. Instead they hang as a
 * right-aligned column over the transcript margin — a margin note, not a
 * panel: no border, no background, no reserved width. Selecting an entry
 * swaps which transcript the pane shows; the owner's tab stays the active
 * tab throughout, so returning to the parent is just clicking it (or the
 * worktree in the sidebar when tabs are hidden).
 */
export const NativeSubagentActivity = memo(function NativeSubagentActivity(props: {
  readonly ownerTitle: string;
  readonly agents: readonly EnvironmentThreadShell[];
  readonly activeChildId: ThreadId | null;
  readonly onSelectThread: (threadRef: ScopedThreadRef) => void;
}) {
  const items = useMemo(() => buildNativeSubagentActivityItems(props.agents), [props.agents]);

  if (items.length === 0) return null;

  return (
    <nav
      aria-label={`Native agent activity for ${props.ownerTitle}`}
      data-native-subagent-activity
      className="absolute top-2 right-2 z-10 flex flex-col items-end gap-0.5 sm:right-3"
    >
      {items.map((item) => {
        const active = item.thread.id === props.activeChildId;
        return (
          <button
            key={item.threadRef.threadId}
            type="button"
            title={`${item.thread.title} — ${item.providerLabel}`}
            aria-current={active ? "page" : undefined}
            data-native-subagent-activity-item={item.threadRef.threadId}
            onClick={() => props.onSelectThread(item.threadRef)}
            className={cn(
              "flex max-w-40 cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-xs outline-none transition-colors duration-(--duration-fast) focus-visible:ring-2 focus-visible:ring-ring sm:max-w-56",
              active
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <span className="min-w-0 truncate">{item.thread.title}</span>
            <StatusIndicator state={item.state} size="size-1.5" />
          </button>
        );
      })}
    </nav>
  );
});
