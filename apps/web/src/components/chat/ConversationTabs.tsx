import type { ScopedThreadRef } from "@aqqua/contracts";
import { CheckIcon, ListIcon, PlusIcon, CircleIcon, XIcon } from "lucide-react";
import { memo, useMemo } from "react";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "~/components/ui/menu";
import { cn } from "~/lib/utils";
import { ConversationStateIcon } from "../ConversationStateIcon";
import { ProjectFavicon } from "../ProjectFavicon";
import { StatusIndicator } from "../StatusIndicator";
import { TabFamilyCountTrigger, TabFamilyPopover } from "../TabFamilyPopover";
import {
  WorkspaceTabShell,
  WorkspaceTabStrip,
  workspaceTabContentClassName,
} from "../WorkspaceTabStrip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  type ConversationTab,
  type ConversationTabFamily,
  groupConversationTabFamilies,
} from "./openConversationTabs";
import { registerConversationTabStrip } from "./conversationTabStripScroll";

/**
 * The open conversations, sharing the titlebar with workspace actions.
 *
 * Tabs are global rather than per-worktree: the strip is the set of
 * conversations you are currently juggling, and picking one takes you to it
 * wherever it lives — the sidebar follows by highlighting its worktree.
 *
 * Delegation is the one thing the strip is not flat about: an orchestrator
 * carries a compact picker for the sub-agents it spawned, so descendants stay
 * reachable without consuming the strip's horizontal room.
 *
 * The strip shares the titlebar with workspace actions. The transcript owns
 * the dividing edge, so the tabs do not add another enclosing border.
 */
export const ConversationTabs = memo(function ConversationTabs(props: {
  readonly tabs: readonly ConversationTab[];
  readonly onSelectThread: (threadRef: ScopedThreadRef) => void;
  readonly onSelectDraft: (draftId: string) => void;
  readonly onDiscardDraft: (draftId: string) => void;
  readonly onSettleThread: (threadRef: ScopedThreadRef) => void;
  readonly onNewThread: () => void;
  readonly newThreadLabel: string;
}) {
  // A descendant conversation has its own key here even though the strip shows
  // its family's chip, so this is the one signal the strip needs to scroll.
  const activeKey = props.tabs.find((tab) => tab.isActive)?.key ?? null;
  const families = useMemo(() => groupConversationTabFamilies(props.tabs), [props.tabs]);

  return (
    <WorkspaceTabStrip
      label="Open conversations"
      activeKey={activeKey}
      data-conversation-tabbar
      className="has-[[data-has-overflow-x]]:[&>[data-conversation-tab-overflow]]:block"
      onViewportChange={registerConversationTabStrip}
      trailing={
        <ConversationTabOverflowPicker
          tabs={props.tabs}
          onSelectThread={props.onSelectThread}
          onSelectDraft={props.onSelectDraft}
        />
      }
    >
      {families.map((family) => (
        <ConversationTabFamilyItem
          key={family.key}
          family={family}
          onSelectThread={props.onSelectThread}
          onSelectDraft={props.onSelectDraft}
          onDiscardDraft={props.onDiscardDraft}
          onSettleThread={props.onSettleThread}
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
                className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-(--duration-fast) ease-(--ease-fluid) hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [-webkit-app-region:no-drag]"
              />
            }
          >
            <PlusIcon aria-hidden className="size-4" />
          </TooltipTrigger>
          <TooltipPopup side="bottom">{props.newThreadLabel}</TooltipPopup>
        </Tooltip>
      </li>
    </WorkspaceTabStrip>
  );
});

/**
 * A stable way to reach any tab when the horizontal strip clips. The scroll
 * area exposes `data-has-overflow-x`, so CSS can keep this out of the toolbar
 * until the picker is useful, with no render work of its own.
 */
function ConversationTabOverflowPicker(props: {
  readonly tabs: readonly ConversationTab[];
  readonly onSelectThread: (threadRef: ScopedThreadRef) => void;
  readonly onSelectDraft: (draftId: string) => void;
}) {
  const selectTab = (tab: ConversationTab) =>
    tab._tag === "thread" ? props.onSelectThread(tab.threadRef) : props.onSelectDraft(tab.draftId);

  return (
    <div data-conversation-tab-overflow className="hidden shrink-0 [-webkit-app-region:no-drag]">
      <Menu>
        <MenuTrigger
          aria-label="Show all open conversations"
          title="All open conversations"
          className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-(--duration-fast) ease-(--ease-fluid) hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ListIcon aria-hidden className="size-4" />
        </MenuTrigger>
        <MenuPopup align="end" side="bottom" sideOffset={6} className="w-72">
          <MenuGroup>
            <MenuGroupLabel>Open conversations</MenuGroupLabel>
            {props.tabs.map((tab) => (
              <MenuItem
                key={tab.key}
                data-conversation-tab-overflow-item={tab.key}
                aria-current={tab.isActive ? "page" : undefined}
                className={cn(
                  "min-w-0 text-xs",
                  tab.isActive && "bg-foreground/[0.06] font-semibold text-foreground",
                )}
                onClick={() => selectTab(tab)}
              >
                <ConversationTabIdentity tab={tab} />
              </MenuItem>
            ))}
          </MenuGroup>
        </MenuPopup>
      </Menu>
    </div>
  );
}

/**
 * One family in the strip: a lone tab, or an orchestrator with a descendant
 * picker. The family always occupies exactly one tab shell.
 */
function ConversationTabFamilyItem(props: {
  readonly family: ConversationTabFamily;
  readonly onSelectThread: (threadRef: ScopedThreadRef) => void;
  readonly onSelectDraft: (draftId: string) => void;
  readonly onDiscardDraft: (draftId: string) => void;
  readonly onSettleThread: (threadRef: ScopedThreadRef) => void;
}) {
  const { family } = props;
  // Narrow through a local: a discriminant check on `family.parent` does not
  // survive into the closures below, and both variants carry `threadRef`, so
  // the unnarrowed settle case would compile while the draft case would not.
  const parent = family.parent;
  const selectTab = (tab: ConversationTab) => () =>
    tab._tag === "thread" ? props.onSelectThread(tab.threadRef) : props.onSelectDraft(tab.draftId);

  const parentShell = (
    <ConversationTabShell
      tab={parent}
      onSelect={selectTab(parent)}
      onSettle={parent._tag === "thread" ? () => props.onSettleThread(parent.threadRef) : undefined}
      onClose={parent._tag === "draft" ? () => props.onDiscardDraft(parent.draftId) : undefined}
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
            <StatusIndicator
              state={tab.state}
              glyph={<ConversationStateIcon state={tab.state} />}
              pulse={false}
            />
          ) : (
            <CircleIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground/70" />
          ),
        active: tab.isActive,
        onSelect: () => props.onSelectTab(tab),
      }))}
    />
  );
}

