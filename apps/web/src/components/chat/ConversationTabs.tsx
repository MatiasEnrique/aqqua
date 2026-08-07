import type { ScopedThreadRef } from "@aqqua/contracts";
import { ArchiveIcon, PlusIcon, SquarePenIcon, XIcon } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ScrollArea } from "~/components/ui/scroll-area";
import { cn } from "~/lib/utils";
import { StatusIndicator } from "../StatusIndicator";
import { TabFamilyCountTrigger, TabFamilyPopover } from "../TabFamilyPopover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  type ConversationTab,
  type ConversationTabFamily,
  groupConversationTabFamilies,
} from "./openConversationTabs";

/**
 * The open conversations, as a tab strip under the toolbar.
 *
 * Tabs are global rather than per-worktree: the strip is the set of
 * conversations you are currently juggling, and picking one takes you to it
 * wherever it lives — the sidebar follows by highlighting its worktree.
 *
 * Delegation is the one thing the strip is not flat about: an orchestrator
 * carries a compact picker for the sub-agents it spawned, so descendants stay
 * reachable without consuming the strip's horizontal room.
 *
 * Deliberately borderless. The toolbar above and the transcript below already
 * separate themselves by content; a rule on either edge of a row of bordered
 * shells reads as a stack of boxes inside a box.
 */
export const ConversationTabs = memo(function ConversationTabs(props: {
  readonly tabs: readonly ConversationTab[];
  readonly onSelectThread: (threadRef: ScopedThreadRef) => void;
  readonly onSelectDraft: (draftId: string) => void;
  readonly onDiscardDraft: (draftId: string) => void;
  readonly onArchiveThread: (threadRef: ScopedThreadRef) => void;
  readonly confirmArchive: boolean;
  readonly onNewThread: () => void;
  readonly newThreadLabel: string;
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const activeKey = props.tabs.find((tab) => tab.isActive)?.key ?? null;
  const families = useMemo(() => groupConversationTabFamilies(props.tabs), [props.tabs]);
  const activeSubAgentInPopover = families.some((family) =>
    family.children.some((child) => child.isActive),
  );

  // Keep the routed conversation visible when the strip overflows — arriving
  // from a deep link or a notification must not land on a tab off-screen.
  useEffect(() => {
    const activeTab = stripRef.current?.querySelector<HTMLElement>("[data-active-tab='true']");
    activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeKey, activeSubAgentInPopover]);

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
              onDiscardDraft={props.onDiscardDraft}
              onArchiveThread={props.onArchiveThread}
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
 * One family in the strip: a lone tab, or an orchestrator with a descendant
 * picker. The family always occupies exactly one tab shell.
 */
function ConversationTabFamilyItem(props: {
  readonly family: ConversationTabFamily;
  readonly onSelectThread: (threadRef: ScopedThreadRef) => void;
  readonly onSelectDraft: (draftId: string) => void;
  readonly onDiscardDraft: (draftId: string) => void;
  readonly onArchiveThread: (threadRef: ScopedThreadRef) => void;
  readonly confirmArchive: boolean;
}) {
  const { family } = props;
  // Narrow through a local: a discriminant check on `family.parent` does not
  // survive into the closures below, and both variants carry `threadRef`, so
  // the unnarrowed archive case would compile while the draft case would not.
  const parent = family.parent;
  const selectTab = (tab: ConversationTab) => () =>
    tab._tag === "thread" ? props.onSelectThread(tab.threadRef) : props.onSelectDraft(tab.draftId);

  const parentShell = (
    <ConversationTabShell
      tab={parent}
      onSelect={selectTab(parent)}
      onArchive={
        parent._tag === "thread" ? () => props.onArchiveThread(parent.threadRef) : undefined
      }
      onClose={parent._tag === "draft" ? () => props.onDiscardDraft(parent.draftId) : undefined}
      confirmArchive={props.confirmArchive}
      subAgents={
        family.children.length === 0
          ? undefined
          : {
              familyTitle: parent.title,
              tabs: family.children,
              onSelectTab: (tab) => selectTab(tab)(),
            }
      }
    />
  );

  return <li className="shrink-0">{parentShell}</li>;
}

/**
 * The orchestrator's count chip opens its bounded descendant picker. When the
 * routed conversation is a descendant, the chip carries `data-active-tab` so
 * overflow still scrolls to the family the transcript belongs to.
 */
function SubAgentCountChip(props: {
  readonly familyTitle: string;
  readonly tabs: readonly ConversationTab[];
  readonly onSelectTab: (tab: ConversationTab) => void;
}) {
  const count = props.tabs.length;
  const label = count === 1 ? "1 sub-agent" : `${count} sub-agents`;
  const activeTab = props.tabs.find((tab) => tab.isActive);
  const triggerLabel =
    activeTab === undefined
      ? `Open ${label} of ${props.familyTitle}`
      : `Open ${label} of ${props.familyTitle}, holding the open conversation ${activeTab.title}`;

  return (
    <TabFamilyPopover
      title={`${props.familyTitle} sub-agents`}
      trigger={
        <TabFamilyCountTrigger
          label={triggerLabel}
          count={count}
          active={activeTab !== undefined}
          markerAttributes={{
            "data-sub-agent-count": true,
            "data-active-tab": activeTab === undefined ? undefined : true,
          }}
        />
      }
      items={props.tabs.map((tab) => ({
        key: tab.key,
        label: tab.title,
        leading:
          tab._tag === "thread" ? (
            <StatusIndicator state={tab.state} size="size-1.5" />
          ) : (
            <SquarePenIcon aria-hidden className="size-3 shrink-0 text-muted-foreground/70" />
          ),
        active: tab.isActive,
        onSelect: () => props.onSelectTab(tab),
      }))}
    />
  );
}

function ConversationTabIdentity(props: { readonly tab: ConversationTab }) {
  return (
    <>
      {props.tab._tag === "draft" ? (
        <SquarePenIcon aria-hidden className="size-3 shrink-0 text-muted-foreground/70" />
      ) : (
        <StatusIndicator state={props.tab.state} size="size-1.5" />
      )}
      <span className="max-w-44 truncate">{props.tab.title}</span>
    </>
  );
}

/**
 * One tab: a white shell that carries its own border.
 *
 * The archive control is a sibling button rather than a nested one — a button
 * inside a button is invalid and unreachable by keyboard — so tabs with an
 * archive or close action are flex rows of two controls sharing one surface.
 */
function ConversationTabShell(props: {
  readonly tab: ConversationTab;
  readonly onSelect: () => void;
  readonly onArchive?: (() => void) | undefined;
  readonly onClose?: (() => void) | undefined;
  readonly confirmArchive: boolean;
  /** Present only for an orchestrator: the count chip that opens its picker. */
  readonly subAgents?:
    | {
        readonly familyTitle: string;
        readonly tabs: readonly ConversationTab[];
        readonly onSelectTab: (tab: ConversationTab) => void;
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
        "h-8 rounded-xl",
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
        <ConversationTabIdentity tab={tab} />
      </button>
      {props.subAgents === undefined ? null : (
        <SubAgentCountChip
          familyTitle={props.subAgents.familyTitle}
          tabs={props.subAgents.tabs}
          onSelectTab={props.subAgents.onSelectTab}
        />
      )}
      {props.onClose === undefined ? null : (
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
          <TooltipPopup side="bottom">Close conversation</TooltipPopup>
        </Tooltip>
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
