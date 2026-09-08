import { scopedThreadKey, scopeThreadRef } from "@aqqua/client-runtime/environment";
import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/models";
import type { ContextMenuItem } from "@aqqua/contracts";
import {
  type CollisionDetection,
  closestCorners,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronRightIcon,
  CircleIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  GripVerticalIcon,
  Trash2Icon,
} from "lucide-react";
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useId,
  useMemo,
} from "react";
import { cn, isMacPlatform } from "~/lib/utils";
import { isTrailingDoubleClick } from "../Sidebar.logic";
import {
  resolveSidebarWorktreeDeleteAction,
  type SidebarWorktreeGroup,
  type WorktreeDraftRow,
} from "../Sidebar.worktreeGroups";
import { sidebarRegistryRowSurfaceClassName } from "../sidebar/card/SidebarCardSurface";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarWorktreeSummaryStateLabel } from "./SidebarStatusPresentations";
import { ConversationThreadRow } from "./ConversationThreadRow";
import { buildSidebarThreadFamilies } from "./sidebarThreadFamilies";

export type SidebarThreadSection = "active" | "snoozed" | "settled";

export type ConversationClickAction =
  | "toggle-selection"
  | "range-selection"
  | "navigate"
  | "ignore";

export function resolveConversationClickAction(input: {
  readonly platform: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly detail: number;
}): ConversationClickAction {
  const modifierPressed = isMacPlatform(input.platform) ? input.metaKey : input.ctrlKey;
  if (modifierPressed) return "toggle-selection";
  if (input.shiftKey) return "range-selection";
  if (isTrailingDoubleClick(input.detail)) return "ignore";
  return "navigate";
}

export type ThreadContextMenuAction =
  | "settle"
  | "unsettle"
  | "unsnooze"
  | "snooze"
  | "delete"
  | `snooze:${string}`;

export function buildThreadContextMenuItems(
  section: SidebarThreadSection,
  snoozePresets: readonly { readonly id: string; readonly label: string }[],
): readonly ContextMenuItem<ThreadContextMenuAction>[] {
  const deleteItem = {
    id: "delete" as const,
    label: "Delete",
    destructive: true,
    icon: "trash" as const,
  };
  if (section === "settled") {
    return [{ id: "unsettle", label: "Un-settle thread" }, deleteItem];
  }
  if (section === "snoozed") {
    return [
      { id: "unsnooze", label: "Wake thread" },
      { id: "settle", label: "Settle thread" },
      deleteItem,
    ];
  }
  return [
    { id: "settle", label: "Settle thread" },
    {
      id: "snooze",
      label: "Snooze",
      children: snoozePresets.map((preset) => ({
        id: `snooze:${preset.id}` as const,
        label: preset.label,
      })),
    },
    deleteItem,
  ];
}

export function orderThreadsParentFirst(
  threads: readonly EnvironmentThreadShell[],
): EnvironmentThreadShell[] {
  const threadKey = (thread: EnvironmentThreadShell) => `${thread.environmentId}:${thread.id}`;
  const includedKeys = new Set(threads.map(threadKey));
  const childrenByParentKey = new Map<string, EnvironmentThreadShell[]>();
  for (const thread of threads) {
    if (thread.parentThreadId === null) continue;
    const parentKey = `${thread.environmentId}:${thread.parentThreadId}`;
    const children = childrenByParentKey.get(parentKey);
    if (children) children.push(thread);
    else childrenByParentKey.set(parentKey, [thread]);
  }

  const ordered: EnvironmentThreadShell[] = [];
  const visited = new Set<string>();
  const append = (thread: EnvironmentThreadShell) => {
    const key = threadKey(thread);
    if (visited.has(key)) return;
    visited.add(key);
    ordered.push(thread);
    for (const child of childrenByParentKey.get(key) ?? []) append(child);
  };
  for (const thread of threads) {
    const parentKey =
      thread.parentThreadId === null ? null : `${thread.environmentId}:${thread.parentThreadId}`;
    if (parentKey === null || !includedKeys.has(parentKey)) append(thread);
  }
  // Corrupt or cyclic parent links must not make conversations disappear.
  for (const thread of threads) append(thread);
  return ordered;
}