/**
 * A tab reads left to right as where it lives, what it is, and how it is
 * doing: project icon, then title, then the state glyph next to the
 * close/settle control that acts on it.
 */
function ConversationTabIdentity(props: { readonly tab: ConversationTab }) {
  return (
    <>
      {props.tab.project === null ? null : (
        <ProjectFavicon
          environmentId={props.tab.project.environmentId}
          cwd={props.tab.project.workspaceRoot}
          className="size-3.5 shrink-0 rounded-sm"
        />
      )}
      <span className="max-w-44 truncate">{props.tab.title}</span>
      {props.tab._tag === "draft" ? (
        <CircleIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground/70" />
      ) : (
        <StatusIndicator
          state={props.tab.state}
          glyph={<ConversationStateIcon state={props.tab.state} />}
          pulse={false}
        />
      )}
    </>
  );
}

/**
 * One tab: a white shell that carries its own border.
 *
 * The settle control is a sibling button rather than a nested one — a button
 * inside a button is invalid and unreachable by keyboard — so tabs with a
 * settle or close action are flex rows of two controls sharing one surface.
 */
function ConversationTabShell(props: {
  readonly tab: ConversationTab;
  readonly onSelect: () => void;
  readonly onSettle?: (() => void) | undefined;
  readonly onClose?: (() => void) | undefined;
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

  return (
    <WorkspaceTabShell active={tab.isActive} data-testid={`conversation-tab-${tab.key}`}>
      <button
        type="button"
        onClick={props.onSelect}
        aria-current={tab.isActive ? "page" : undefined}
        className={workspaceTabContentClassName(tab.isActive ? "active" : "inactive")}
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
      {props.onSettle === undefined ? null : (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={`Settle ${tab.title}`}
                onClick={props.onSettle}
                className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground/60 outline-none transition-colors duration-(--duration-fast) ease-(--ease-fluid) hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
            }
          >
            <CheckIcon aria-hidden className="size-3" />
          </TooltipTrigger>
          <TooltipPopup side="bottom">Settle conversation</TooltipPopup>
        </Tooltip>
      )}
    </WorkspaceTabShell>
  );
}
