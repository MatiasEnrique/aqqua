import type { ScopedThreadRef } from "@aqqua/contracts";
import { ArchiveIcon, PlusIcon, SquarePenIcon } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ScrollArea } from "~/components/ui/scroll-area";
import { cn } from "~/lib/utils";
import { StatusIndicator } from "../StatusIndicator";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  type ConversationTab,
  type ConversationTabFamilyDisplay,
  resolveConversationTabFamilyDisplays,
} from "./openConversationTabs";

/**
 * The open conversations, as a tab strip under the toolbar.
 *
 * Tabs are global rather than per-worktree: the strip is the set of
 * conversations you are currently juggling, and picking one takes you to it
 * wherever it lives — the sidebar follows by highlighting its worktree.
 *
 * Delegation is the one thing the strip is not flat about: an orchestrator and
 * the sub-agents it spawned share a banded tray, so a thread that exists only
 * because another thread asked for it never reads as a peer of the work the
 * user opened themselves.
 *
 * Deliberately borderless. The toolbar above and the transcript below already
 * separate themselves by content; a rule on either edge of a row of bordered
 * shells reads as a stack of boxes inside a box.
 */
export const ConversationTabs = memo(function ConversationTabs(props: {
  readonly tabs: readonly ConversationTab[];
  readonly onSelectThread: (threadRef: ScopedThreadRef) => void;
  readonly onSelectDraft: (draftId: string) => void;
  readonly onArchiveThread: (threadRef: ScopedThreadRef) => void;
  readonly confirmArchive: boolean;
  readonly onNewThread: () => void;
  readonly newThreadLabel: string;
  /** Orchestrator tab keys whose sub-agents are folded into a count chip. */
  readonly collapsedFamilyKeys: readonly string[];
  readonly onToggleFamilyCollapsed: (familyKey: string) => void;
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const activeKey = props.tabs.find((tab) => tab.isActive)?.key ?? null;
  const { collapsedFamilyKeys } = props;
  const families = useMemo(
    () =>
      resolveConversationTabFamilyDisplays({
        tabs: props.tabs,
        collapsedKeys: new Set(collapsedFamilyKeys),
      }),
    [collapsedFamilyKeys, props.tabs],
  );
  const activeTabIsFolded = families.some((family) => family.holdsRoutedSubAgent);

  // Keep the routed conversation visible when the strip overflows — arriving
  // from a deep link or a notification must not land on a tab off-screen.
  useEffect(() => {
    const activeTab = stripRef.current?.querySelector<HTMLElement>("[data-active-tab='true']");
    activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeKey, activeTabIsFolded]);

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
          {families.map((family) => (
            <ConversationTabFamilyItem
              key={family.key}
              family={family}
              onSelectThread={props.onSelectThread}
              onSelectDraft={props.onSelectDraft}
              onArchiveThread={props.onArchiveThread}
              confirmArchive={props.confirmArchive}
              onToggleCollapsed={() => props.onToggleFamilyCollapsed(family.key)}
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
 * One family in the strip: a lone tab, or an orchestrator banded with its
 * sub-agents.
 *
 * The band is a tray rather than extra height — the strip has 32px to spend and
 * no more — so a banded family lines up with its neighbours on both edges and
 * pays for the nesting in horizontal room, which is the room the strip has.
 */
function ConversationTabFamilyItem(props: {
  readonly family: ConversationTabFamilyDisplay;
  readonly onSelectThread: (threadRef: ScopedThreadRef) => void;
  readonly onSelectDraft: (draftId: string) => void;
  readonly onArchiveThread: (threadRef: ScopedThreadRef) => void;
  readonly confirmArchive: boolean;
  readonly onToggleCollapsed: () => void;
}) {
  const { family } = props;
  const selectTab = (tab: ConversationTab) => () =>
    tab._tag === "thread" ? props.onSelectThread(tab.threadRef) : props.onSelectDraft(tab.draftId);

  const parentShell = (
    <ConversationTabShell
      tab={family.parent}
      banded={family.children.length > 0}
      onSelect={selectTab(family.parent)}
      onArchive={
        family.parent._tag === "thread"
          ? () => props.onArchiveThread(family.parent.threadRef)
          : undefined
      }
      confirmArchive={props.confirmArchive}
      subAgents={
        family.subAgentCount === 0
          ? undefined
          : {
              count: family.subAgentCount,
              isCollapsed: family.isCollapsed,
              holdsRoutedSubAgent: family.holdsRoutedSubAgent,
              onToggle: props.onToggleCollapsed,
            }
      }
    />
  );

  // A fully folded family is C1, not C2: the chip carries the whole tree, so
  // there is nothing for a tray to hold and the tab rejoins the flat strip.
  if (family.children.length === 0) return <li className="shrink-0">{parentShell}</li>;

  return (
    <li className="shrink-0">
      <div
        data-conversation-tab-family={family.key}
        className="flex h-8 items-center gap-px rounded-xl border border-border bg-muted p-px [-webkit-app-region:no-drag]"
      >
        {parentShell}
        {family.children.map((child) => (
          <SubAgentTabChip key={child.key} tab={child} onSelect={selectTab(child)} />
        ))}
      </div>
    </li>
  );
}

/**
 * The orchestrator's count chip, which is also the tray's disclosure.
 *
 * The count is the honest label in both states — four sub-agents are four
 * whether or not they are drawn — so the chip does not change its number when
 * folded, only its pressed state. A dedicated chevron would spend the same
 * width to say less.
 *
 * When the fold swallowed the routed conversation the chip takes over as its
 * strip entry: it carries `data-active-tab`, so overflow still scrolls to the
 * thread on screen, and it reads as selected rather than as a quiet count.
 */
function SubAgentCountChip(props: {
  readonly count: number;
  readonly isCollapsed: boolean;
  readonly holdsRoutedSubAgent: boolean;
  readonly onToggle: () => void;
  readonly familyTitle: string;
}) {
  const label = props.count === 1 ? "1 sub-agent" : `${props.count} sub-agents`;
  const action = props.isCollapsed ? "Show" : "Hide";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-expanded={!props.isCollapsed}
            aria-label={
              props.holdsRoutedSubAgent
                ? `${action} ${label} of ${props.familyTitle}, holding the open conversation`
                : `${action} ${label} of ${props.familyTitle}`
            }
            data-sub-agent-count
            data-active-tab={props.holdsRoutedSubAgent ? true : undefined}
            onClick={props.onToggle}
            className={cn(
              "inline-flex h-[17px] shrink-0 cursor-pointer items-center gap-[3px] rounded-full px-1.5 text-[10.5px] font-semibold tabular-nums outline-none transition-colors duration-(--duration-fast) ease-(--ease-fluid) focus-visible:ring-2 focus-visible:ring-ring",
              props.holdsRoutedSubAgent
                ? "bg-foreground text-background"
                : props.isCollapsed
                  ? "bg-accent text-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          />
        }
      >
        <SubAgentCountIcon />
        {props.count}
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {props.holdsRoutedSubAgent
          ? `${action} ${label} · the open conversation is one of them`
          : `${action} ${label}`}
      </TooltipPopup>
    </Tooltip>
  );
}

/** The design's scatter of three dots — a fan-out, not a menu's ellipsis. */
function SubAgentCountIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="size-[9px] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
    >
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
    </svg>
  );
}

function ConversationTabIdentity(props: {
  readonly tab: ConversationTab;
  readonly variant: "primary" | "subAgent";
}) {
  const compact = props.variant === "subAgent";
  return (
    <>
      {compact ? <SubAgentElbowIcon /> : null}
      {props.tab._tag === "draft" ? (
        <SquarePenIcon
          aria-hidden
          className={
            compact
              ? "size-2.5 shrink-0 text-muted-foreground/70"
              : "size-3 shrink-0 text-muted-foreground/70"
          }
        />
      ) : (
        <StatusIndicator state={props.tab.state} size={compact ? "size-[5px]" : "size-1.5"} />
      )}
      <span className={cn("truncate", compact ? "max-w-32" : "max-w-44")}>{props.tab.title}</span>
    </>
  );
}

/**
 * A sub-agent's tab: an elbow, a state dot, and a name, on the family's tray.
 *
 * Deliberately lighter than a tab shell — no surface of its own until it is the
 * routed conversation, and no archive control. A sub-agent is archived from the
 * run that spawned it, not from a chip the orchestrator is holding open.
 */
function SubAgentTabChip(props: { readonly tab: ConversationTab; readonly onSelect: () => void }) {
  const { tab } = props;
  return (
    <div
      data-active-tab={tab.isActive}
      data-testid={`conversation-tab-${tab.key}`}
      data-sub-agent-tab
      className={cn(
        "group flex h-[30px] items-center gap-1.5 rounded-[10px] border pr-1 pl-1.5 transition-colors duration-(--duration-fast) ease-(--ease-fluid)",
        tab.isActive ? "border-input bg-card" : "border-transparent hover:border-border",
      )}
    >
      <button
        type="button"
        onClick={props.onSelect}
        aria-current={tab.isActive ? "page" : undefined}
        className={cn(
          "flex h-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          tab.isActive ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        <ConversationTabIdentity tab={tab} variant="subAgent" />
      </button>
    </div>
  );
}

/**
 * The tree elbow borrowed from the sidebar's family panel, turned sideways.
 *
 * Lucide's corner glyph carries an arrowhead, which reads as "go to" rather
 * than "descends from"; the line alone is the whole idea.
 */
function SubAgentElbowIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="size-2.5 shrink-0 text-muted-foreground/50"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
    >
      <path d="M6 4v9a4 4 0 0 0 4 4h8" />
    </svg>
  );
}

/**
 * One tab: a white shell that carries its own border.
 *
 * The archive control is a sibling button rather than a nested one — a button
 * inside a button is invalid and unreachable by keyboard — so persisted-thread
 * tabs are flex rows of two controls sharing one surface.
 */
function ConversationTabShell(props: {
  readonly tab: ConversationTab;
  readonly onSelect: () => void;
  readonly onArchive?: (() => void) | undefined;
  readonly confirmArchive: boolean;
  /** Inset by the family tray's 1px padding, so the outer edges still align. */
  readonly banded?: boolean;
  /** Present only for an orchestrator: the count chip that folds the tray. */
  readonly subAgents?:
    | {
        readonly count: number;
        readonly isCollapsed: boolean;
        readonly holdsRoutedSubAgent: boolean;
        readonly onToggle: () => void;
      }
    | undefined;
}) {
  const { tab } = props;
  const [isConfirmingArchive, setIsConfirmingArchive] = useState(false);
  const confirmArchiveRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (isConfirmingArchive) confirmArchiveRef.current?.focus();
  }, [isConfirmingArchive]);

  return (
    <div
      data-active-tab={tab.isActive}
      data-testid={`conversation-tab-${tab.key}`}
      className={cn(
        "flex shrink-0 items-center gap-1 border bg-card pr-1.5 pl-2.5 transition-colors duration-(--duration-fast) ease-(--ease-fluid) [-webkit-app-region:no-drag]",
        props.banded === true ? "h-[30px] rounded-[10px]" : "h-8 rounded-xl",
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
        <ConversationTabIdentity tab={tab} variant="primary" />
      </button>
      {props.subAgents === undefined ? null : (
        <SubAgentCountChip
          count={props.subAgents.count}
          isCollapsed={props.subAgents.isCollapsed}
          holdsRoutedSubAgent={props.subAgents.holdsRoutedSubAgent}
          onToggle={props.subAgents.onToggle}
          familyTitle={tab.title}
        />
      )}
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
    </div>
  );
}