/** A worktree heading with its conversations and drafts, grouped under the project. */
export function WorktreeCard(props: {
  readonly group: SidebarWorktreeGroup;
  readonly isSelected: boolean;
  readonly conversationsExpanded: boolean;
  readonly removingWorktreeKey: string | null;
  readonly onSelect: (group: SidebarWorktreeGroup) => void;
  readonly onConversationsExpandedChange: (expanded: boolean) => void;
  readonly onDeleteWorktree: (group: SidebarWorktreeGroup) => void;
  readonly onContextMenu: (event: ReactMouseEvent, group: SidebarWorktreeGroup) => void;
  /** All conversation shells in this worktree, including settled history. */
  readonly threads?: readonly EnvironmentThreadShell[];
  readonly descendantsByRoot?: ReadonlyMap<string, readonly EnvironmentThreadShell[]>;
  readonly threadSectionByKey?: ReadonlyMap<string, SidebarThreadSection>;
  readonly isMobile?: boolean;
  readonly selectedThreadKey?: string | null;
  readonly selectedDraftId?: string | null;
  readonly onSelectThread?: (event: ReactMouseEvent, thread: EnvironmentThreadShell) => void;
  readonly onSelectDraft?: (draft: WorktreeDraftRow) => void;
  readonly onThreadContextMenu?: (
    event: ReactMouseEvent,
    thread: EnvironmentThreadShell,
    section: SidebarThreadSection,
  ) => void;
  readonly onToggleThreadSettled?: (
    thread: EnvironmentThreadShell,
    section: SidebarThreadSection,
  ) => void;
  readonly onDraftContextMenu?: (event: ReactMouseEvent, draft: WorktreeDraftRow) => void;
  readonly sortable?: WorktreeSortable;
}) {
  const { group } = props;
  const conversationListId = useId();
  const families = useMemo(() => buildSidebarThreadFamilies(props.threads ?? []), [props.threads]);
  const threads = families.roots;
  const descendantsByRoot = props.descendantsByRoot ?? families.descendantsByRoot;
  const sectionOf = (thread: EnvironmentThreadShell): SidebarThreadSection => {
    const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    return props.threadSectionByKey?.get(key) ?? (isSettledThread(thread) ? "settled" : "active");
  };
  const activeThreads = orderThreadsParentFirst(
    threads.filter((thread) => sectionOf(thread) === "active"),
  );
  const snoozedThreads = orderThreadsParentFirst(
    threads.filter((thread) => sectionOf(thread) === "snoozed"),
  );
  // Settled conversations belong to the sidebar's own settled shelf, not to
  // every worktree in turn: a card that repeated them made the same finished
  // work show up once per checkout.
  const hasConversationRows =
    props.threads !== undefined &&
    (activeThreads.length > 0 || snoozedThreads.length > 0 || group.drafts.length > 0);
  const deleteAction = resolveSidebarWorktreeDeleteAction({
    isProjectCheckout: group.isProjectCheckout,
    worktreeCreated: group.workspaceRoot !== null && group.projectRoot !== null,
    isRemoving: props.removingWorktreeKey !== null,
    isSettling: false,
  });
  const showDeleteAction =
    !group.isProjectCheckout && group.workspaceRoot !== null && group.projectRoot !== null;
  const summaryState = group.summaryState === "settled" ? null : group.summaryState;

  return (
    // `data-thread-selection-safe`, not `data-thread-item`: the card is a
    // worktree, and marquee selection, range selection and keyboard traversal
    // all treat a thread item as a selectable conversation.
    <li
      ref={props.sortable?.setNodeRef}
      style={props.sortable?.style}
      data-thread-selection-safe
      data-testid={`worktree-card-${group.key}`}
      className={cn(
        "group/worktree relative list-none rounded-lg pb-3",
        props.sortable?.isDragging && "z-20 opacity-80",
        props.sortable?.isOver && !props.sortable.isDragging && "ring-1 ring-primary/40",
      )}
    >
      <Collapsible
        open={props.conversationsExpanded}
        onOpenChange={props.onConversationsExpandedChange}
      >
        <div
          className={cn(
            "relative flex h-8 items-center gap-1.5 rounded-md pl-1 pr-2 transition-colors duration-(--duration-fast) ease-(--ease-fluid)",
            // Selection is a *tinted* surface, not a lifted white one: the
            // registry sits on the sidebar's own ground, and hover is the same
            // material at half strength so the two never read as one state.
            sidebarRegistryRowSurfaceClassName(
              props.isSelected && (!hasConversationRows || !props.conversationsExpanded),
            ),
          )}
        >
          {props.sortable ? (
            <WorktreeDragHandle
              label={group.label}
              sortable={props.sortable}
              className="absolute -left-px z-10 opacity-0 pointer-fine:group-hover/worktree:opacity-100 group-focus-within/worktree:opacity-100 focus-visible:opacity-100"
            />
          ) : null}
          <button
            type="button"
            onClick={() => props.onSelect(group)}
            onContextMenu={(event) => props.onContextMenu(event, group)}
            aria-current={props.isSelected ? "true" : undefined}
            className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <GitBranchIcon
              aria-hidden
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground",
                props.sortable &&
                  "pointer-fine:group-hover/worktree:opacity-0 group-focus-within/worktree:opacity-0",
              )}
            />
            <span className="min-w-0 truncate text-[13px] font-semibold text-sidebar-foreground">
              {group.label}
            </span>
            {/* The kind is the first thing to go when the sidebar narrows: the
              branch name and the state both carry more, and this row has to
              survive being dragged well below the design's 360px. */}
            <span className="sr-only">
              {group.isProjectCheckout ? "current checkout" : "worktree"}
            </span>
            {group.mergedChangeRequestNumber === null ? null : (
              <span
                role="status"
                aria-label={`Pull request #${group.mergedChangeRequestNumber} merged`}
                className="ml-auto inline-flex shrink-0 items-center gap-1 pl-2 text-[11px] font-semibold text-violet-600 tabular-nums dark:text-violet-300"
              >
                <GitPullRequestIcon aria-hidden className="size-3.5" />
                <span>#{group.mergedChangeRequestNumber}</span>
              </span>
            )}
            {summaryState === null ||
            (hasConversationRows &&
              props.conversationsExpanded &&
              summaryState === "done") ? null : (
              <SidebarWorktreeSummaryStateLabel
                state={summaryState}
                className={group.mergedChangeRequestNumber === null ? "ml-auto pl-2" : "pl-1"}
              />
            )}
          </button>
          {hasConversationRows ? (
            <CollapsibleTrigger
              type="button"
              aria-controls={conversationListId}
              aria-label={`${props.conversationsExpanded ? "Collapse" : "Expand"} conversations in worktree ${group.label}`}
              className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 outline-none transition-[background-color,color,transform] duration-(--duration-fast) ease-(--ease-fluid) hover:bg-sidebar-row-hover hover:text-sidebar-foreground active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transform-none"
            >
              <ChevronRightIcon
                aria-hidden
                className={cn(
                  "size-3.5 transition-transform duration-(--duration-fast) ease-(--ease-fluid) motion-reduce:transition-none",
                  props.conversationsExpanded && "rotate-90",
                )}
              />
            </CollapsibleTrigger>
          ) : null}
          {showDeleteAction ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={`Delete worktree ${group.label}`}
                    disabled={!deleteAction.enabled}
                    onClick={() => props.onDeleteWorktree(group)}
                    className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md pointer-fine:opacity-0 pointer-fine:group-hover/worktree:opacity-100 group-focus-within/worktree:opacity-100 text-muted-foreground/55 outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-destructive/40 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-muted-foreground/55"
                  />
                }
              >
                <Trash2Icon aria-hidden className="size-3.5" />
              </TooltipTrigger>
              <TooltipPopup side="right">
                {deleteAction.enabled ? "Delete worktree" : deleteAction.disabledReason}
              </TooltipPopup>
            </Tooltip>
          ) : null}
        </div>
        {hasConversationRows ? (
          <CollapsiblePanel
            id={conversationListId}
            className="transition-[height,opacity] duration-200 ease-(--ease-fluid) data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none"
          >
            <ul className="space-y-1 pt-1">
              {group.drafts.map((draft) => (
                <ConversationDraftRow
                  key={`draft:${draft.draftId}`}
                  draft={draft}
                  isSelected={props.selectedDraftId === draft.draftId}
                  onClick={() => {
                    if (props.onSelectDraft) {
                      props.onSelectDraft(draft);
                    } else {
                      props.onSelect(group);
                    }
                  }}
                  onContextMenu={(event) => {
                    if (props.onDraftContextMenu) props.onDraftContextMenu(event, draft);
                    else props.onContextMenu(event, group);
                  }}
                />
              ))}
              {[...activeThreads, ...snoozedThreads].map((thread) => {
                const section = sectionOf(thread);
                const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
                return (
                  <ConversationThreadRow
                    key={`thread:${thread.environmentId}:${thread.id}`}
                    thread={thread}
                    descendants={descendantsByRoot.get(threadKey)}
                    descendantSectionByKey={props.threadSectionByKey}
                    isMobile={props.isMobile}
                    selectedThreadKey={props.selectedThreadKey}
                    onSelectDescendant={props.onSelectThread}
                    onDescendantContextMenu={(event, child) =>
                      props.onThreadContextMenu?.(event, child, sectionOf(child))
                    }
                    section={section}
                    isSelected={props.selectedThreadKey === threadKey}
                    onClick={(event) => {
                      if (props.onSelectThread) {
                        props.onSelectThread(event, thread);
                      } else {
                        props.onSelect(group);
                      }
                    }}
                    onContextMenu={(event) => {
                      if (props.onThreadContextMenu) {
                        props.onThreadContextMenu(event, thread, section);
                      } else {
                        props.onContextMenu(event, group);
                      }
                    }}
                    {...(props.onToggleThreadSettled
                      ? {
                          onToggleSettled: () => props.onToggleThreadSettled?.(thread, section),
                        }
                      : {})}
                  />
                );
              })}
            </ul>
          </CollapsiblePanel>
        ) : null}
      </Collapsible>
    </li>
  );
}

