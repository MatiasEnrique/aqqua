import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/models";
import { useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { WorktreeDraftRow } from "../Sidebar.worktreeGroups";
import { ConversationThreadRow, conversationStatusKey } from "./ConversationThreadRow";
import { ConversationDraftRow, type SidebarThreadSection } from "./WorktreeCard";
import { sidebarThreadKey } from "./sidebarThreadFamilies";

const STATUS_ORDER = [
  "Working",
  "Needs input",
  "Failed",
  "Ready",
  "Idle",
  "Snoozed",
  "Settled",
] as const;
type SidebarStatusGroup = (typeof STATUS_ORDER)[number];
const STATUS_PRIORITY: readonly SidebarStatusGroup[] = [
  "Failed",
  "Needs input",
  "Working",
  "Ready",
  "Idle",
  "Snoozed",
  "Settled",
];
const EMPTY_THREADS: readonly EnvironmentThreadShell[] = [];

export function sidebarStatusGroup(thread: EnvironmentThreadShell, section: SidebarThreadSection) {
  if (section === "snoozed") return "Snoozed";
  if (section === "settled") return "Settled";
  switch (conversationStatusKey(thread, section)) {
    case "working":
      return "Working";
    case "approval":
    case "input":
    case "needsInput":
    case "planReady":
      return "Needs input";
    case "failed":
      return "Failed";
    case "done":
      return "Ready";
    default:
      return "Idle";
  }
}

export function sidebarFamilyStatusGroup(input: {
  readonly root: EnvironmentThreadShell;
  readonly descendants: readonly EnvironmentThreadShell[];
  readonly threadSectionByKey: ReadonlyMap<string, SidebarThreadSection>;
}): SidebarStatusGroup {
  const statuses = new Set<SidebarStatusGroup>();
  for (const thread of [input.root, ...input.descendants]) {
    statuses.add(
      sidebarStatusGroup(
        thread,
        input.threadSectionByKey.get(sidebarThreadKey(thread)) ?? "active",
      ),
    );
  }
  return STATUS_PRIORITY.find((status) => statuses.has(status)) ?? "Idle";
}

export function groupSidebarThreadsByStatus(input: {
  readonly threads: readonly EnvironmentThreadShell[];
  readonly descendantsByRoot: ReadonlyMap<string, readonly EnvironmentThreadShell[]>;
  readonly threadSectionByKey: ReadonlyMap<string, SidebarThreadSection>;
}): ReadonlyMap<SidebarStatusGroup, readonly EnvironmentThreadShell[]> {
  const groups = new Map<SidebarStatusGroup, EnvironmentThreadShell[]>();
  for (const thread of input.threads) {
    const key = sidebarThreadKey(thread);
    const status = sidebarFamilyStatusGroup({
      root: thread,
      descendants: input.descendantsByRoot.get(key) ?? EMPTY_THREADS,
      threadSectionByKey: input.threadSectionByKey,
    });
    const current = groups.get(status);
    if (current) current.push(thread);
    else groups.set(status, [thread]);
  }
  return groups;
}

interface ConversationGroupsProps {
  readonly grouping: "project" | "status";
  readonly threads: readonly EnvironmentThreadShell[];
  readonly drafts: readonly WorktreeDraftRow[];
  readonly descendantsByRoot: ReadonlyMap<string, readonly EnvironmentThreadShell[]>;
  readonly threadSectionByKey: ReadonlyMap<string, SidebarThreadSection>;
  readonly isMobile: boolean;
  readonly selectedThreadKey: string | null;
  readonly selectedDraftId: string | null;
  readonly onSelectThread: (event: ReactMouseEvent, thread: EnvironmentThreadShell) => void;
  readonly onThreadContextMenu: (
    event: ReactMouseEvent,
    thread: EnvironmentThreadShell,
    section: SidebarThreadSection,
  ) => void;
  readonly onToggleThreadSettled: (
    thread: EnvironmentThreadShell,
    section: SidebarThreadSection,
  ) => void;
  readonly onSelectDraft: (draft: WorktreeDraftRow) => void;
  readonly onDraftContextMenu: (event: ReactMouseEvent, draft: WorktreeDraftRow) => void;
}

export function SidebarConversationGroups(props: ConversationGroupsProps) {
  const statusGroups = useMemo(
    () =>
      props.grouping === "status"
        ? groupSidebarThreadsByStatus({
            threads: props.threads,
            descendantsByRoot: props.descendantsByRoot,
            threadSectionByKey: props.threadSectionByKey,
          })
        : null,
    [props.descendantsByRoot, props.grouping, props.threadSectionByKey, props.threads],
  );
  return (
    // Ungrouped, drafts and threads are one continuous list to the eye, so the
    // seam between their sections carries the same rhythm as the rows.
    <div
      className={props.grouping === "status" ? "space-y-4" : "space-y-1"}
      data-sidebar-conversation-groups={props.grouping}
    >
      {props.drafts.length > 0 ? (
        <section aria-label="Drafts">
          {props.grouping === "status" ? (
            <GroupHeading label="Drafts" count={props.drafts.length} />
          ) : null}
          <ul className="space-y-1">
            {props.drafts.map((draft) => (
              <ConversationDraftRow
                key={draft.draftId}
                draft={draft}
                isSelected={props.selectedDraftId === draft.draftId}
                onClick={() => props.onSelectDraft(draft)}
                onContextMenu={(event) => props.onDraftContextMenu(event, draft)}
              />
            ))}
          </ul>
        </section>
      ) : null}
      {props.grouping === "project" ? (
        <StatusGroup {...props} label="Conversations" />
      ) : (
        STATUS_ORDER.map((status) => {
          const threads = statusGroups?.get(status) ?? EMPTY_THREADS;
          return threads.length === 0 ? null : (
            <StatusGroup key={status} {...props} label={status} threads={threads} />
          );
        })
      )}
    </div>
  );
}

function GroupHeading(props: { readonly label: string; readonly count: number }) {
  return (
    <h3 className="mb-1 flex h-8 items-center gap-2 rounded-md bg-sidebar-control-surface/60 px-2 text-[13px] font-semibold text-sidebar-foreground">
      {props.label}
      <span className="text-[11px] font-normal tabular-nums text-sidebar-muted-foreground">
        {props.count}
      </span>
    </h3>
  );
}

export function visibleStatusGroupThreads(input: {
  readonly threads: readonly EnvironmentThreadShell[];
  readonly descendantsByRoot: ReadonlyMap<string, readonly EnvironmentThreadShell[]>;
  readonly selectedThreadKey: string | null;
  readonly limit: number;
}): { readonly threads: readonly EnvironmentThreadShell[]; readonly limit: number } {
  const selectedIndex = input.threads.findIndex(
    (thread) =>
      sidebarThreadKey(thread) === input.selectedThreadKey ||
      input.descendantsByRoot
        .get(sidebarThreadKey(thread))
        ?.some((child) => sidebarThreadKey(child) === input.selectedThreadKey),
  );
  const limit = Math.max(input.limit, selectedIndex + 1);
  return { threads: input.threads.slice(0, limit), limit };
}

function StatusGroup(props: ConversationGroupsProps & { readonly label: string }) {
  const [limit, setLimit] = useState(20);
  const visible = visibleStatusGroupThreads({
    threads: props.threads,
    descendantsByRoot: props.descendantsByRoot,
    selectedThreadKey: props.selectedThreadKey,
    limit,
  });
  return (
    <section aria-label={props.label}>
      {props.grouping === "status" ? (
        <GroupHeading label={props.label} count={props.threads.length} />
      ) : null}
      <ul className="space-y-1">
        {visible.threads.map((thread) => {
          const key = sidebarThreadKey(thread);
          const section = props.threadSectionByKey.get(key) ?? "active";
          return (
            <ConversationThreadRow
              key={key}
              thread={thread}
              section={section}
              descendants={props.descendantsByRoot.get(key)}
              descendantSectionByKey={props.threadSectionByKey}
              isMobile={props.isMobile}
              selectedThreadKey={props.selectedThreadKey}
              isSelected={props.selectedThreadKey === key}
              onClick={(event) => props.onSelectThread(event, thread)}
              onContextMenu={(event) => props.onThreadContextMenu(event, thread, section)}
              onToggleSettled={() => props.onToggleThreadSettled(thread, section)}
              onSelectDescendant={props.onSelectThread}
              onDescendantContextMenu={(event, child) =>
                props.onThreadContextMenu(
                  event,
                  child,
                  props.threadSectionByKey.get(sidebarThreadKey(child)) ?? "active",
                )
              }
            />
          );
        })}
      </ul>
      {visible.limit < props.threads.length ? (
        <button
          type="button"
          onClick={() => setLimit(visible.limit + 20)}
          className="mt-1 h-7 rounded-md px-2 text-[13px] text-sidebar-muted-foreground hover:bg-sidebar-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Show more
        </button>
      ) : null}
    </section>
  );
}
