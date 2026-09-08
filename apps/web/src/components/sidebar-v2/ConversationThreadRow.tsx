import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/models";
import { ArchiveIcon, GitForkIcon, RotateCcwIcon } from "lucide-react";
import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { cn } from "~/lib/utils";
import { useThreadSelectionStore } from "../../threadSelectionStore";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import {
  type ConversationStateKey,
  conversationStatePresentation,
} from "../conversationStatePresentation";
import { ConversationStateIcon } from "../ConversationStateIcon";
import { StatusIndicator } from "../StatusIndicator";
import { Popover, PopoverTrigger, PopoverPopup, PopoverTitle } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  classifyThreadPresentation,
  resolveSidebarConversationSummaryState,
} from "./threadPresentationState";
import type { SidebarThreadSection } from "./WorktreeCard";
import { sidebarThreadKey } from "./sidebarThreadFamilies";

export function ConversationThreadRow(props: {
  readonly thread: EnvironmentThreadShell;
  readonly descendants?: readonly EnvironmentThreadShell[] | undefined;
  readonly selectedThreadKey?: string | null | undefined;
  readonly onSelectDescendant?:
    | ((event: ReactMouseEvent, thread: EnvironmentThreadShell) => void)
    | undefined;
  readonly onDescendantContextMenu?:
    | ((event: ReactMouseEvent, thread: EnvironmentThreadShell) => void)
    | undefined;
  readonly descendantSectionByKey?: ReadonlyMap<string, SidebarThreadSection> | undefined;
  readonly isMobile?: boolean | undefined;
  readonly section: SidebarThreadSection;
  readonly isSelected: boolean;
  readonly onClick: (event: ReactMouseEvent) => void;
  readonly onContextMenu: (event: ReactMouseEvent) => void;
  readonly onToggleSettled?: (() => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const threadKey = sidebarThreadKey(props.thread);
  const isMultiSelected = useThreadSelectionStore((store) =>
    store.selectedThreadKeys.has(threadKey),
  );
  const descendants = props.descendants ?? [];
  const childSelected = descendants.some(
    (child) => sidebarThreadKey(child) === props.selectedThreadKey,
  );
  const status = conversationStatusKey(props.thread, props.section);
  const relativeTime = formatRelativeTimeLabel(props.thread.updatedAt);
  const settlementAction =
    props.onToggleSettled === undefined
      ? null
      : props.section === "settled"
        ? {
            label: `Un-settle conversation ${props.thread.title}`,
            tooltip: "Un-settle conversation",
            icon: <RotateCcwIcon aria-hidden className="size-3.5" />,
          }
        : {
            label: `Settle conversation ${props.thread.title}`,
            tooltip: "Settle conversation",
            icon: <ArchiveIcon aria-hidden className="size-3.5" />,
          };
  const metadata = [
    props.section === "snoozed" ? "Snoozed" : props.section === "settled" ? "Settled" : null,
    props.thread.branch ?? "current checkout",
    relativeTime,
  ]
    .filter(Boolean)
    .join(" · ");

  const button = (
    <button
      type="button"
      onClick={(event) => {
        if (!props.isMobile || descendants.length === 0) props.onClick(event);
      }}
      onContextMenu={props.onContextMenu}
      data-sidebar-thread-key={threadKey}
      aria-current={props.isSelected || childSelected ? "page" : undefined}
      className={cn(
        "flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-md py-0.5 pl-6 pr-10 text-left outline-none transition-colors duration-(--duration-fast) ease-(--ease-fluid)",
        props.isSelected || childSelected || isMultiSelected
          ? "bg-sidebar-row-active text-sidebar-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-row-hover",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-normal leading-5">
          {props.thread.title}
        </span>
        <span className="block truncate text-[11px] leading-4 text-sidebar-muted-foreground">
          {metadata}
          {descendants.length > 0 ? (
            <span className="ml-1.5 inline-flex items-center gap-0.5 text-sidebar-foreground/70">
              <GitForkIcon aria-hidden className="size-2.5" />
              {descendants.length}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
  return (
    <li
      data-thread-item
      className="group/thread relative list-none [content-visibility:auto] [contain-intrinsic-size:auto_40px]"
    >
      {descendants.length === 0 ? (
        button
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger openOnHover delay={200} closeDelay={200} render={button} />
          <PopoverPopup
            side="right"
            align="start"
            sideOffset={10}
            className="w-72"
            viewportClassName="max-h-80 p-1.5"
          >
            <PopoverTitle className="px-2 py-2 text-xs font-medium text-muted-foreground">
              Subthreads · {props.thread.title}
            </PopoverTitle>
            {props.isMobile ? (
              <button
                type="button"
                className="mb-1 flex min-h-9 w-full items-center rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={(event) => {
                  props.onClick(event);
                  setOpen(false);
                }}
              >
                Open parent conversation
              </button>
            ) : null}
            {descendants.map((child) => {
              const childKey = sidebarThreadKey(child);
              const childSection = props.descendantSectionByKey?.get(childKey) ?? "active";
              const childStatus = conversationStatusKey(child, childSection);
              const childLabel =
                childSection === "snoozed"
                  ? "Snoozed"
                  : conversationStatePresentation(childStatus).label;
              return (
                <button
                  key={childKey}
                  aria-label={`${child.title}: ${childLabel}`}
                  type="button"
                  aria-current={childKey === props.selectedThreadKey ? "page" : undefined}
                  className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={(event) => {
                    props.onSelectDescendant?.(event, child);
                    setOpen(false);
                  }}
                  onContextMenu={(event) => props.onDescendantContextMenu?.(event, child)}
                >
                  <StatusIndicator
                    state={childStatus}
                    label={childLabel}
                    glyph={
                      <ConversationStateIcon
                        state={childStatus}
                        snoozed={childSection === "snoozed"}
                      />
                    }
                    pulse={false}
                  />
                  <span className="min-w-0 flex-1 truncate">{child.title}</span>
                </button>
              );
            })}
          </PopoverPopup>
        </Popover>
      )}
      <StatusIndicator
        state={status}
        label={`${props.thread.title}: ${conversationStatePresentation(status).label}`}
        glyph={<ConversationStateIcon state={status} snoozed={props.section === "snoozed"} />}
        pulse={false}
        className={cn(
          "pointer-events-none absolute right-0 top-0 size-10 justify-center transition-opacity duration-(--duration-fast) ease-(--ease-fluid)",
          settlementAction &&
            "opacity-0 pointer-fine:opacity-100 pointer-fine:group-hover/thread:opacity-0 group-focus-within/thread:opacity-0",
        )}
      />
      {settlementAction ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={settlementAction.label}
                onClick={props.onToggleSettled}
                className="absolute right-0 top-0 inline-flex size-10 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground opacity-100 outline-none transition-[background-color,color,opacity,transform] duration-(--duration-fast) ease-(--ease-fluid) hover:text-sidebar-foreground active:scale-[0.96] pointer-fine:opacity-0 pointer-fine:group-hover/thread:opacity-100 group-focus-within/thread:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transform-none"
              />
            }
          >
            {settlementAction.icon}
          </TooltipTrigger>
          <TooltipPopup side="right">{settlementAction.tooltip}</TooltipPopup>
        </Tooltip>
      ) : null}
    </li>
  );
}

export function conversationStatusKey(
  thread: EnvironmentThreadShell,
  section: SidebarThreadSection,
): ConversationStateKey {
  const presentation = classifyThreadPresentation(thread);
  switch (presentation.phase) {
    case "approval":
      return "approval";
    case "input":
      return "input";
    case "working":
    case "starting":
      return "working";
    case "failed":
      return "failed";
    case "ready": {
      if (presentation.planReady) return "planReady";
      if (section === "settled") return "settled";
      return resolveSidebarConversationSummaryState(thread);
    }
  }
}
