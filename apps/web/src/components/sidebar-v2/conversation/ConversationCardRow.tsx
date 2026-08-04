import { memo } from "react";
import { cn } from "~/lib/utils";
import type { SidebarConversationStateCounts } from "../../Sidebar.summaryState";
import { ProjectFavicon } from "../../ProjectFavicon";
import {
  SidebarCardBranch,
  SidebarCardItem,
  SidebarCardLine,
  SidebarCardMeta,
  SidebarCardProvider,
  SidebarCardSettleButton,
  SidebarCardStatusSwapSlot,
  SidebarCardSubThreadCounts,
  SidebarCardSubThreadToggle,
  SidebarCardUpdatedAt,
} from "../../sidebar/card";
import { Tooltip, TooltipTrigger } from "../../ui/tooltip";
import { JumpHintBadge, SnoozePopoverButton } from "../rowChrome";
import { threadTimeLabel } from "../rowTimeLabels";
import { SidebarSummaryStateLabel } from "../SidebarStatusPresentations";
import {
  ConversationDescription,
  ConversationDetailsTooltip,
  ConversationPrBadge,
} from "./ConversationParts";
import { useConversationRow, type ConversationRowProps } from "./useConversationRow";

export interface ConversationCardRowProps extends ConversationRowProps {
  /**
   * State tally for this orchestrator's sub-agents, excluding the orchestrator
   * itself — the card shows its own status next to these, not folded in.
   */
  readonly subAgentStateCounts: SidebarConversationStateCounts | null;
}

/**
 * A live conversation, at full detail: what it is, where it runs, who drives
 * it, when it last moved, what its sub-agents are doing, and what it needs from
 * you. This is the sidebar's default row — everything else is a reduction of it.
 */
export const ConversationCardRow = memo(function ConversationCardRow(
  props: ConversationCardRowProps,
) {
  const row = useConversationRow(props);
  const { thread } = props;

  return (
    <SidebarCardItem size="card">
      <div className={row.surfaceClassName}>
        <Tooltip>
          <TooltipTrigger
            render={
              <div
                role="button"
                tabIndex={0}
                aria-label={thread.title}
                data-testid="sidebar-v2-row-card"
                className="absolute inset-0 z-0 rounded-md outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
                onClick={row.handleClick}
                onDoubleClick={row.handleDoubleClick}
                onKeyDown={row.handleKeyDown}
                onContextMenu={row.handleContextMenu}
              />
            }
          />
          <ConversationDetailsTooltip row={row} conversation={props} />
        </Tooltip>
        <div className="pointer-events-none relative z-10">
          {/* Two lines, because one couldn't hold them: the description was
              losing every pixel to the metadata beside it. The title now owns
              its own line, and everything that describes where the work lives
              and what it delegated to sits under it. */}
          <div className="relative z-10 flex h-[3.25rem] min-w-0 flex-col justify-center gap-1 px-2.5 py-1.5">
            <SidebarCardLine className="h-5 gap-2">
              {props.showProjectIdentity ? (
                <ProjectFavicon
                  environmentId={thread.environmentId}
                  cwd={props.projectCwd ?? ""}
                  className="size-4 shrink-0"
                />
              ) : null}
              <span
                className={cn("flex min-w-0 flex-1", props.isRenaming && "pointer-events-auto")}
              >
                <ConversationDescription
                  row={row}
                  conversation={props}
                  tone={
                    row.isUnread || row.isWoke
                      ? "loud"
                      : row.shouldRecede
                        ? "muted"
                        : row.status === "failed"
                          ? "strong"
                          : "normal"
                  }
                />
              </span>
              <span className="pointer-events-auto contents">
                <ConversationPrBadge row={row} />
              </span>
              <span className="pointer-events-auto contents">
                <SidebarCardStatusSwapSlot
                  pinned={row.snoozeMenuOpen}
                  // The label carries no size of its own; on this line there is no
                  // meta cluster to inherit one from, so it says so itself. It
                  // sits a step below the row's own metadata: the description is
                  // what you read first, and colour already carries the state.
                  resting={
                    <SidebarSummaryStateLabel state={row.summaryState} className="text-[8px]" />
                  }
                  actions={
                    row.showSnoozeButton ? (
                      <SnoozePopoverButton
                        open={row.snoozeMenuOpen}
                        onOpenChange={row.setSnoozeMenuOpen}
                        onSnooze={row.handleSnoozePreset}
                      />
                    ) : null
                  }
                  className="h-5"
                />
              </span>
              {props.settlementSupported ? (
                <span className="pointer-events-auto contents">
                  <SidebarCardSettleButton
                    description={thread.title}
                    disabled={!row.canQuickSettle}
                    onSettle={row.handleSettleClick}
                    shape="square"
                    className="-my-1"
                  />
                </span>
              ) : null}
            </SidebarCardLine>
            {/* Indented under the description when a favicon claims the left
                column, so the second line reads as detail about the row above
                rather than as a row of its own. */}
            <SidebarCardLine
              className={cn(
                "h-4 gap-2.5 text-[11px] leading-none",
                props.showProjectIdentity && "pl-6",
              )}
            >
              {/* The disclosure sits next to the tally it explains. */}
              <span className="pointer-events-auto contents">
                <SidebarCardSubThreadToggle
                  count={props.childCount}
                  isExpanded={props.isExpanded}
                  description={thread.title}
                  onToggle={row.handleToggleExpanded}
                  testId={`sidebar-v2-subagent-toggle-${thread.id}`}
                />
              </span>
              <SidebarCardSubThreadCounts counts={props.subAgentStateCounts} />
              <SidebarCardBranch
                branch={row.branch}
                mismatched={row.branchMismatch !== null}
                className="shrink"
              />
              <SidebarCardMeta className="h-4">
                <SidebarCardProvider
                  driverKind={row.provider.driverKind}
                  displayName={row.provider.displayName}
                  modelLabel={row.provider.modelLabel}
                />
                <SidebarCardUpdatedAt label={threadTimeLabel(thread)} />
              </SidebarCardMeta>
            </SidebarCardLine>
          </div>
          {props.jumpLabel ? <JumpHintBadge label={props.jumpLabel} /> : null}
        </div>
      </div>
    </SidebarCardItem>
  );
});