export function ConversationDraftRow(props: {
  readonly draft: WorktreeDraftRow;
  readonly isSelected: boolean;
  readonly onClick: () => void;
  readonly onContextMenu: (event: ReactMouseEvent) => void;
}) {
  const metadata = ["Draft", props.draft.baseBranch].filter(Boolean).join(" · ");

  return (
    <li
      data-thread-item
      className="relative list-none [content-visibility:auto] [contain-intrinsic-size:auto_40px]"
    >
      <button
        type="button"
        onClick={props.onClick}
        onContextMenu={props.onContextMenu}
        aria-current={props.isSelected ? "page" : undefined}
        className={cn(
          "flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-md py-0.5 pl-6 pr-10 text-left outline-none transition-colors duration-(--duration-fast) ease-(--ease-fluid)",
          props.isSelected
            ? "bg-sidebar-row-active text-sidebar-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-row-hover",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-normal leading-5">
            {props.draft.title}
          </span>
          <span className="block truncate text-[11px] leading-4 text-sidebar-muted-foreground">
            {metadata}
          </span>
        </span>
      </button>
      {/* The trailing glyph sits in the same 40px seat as a conversation row's
        status indicator, so both line up under the worktree's expand chevron. */}
      <span className="pointer-events-none absolute right-0 top-0 inline-flex size-10 items-center justify-center">
        <CircleIcon aria-hidden className="size-3.5 text-sidebar-muted-foreground/60" />
      </span>
    </li>
  );
}

function isSettledThread(thread: EnvironmentThreadShell): boolean {
  return (
    thread.settledOverride === "settled" ||
    (thread.settledOverride !== "active" && thread.settledAt !== null)
  );
}

const worktreeCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCorners(args);
};

export type WorktreeSortable = ReturnType<typeof useSortable> & {
  readonly style: CSSProperties;
};

export function WorktreeDragHandle(props: {
  readonly label: string;
  readonly sortable: WorktreeSortable;
  readonly className?: string;
}) {
  return (
    <button
      type="button"
      ref={props.sortable.setActivatorNodeRef}
      {...props.sortable.attributes}
      {...props.sortable.listeners}
      aria-label={`Reorder worktree ${props.label}`}
      title={`Reorder worktree ${props.label}`}
      className={cn(
        "inline-flex size-6 shrink-0 touch-none cursor-grab items-center justify-center rounded-md text-muted-foreground/45 outline-none hover:bg-sidebar-control-surface hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
        props.className,
      )}
    >
      <GripVerticalIcon aria-hidden className="size-3.5" />
    </button>
  );
}

function SortableWorktreeItem(props: {
  readonly group: SidebarWorktreeGroup;
  readonly disabled: boolean;
  readonly children: (group: SidebarWorktreeGroup, sortable: WorktreeSortable | null) => ReactNode;
}) {
  const sortable = useSortable({
    id: props.group.key,
    disabled: props.disabled,
  });
  return props.children(
    props.group,
    props.disabled
      ? null
      : {
          ...sortable,
          style: {
            transform: CSS.Translate.toString(sortable.transform),
            transition: sortable.transition,
          },
        },
  );
}

function SortableWorktreeRun(props: {
  readonly groups: readonly SidebarWorktreeGroup[];
  readonly onReorder: (draggedWorktreeKey: string, targetWorktreeKey: string) => void;
  readonly children: (group: SidebarWorktreeGroup, sortable: WorktreeSortable | null) => ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const sortable = props.groups.length >= 2;
  const handleDragEnd = (event: DragEndEvent) => {
    if (!sortable || !event.over || event.active.id === event.over.id) return;
    props.onReorder(String(event.active.id), String(event.over.id));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={worktreeCollisionDetection}
      modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={props.groups.map((group) => group.key)}
        strategy={verticalListSortingStrategy}
      >
        {props.groups.map((group) => (
          <SortableWorktreeItem key={`worktree:${group.key}`} group={group} disabled={!sortable}>
            {props.children}
          </SortableWorktreeItem>
        ))}
      </SortableContext>
    </DndContext>
  );
}

/** A project-local sortable run. Worktrees cannot be dragged into another project. */
export function SortableWorktreeCardList(props: {
  readonly groups: readonly SidebarWorktreeGroup[];
  readonly activeWorktreeKey: string | null;
  readonly worktreeConversationExpandedByKey: Readonly<Record<string, boolean>>;
  readonly removingWorktreeKey: string | null;
  readonly onSelect: (group: SidebarWorktreeGroup) => void;
  readonly onWorktreeConversationExpandedChange: (worktreeKey: string, expanded: boolean) => void;
  readonly onDeleteWorktree: (group: SidebarWorktreeGroup) => void;
  readonly onContextMenu: (event: ReactMouseEvent, group: SidebarWorktreeGroup) => void;
  readonly onReorder: (draggedWorktreeKey: string, targetWorktreeKey: string) => void;
  readonly threadsByWorktreeKey?: ReadonlyMap<string, readonly EnvironmentThreadShell[]>;
  readonly descendantsByRoot?: ReadonlyMap<string, readonly EnvironmentThreadShell[]>;
  readonly threadSectionByKey?: ReadonlyMap<string, SidebarThreadSection>;
  readonly isMobile?: boolean;
  readonly selectedThreadKey?: string | null;
  readonly selectedDraftId?: string | null;
  readonly onSelectThread?: (event: ReactMouseEvent, thread: EnvironmentThreadShell) => void;
  readonly onSelectDraft?: (draft: WorktreeDraftRow) => void;
  readonly onThreadContextMenu?: (
    event: ReactMouseEvent,
    thread: EnvironmentThreadShell,
    section: SidebarThreadSection,
  ) => void;
  readonly onToggleThreadSettled?: (
    thread: EnvironmentThreadShell,
    section: SidebarThreadSection,
  ) => void;
  readonly onDraftContextMenu?: (event: ReactMouseEvent, draft: WorktreeDraftRow) => void;
}) {
  return (
    <SortableWorktreeRun groups={props.groups} onReorder={props.onReorder}>
      {(group, sortable) => (
        <WorktreeCard
          group={group}
          isSelected={props.activeWorktreeKey === group.key}
          conversationsExpanded={props.worktreeConversationExpandedByKey[group.key] ?? true}
          removingWorktreeKey={props.removingWorktreeKey}
          onSelect={props.onSelect}
          onConversationsExpandedChange={(expanded) =>
            props.onWorktreeConversationExpandedChange(group.key, expanded)
          }
          onDeleteWorktree={props.onDeleteWorktree}
          onContextMenu={props.onContextMenu}
          {...(props.threadsByWorktreeKey
            ? { threads: props.threadsByWorktreeKey.get(group.key) ?? [] }
            : {})}
          {...(props.descendantsByRoot ? { descendantsByRoot: props.descendantsByRoot } : {})}
          {...(props.threadSectionByKey ? { threadSectionByKey: props.threadSectionByKey } : {})}
          {...(props.isMobile !== undefined ? { isMobile: props.isMobile } : {})}
          {...(props.selectedThreadKey !== undefined
            ? { selectedThreadKey: props.selectedThreadKey }
            : {})}
          {...(props.selectedDraftId !== undefined
            ? { selectedDraftId: props.selectedDraftId }
            : {})}
          {...(props.onSelectThread ? { onSelectThread: props.onSelectThread } : {})}
          {...(props.onSelectDraft ? { onSelectDraft: props.onSelectDraft } : {})}
          {...(props.onThreadContextMenu ? { onThreadContextMenu: props.onThreadContextMenu } : {})}
          {...(props.onToggleThreadSettled
            ? { onToggleThreadSettled: props.onToggleThreadSettled }
            : {})}
          {...(props.onDraftContextMenu ? { onDraftContextMenu: props.onDraftContextMenu } : {})}
          {...(sortable ? { sortable } : {})}
        />
      )}
    </SortableWorktreeRun>
  );
}
