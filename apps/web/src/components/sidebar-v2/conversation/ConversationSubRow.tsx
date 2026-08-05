import { memo } from "react";
import { cn } from "~/lib/utils";
import { SUB_AGENT_INDENT_PX } from "../constants";
import {
  SidebarCardHoverActionSlot,
  SidebarCardItem,
  SidebarCardProvider,
  SidebarCardSettleButton,
  SidebarCardSubThreadChevron,
  SidebarCardSubThreadGuides,
  SidebarCardSubThreadGutter,
} from "../../sidebar/card";
import { Tooltip, TooltipTrigger } from "../../ui/tooltip";
import { JumpHintBadge } from "../rowChrome";
import { ConversationDescription, ConversationDetailsTooltip } from "./ConversationParts";
import { useConversationRow, type ConversationRowProps } from "./useConversationRow";

export interface ConversationSubRowProps extends ConversationRowProps {
  /**
   * Whether nested rows reserve the expand-toggle column. Set for every
   * sub-agent row once any of them owns a toggle, so sibling descriptions keep
   * one left edge.
   */
  readonly reserveExpandGutter: boolean;
}

/**
 * A sub-agent, under the orchestrator that spawned it: its description and who
 * is driving it, and nothing else. Its status is already tallied on the card
 * above, and that card owns the branch, project and timing the whole family
 * shares — repeating them here would be noise, not detail.
 */
export const ConversationSubRow = memo(function ConversationSubRow(props: ConversationSubRowProps) {
  const row = useConversationRow(props);
  const { thread } = props;

  return (
    <SidebarCardItem size="none" className="relative">
      <SidebarCardSubThreadGuides depth={props.depth} />
      <div
        className={cn(row.surfaceClassName, "flex h-8 min-w-0 items-center gap-2 pe-2.5")}
        style={{ paddingInlineStart: 10 + props.depth * SUB_AGENT_INDENT_PX }}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <div
                role="button"
                tabIndex={0}
                aria-label={thread.title}
                data-testid="sidebar-v2-row-sub"
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
        <div className="pointer-events-none relative z-10 flex h-full min-w-0 flex-1 items-center gap-2">
          {props.childCount > 0 ? (
            <span className="pointer-events-auto contents">
              <SidebarCardSubThreadChevron
                count={props.childCount}
                isExpanded={props.isExpanded}
                description={thread.title}
                onToggle={row.handleToggleExpanded}
              />
            </span>
          ) : props.reserveExpandGutter ? (
            <SidebarCardSubThreadGutter />
          ) : null}
          <span className={cn("min-w-0 flex-1", props.isRenaming && "pointer-events-auto")}>
            <ConversationDescription
              row={row}
              conversation={props}
              brightenOnHover
              tone={props.isActive || row.isWoke ? "loud" : row.isUnread ? "unread" : "quiet"}
            />
          </span>
          <SidebarCardProvider
            driverKind={row.provider.driverKind}
            displayName={row.provider.displayName}
            modelLabel={row.provider.modelLabel}
          />
          {/* Settling stays reachable, but only on hover, and it reserves no
              width at rest so the description keeps the full row. */}
          {props.settlementSupported ? (
            <span className="pointer-events-auto contents">
              <SidebarCardHoverActionSlot
                actions={
                  <SidebarCardSettleButton
                    description={thread.title}
                    onSettle={row.handleSettleClick}
                    shape="inline"
                  />
                }
              />
            </span>
          ) : null}
          {props.jumpLabel ? <JumpHintBadge label={props.jumpLabel} /> : null}
        </div>
      </div>
    </SidebarCardItem>
  );
});
