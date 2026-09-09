import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/models";
import { ChevronRightIcon, RotateCcwIcon, Trash2Icon, XIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { cn, isMacPlatform } from "~/lib/utils";
import { useThreadSelectionStore } from "../../threadSelectionStore";
import { ProjectFavicon } from "../ProjectFavicon";
import { sidebarProjectKey } from "../Sidebar.worktreeGroups";
import {
  type DragBand,
  type DragSelectableRow,
  dragBand,
  exceedsDragThreshold,
  rowsWithinBand,
} from "./dragSelection";
import { sidebarThreadKey } from "./sidebarThreadFamilies";
import { resolveConversationClickAction } from "./WorktreeCard";

/**
 * Settled work is history, so the shelf shows the tail of it rather than all
 * of it: enough to recognise what was just put down, not enough to become a
 * second inbox. Everything older stays reachable through search.
 */
const RECENTLY_SETTLED_LIMIT = 10;

/** Both row actions share one hit target, so the pair reads as one cluster. */
const ACTION_BUTTON =
  "inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground outline-none transition-[background-color,color,transform] duration-(--duration-fast) ease-(--ease-fluid) active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transform-none";

interface DragState {
  readonly pointerId: number;
  /** Press point, in client coordinates — the same space the rows are measured in. */
  readonly originClient: { readonly x: number; readonly y: number };
  /** Top-left of the list, so the band can be drawn in list-relative coordinates. */
  readonly listOrigin: { readonly x: number; readonly y: number };
  /** A modifier held at press time means "add to what is already selected". */
  readonly additive: boolean;
  base: readonly string[];
  rows: readonly DragSelectableRow[];
  active: boolean;
}

function readRowBounds(list: HTMLElement): readonly DragSelectableRow[] {
  return [...list.querySelectorAll<HTMLElement>("[data-settled-row]")].flatMap((row) => {
    const key = row.dataset.settledRow;
    if (key === undefined) return [];
    const rect = row.getBoundingClientRect();
    return [{ key, top: rect.top, bottom: rect.bottom }];
  });
}

/**
 * One shelf of recently settled conversations, at the foot of the list.
 *
 * Deliberately thinner than a conversation row: no status dot, no branch, no
 * timestamp. A settled conversation has nothing left to report, so the row
 * carries only what identifies it — its project and its title — plus the two
 * actions it has left: coming back, or going away for good. The section stays
 * shut until someone asks for it.
 *
 * Because the shelf is where conversations are cleared out for good, it also
 * carries the sidebar's only bulk affordance: rows take Cmd/Ctrl+Click,
 * Shift+Click and a drag marquee, and a selection can be deleted in one go.
 */
export function SidebarSettledSection(props: {
  readonly threads: readonly EnvironmentThreadShell[];
  readonly projectCwdByKey: ReadonlyMap<string, string>;
  readonly projectDisplayNameByKey: ReadonlyMap<string, string>;
  readonly selectedThreadKey: string | null;
  readonly onSelectThread: (event: ReactMouseEvent, thread: EnvironmentThreadShell) => void;
  readonly onThreadContextMenu: (event: ReactMouseEvent, thread: EnvironmentThreadShell) => void;
  /** Un-settles the conversation, which drops it back into its project. */
  readonly onRestoreThread: (thread: EnvironmentThreadShell) => void;
  /** Deletes conversations for good without another confirmation prompt. */
  readonly onDeleteThreads: (threads: readonly EnvironmentThreadShell[]) => void;
}) {
  const { onSelectThread } = props;
  const [manuallyExpanded, setManuallyExpanded] = useState<boolean | null>(null);
  const recent = props.threads.slice(0, RECENTLY_SETTLED_LIMIT);
  // Routing into a settled conversation opens the shelf on its own, so the
  // route and the list can never disagree about where the selection lives.
  // A deliberate toggle outranks that, in both directions.
  const holdsSelection = recent.some(
    (thread) => sidebarThreadKey(thread) === props.selectedThreadKey,
  );
  const expanded = manuallyExpanded ?? holdsSelection;

  const selectedThreadKeys = useThreadSelectionStore((store) => store.selectedThreadKeys);
  const removeFromSelection = useThreadSelectionStore((store) => store.removeFromSelection);
  const listRef = useRef<HTMLUListElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const [pressing, setPressing] = useState(false);
  const [band, setBand] = useState<DragBand | null>(null);

  const selectedThreads = recent.filter((thread) =>
    selectedThreadKeys.has(sidebarThreadKey(thread)),
  );
  // Read through a ref by the handlers and effects below: the shelf's rows are
  // rebuilt on every render, and neither the range-click nor the collapse
  // cleanup wants to be rebound that often.
  const shelfKeysRef = useRef<readonly string[]>([]);
  shelfKeysRef.current = recent.map(sidebarThreadKey);

  // A shut shelf hides its rows, and a selection nobody can see is a bulk
  // action nobody can predict.
  useEffect(() => {
    if (expanded) return;
    removeFromSelection(shelfKeysRef.current);
  }, [expanded, removeFromSelection]);

  useEffect(() => {
    if (!pressing) return;
    const endDrag = () => {
      dragRef.current = null;
      setPressing(false);
      setBand(null);
    };
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag === null || event.pointerId !== drag.pointerId) return;
      const point = { x: event.clientX, y: event.clientY };
      if (!drag.active) {
        if (!exceedsDragThreshold(drag.originClient, point)) return;
        const list = listRef.current;
        if (list === null) return;
        drag.active = true;
        drag.rows = readRowBounds(list);
        drag.base = drag.additive ? [...useThreadSelectionStore.getState().selectedThreadKeys] : [];
        // The press that started the drag must not also open a conversation.
        suppressClickRef.current = true;
      }
      const covered = dragBand(drag.originClient, point);
      useThreadSelectionStore
        .getState()
        .setSelection([...drag.base, ...rowsWithinBand(covered, drag.rows)]);
      setBand({
        top: covered.top - drag.listOrigin.y,
        bottom: covered.bottom - drag.listOrigin.y,
        left: covered.left - drag.listOrigin.x,
        right: covered.right - drag.listOrigin.x,
      });
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, [pressing]);

  const handleListPointerDown = useCallback((event: ReactPointerEvent<HTMLUListElement>) => {
    // Secondary buttons belong to the context menu — on a Mac that includes
    // Ctrl+Click, which everywhere else is the additive modifier instead. The
    // row actions are their own hit targets, and never a marquee's origin.
    const onMac = isMacPlatform(navigator.platform);
    if (event.button !== 0 || (onMac && event.ctrlKey)) return;
    if ((event.target as HTMLElement).closest("[data-settled-row-action]") !== null) return;
    const list = listRef.current;
    if (list === null) return;
    const rect = list.getBoundingClientRect();
    suppressClickRef.current = false;
    dragRef.current = {
      pointerId: event.pointerId,
      originClient: { x: event.clientX, y: event.clientY },
      listOrigin: { x: rect.left, y: rect.top },
      additive: (onMac ? event.metaKey : event.ctrlKey) || event.shiftKey,
      base: [],
      rows: [],
      active: false,
    };
    setPressing(true);
  }, []);

  const handleListClickCapture = useCallback((event: ReactMouseEvent<HTMLUListElement>) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleRowClick = useCallback(
    (event: ReactMouseEvent, thread: EnvironmentThreadShell) => {
      const threadKey = sidebarThreadKey(thread);
      const action = resolveConversationClickAction({
        platform: navigator.platform,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        detail: event.detail,
      });
      if (action === "ignore") return;
      if (action === "toggle-selection") {
        event.preventDefault();
        useThreadSelectionStore.getState().toggleThread(threadKey);
        return;
      }
      if (action === "range-selection") {
        event.preventDefault();
        // Ranges run over the shelf's own rows: the sidebar's card order does
        // not contain settled conversations, so anchoring against it would
        // silently degrade every Shift+Click to a toggle.
        useThreadSelectionStore.getState().rangeSelectTo(threadKey, shelfKeysRef.current);
        return;
      }
      onSelectThread(event, thread);
    },
    [onSelectThread],
  );

  if (props.threads.length === 0) return null;

  return (
    <section aria-label="Settled conversations" className="pt-2" data-sidebar-settled-section>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="sidebar-settled-list"
        onClick={() => setManuallyExpanded(!expanded)}
        className="flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md pl-1 pr-2 text-left text-sidebar-muted-foreground outline-none transition-colors duration-(--duration-fast) ease-(--ease-fluid) hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 transition-transform duration-(--duration-fast) ease-(--ease-fluid) motion-reduce:transition-none",
            expanded && "rotate-90",
          )}
        />
        <span className="text-[13px] font-medium leading-5">Settled</span>
        <span className="text-[11px] tabular-nums text-sidebar-muted-foreground/70">
          {props.threads.length}
        </span>
      </button>
      {expanded && selectedThreads.length > 0 ? (
        <div
          aria-label="Settled selection actions"
          className="mt-0.5 flex h-8 items-center gap-1 rounded-md bg-sidebar-row-active pl-2 pr-1"
          data-sidebar-settled-selection-bar
        >
          <span className="min-w-0 flex-1 truncate text-[12px] leading-4 text-sidebar-foreground">
            {selectedThreads.length} selected
          </span>
          <button
            type="button"
            onClick={() => props.onDeleteThreads(selectedThreads)}
            className={cn(
              "inline-flex h-6 cursor-pointer items-center gap-1 rounded-md px-2 text-[12px] leading-4 text-destructive outline-none transition-colors duration-(--duration-fast) ease-(--ease-fluid) hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            )}
          >
            <Trash2Icon aria-hidden className="size-3.5" />
            Delete
          </button>
          <button
            type="button"
            aria-label="Clear selection"
            title="Clear selection"
            onClick={() => useThreadSelectionStore.getState().clearSelection()}
            className={ACTION_BUTTON}
          >
            <XIcon aria-hidden className="size-3.5" />
          </button>
        </div>
      ) : null}
      {expanded ? (
        <ul
          id="sidebar-settled-list"
          ref={listRef}
          onPointerDown={handleListPointerDown}
          onClickCapture={handleListClickCapture}
          className={cn("relative flex flex-col pt-0.5", band !== null && "select-none")}
        >
          {recent.map((thread) => {
            const threadKey = sidebarThreadKey(thread);
            const projectKey = sidebarProjectKey(thread.environmentId, thread.projectId);
            const workspaceRoot = props.projectCwdByKey.get(projectKey);
            const projectName = props.projectDisplayNameByKey.get(projectKey);
            const isSelected = props.selectedThreadKey === threadKey;
            const isMultiSelected = selectedThreadKeys.has(threadKey);
            return (
              <li
                key={threadKey}
                data-settled-row={threadKey}
                className="group/settled-row relative list-none"
              >
                <button
                  type="button"
                  onClick={(event) => handleRowClick(event, thread)}
                  onContextMenu={(event) => props.onThreadContextMenu(event, thread)}
                  data-sidebar-thread-key={threadKey}
                  data-multi-selected={isMultiSelected ? "" : undefined}
                  aria-current={isSelected ? "page" : undefined}
                  title={
                    projectName === undefined ? thread.title : `${projectName} · ${thread.title}`
                  }
                  // The right pad is the action pair's seat, held open at rest
                  // so nothing shifts or gets covered when they appear.
                  className={cn(
                    "flex h-8 w-full cursor-pointer items-center gap-1.5 rounded-md py-1 pl-1 pr-14 text-left outline-none transition-colors duration-(--duration-fast) ease-(--ease-fluid)",
                    isSelected || isMultiSelected
                      ? "bg-sidebar-row-active text-sidebar-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  )}
                >
                  {/* A project with no known checkout still holds the glyph
                      rail open, so its title stays on the same left edge as
                      every other row's. */}
                  {workspaceRoot === undefined ? (
                    <span aria-hidden className="size-3.5 shrink-0" />
                  ) : (
                    <ProjectFavicon
                      environmentId={thread.environmentId}
                      cwd={workspaceRoot}
                      className="size-3.5 shrink-0 rounded-sm"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[13px] leading-5">
                    {thread.title}
                  </span>
                </button>
                <span className="absolute right-1 top-1 flex items-center gap-0.5 transition-opacity duration-(--duration-fast) ease-(--ease-fluid) pointer-fine:opacity-0 pointer-fine:group-hover/settled-row:opacity-100 group-focus-within/settled-row:opacity-100">
                  <button
                    type="button"
                    data-settled-row-action
                    aria-label={`Delete conversation ${thread.title}`}
                    title="Delete conversation"
                    onClick={() => props.onDeleteThreads([thread])}
                    className={cn(ACTION_BUTTON, "hover:bg-destructive/10 hover:text-destructive")}
                  >
                    <Trash2Icon aria-hidden className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    data-settled-row-action
                    aria-label={`Restore conversation ${thread.title}`}
                    title="Restore conversation"
                    onClick={() => props.onRestoreThread(thread)}
                    className={cn(ACTION_BUTTON, "hover:text-sidebar-foreground")}
                  >
                    <RotateCcwIcon aria-hidden className="size-3.5" />
                  </button>
                </span>
              </li>
            );
          })}
          {band === null ? null : (
            <div
              aria-hidden
              data-sidebar-settled-marquee
              className="pointer-events-none absolute rounded-[3px] border border-ring/60 bg-ring/10"
              style={{
                left: band.left,
                top: band.top,
                width: band.right - band.left,
                height: band.bottom - band.top,
              }}
            />
          )}
        </ul>
      ) : null}
    </section>
  );
}
