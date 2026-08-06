import type { ScopedThreadRef } from "@aqqua/contracts";
import { ArchiveIcon, PlusIcon, SquarePenIcon, XIcon } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { ScrollArea } from "~/components/ui/scroll-area";
import { cn } from "~/lib/utils";
import {
  conversationStateDotClassName,
  SIDEBAR_STATE_PRESENTATIONS,
} from "../sidebar-v2/SidebarStatusPresentations";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ConversationTab } from "./openConversationTabs";

/**
 * The open conversations, as a tab strip under the toolbar.
 *
 * Tabs are global rather than per-worktree: the strip is the set of
 * conversations you are currently juggling, and picking one takes you to it
 * wherever it lives — the sidebar follows by highlighting its worktree. Closing
 * a tab is a pure view operation; the conversation itself is untouched.
 *
 * Deliberately borderless. The toolbar above and the transcript below already
 * separate themselves by content; a rule on either edge of a row of bordered
 * shells reads as a stack of boxes inside a box.
 */
export const ConversationTabs = memo(function ConversationTabs(props: {
  readonly tabs: readonly ConversationTab[];
  readonly onSelectThread: (threadRef: ScopedThreadRef) => void;
  readonly onSelectDraft: (draftId: string) => void;
  readonly onCloseTab: (tabKey: string) => void;
  readonly onArchiveThread: (threadRef: ScopedThreadRef) => void;
  readonly confirmArchive: boolean;
  readonly onNewThread: () => void;
  readonly newThreadLabel: string;
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const activeKey = props.tabs.find((tab) => tab.isActive)?.key ?? null;

  // Keep the routed conversation visible when the strip overflows — arriving
  // from a deep link or a notification must not land on a tab off-screen.
  useEffect(() => {
    const activeTab = stripRef.current?.querySelector<HTMLElement>("[data-active-tab='true']");
    activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeKey]);

  return (
    <nav
      aria-label="Open conversations"
      data-conversation-tabbar
      className="flex h-[var(--workspace-tabbar-height)] shrink-0 items-center px-2 pt-[5px] pb-1"
    >
      <ScrollArea
        ref={stripRef}
        hideScrollbars
        scrollFade
        className="min-w-0 flex-1 rounded-none"
        data-conversation-tab-list
      >
        <ul className="flex h-full w-max min-w-full items-center gap-1">
          {props.tabs.map((tab) => (
            <ConversationTabShell
              key={tab.key}
              tab={tab}
              onSelect={() =>
                tab._tag === "thread"
                  ? props.onSelectThread(tab.threadRef)
                  : props.onSelectDraft(tab.draftId)
              }
              onClose={() => props.onCloseTab(tab.key)}
              onArchive={
                tab._tag === "thread" ? () => props.onArchiveThread(tab.threadRef) : undefined
              }
              confirmArchive={props.confirmArchive}
            />
          ))}
          <li className="shrink-0">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={props.newThreadLabel}
                    onClick={props.onNewThread}
                    className="inline-flex size-8 cursor-pointer items-center justify-center rounded-xl text-muted-foreground outline-none transition-colors duration-(--duration-fast) ease-(--ease-fluid) hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [-webkit-app-region:no-drag]"
                  />
                }
              >
                <PlusIcon aria-hidden className="size-4" />
              </TooltipTrigger>
              <TooltipPopup side="bottom">{props.newThreadLabel}</TooltipPopup>
            </Tooltip>
          </li>
        </ul>
      </ScrollArea>
    </nav>
  );
});

/**
 * One tab: a white shell that carries its own border.
 *
 * The close control is a sibling button rather than a nested one — a button
 * inside a button is invalid and unreachable by keyboard — so the shell is a
 * flex row of two controls sharing one surface.
 */
function ConversationTabShell(props: {
  readonly tab: ConversationTab;
  readonly onSelect: () => void;
  readonly onClose: () => void;
  readonly onArchive?: (() => void) | undefined;
  readonly confirmArchive: boolean;
}) {
  const { tab } = props;
  const [isConfirmingArchive, setIsConfirmingArchive] = useState(false);
  const confirmArchiveRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (isConfirmingArchive) confirmArchiveRef.current?.focus();
  }, [isConfirmingArchive]);

  return (
    <li className="shrink-0">
      <div
        data-active-tab={tab.isActive}
        data-testid={`conversation-tab-${tab.key}`}
        className={cn(
          "flex h-8 items-center gap-1 rounded-xl border bg-card pr-1.5 pl-2.5 transition-colors duration-(--duration-fast) ease-(--ease-fluid) [-webkit-app-region:no-drag]",
          tab.isActive ? "border-input" : "border-border hover:border-input",
        )}
      >
        <button
          type="button"
          onClick={props.onSelect}
          aria-current={tab.isActive ? "page" : undefined}
          className={cn(
            "flex h-full min-w-0 cursor-pointer items-center gap-[7px] rounded-md text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            tab.isActive ? "font-semibold text-foreground" : "text-muted-foreground",
          )}
        >
          {tab._tag === "draft" ? (
            <SquarePenIcon aria-hidden className="size-3 shrink-0 text-muted-foreground/70" />
          ) : (
            <span
              aria-hidden
              className={cn(
                conversationStateDotClassName({ state: tab.state, size: "size-1.5" }),
                SIDEBAR_STATE_PRESENTATIONS[tab.state].className,
              )}
            />
          )}
          <span className="max-w-44 truncate">{tab.title}</span>
        </button>
        {props.onArchive === undefined ? null : isConfirmingArchive ? (
          <button
            ref={confirmArchiveRef}
            type="button"
            aria-label={`Confirm archive ${tab.title}`}
            onBlur={() => setIsConfirmingArchive(false)}
            onClick={() => {
              setIsConfirmingArchive(false);
              props.onArchive?.();
            }}
            className="inline-flex h-5 shrink-0 cursor-pointer items-center rounded-sm bg-destructive/12 px-1.5 text-[10px] font-medium text-destructive outline-none transition-colors hover:bg-destructive/18 focus-visible:ring-2 focus-visible:ring-destructive/40"
          >
            Confirm
          </button>
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={`Archive ${tab.title}`}
                  onClick={() => {
                    if (props.confirmArchive) {
                      setIsConfirmingArchive(true);
                    } else {
                      props.onArchive?.();
                    }
                  }}
                  className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground/60 outline-none transition-colors duration-(--duration-fast) ease-(--ease-fluid) hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                />
              }
            >
              <ArchiveIcon aria-hidden className="size-3" />
            </TooltipTrigger>
            <TooltipPopup side="bottom">Archive conversation</TooltipPopup>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={`Close ${tab.title}`}
                onClick={props.onClose}
                className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground/60 outline-none transition-colors duration-(--duration-fast) ease-(--ease-fluid) hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
            }
          >
            <XIcon aria-hidden className="size-3" />
          </TooltipTrigger>
          <TooltipPopup side="bottom">Close tab · the conversation stays</TooltipPopup>
        </Tooltip>
      </div>
    </li>
  );
}
