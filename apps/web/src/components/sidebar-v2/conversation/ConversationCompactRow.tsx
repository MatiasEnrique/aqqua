import { MessageSquareIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";
import { ProjectFavicon } from "../../ProjectFavicon";
import {
  SidebarCardItem,
  SidebarCardProvider,
  type SidebarCardDescriptionTone,
} from "../../sidebar/card";
import { Tooltip, TooltipTrigger } from "../../ui/tooltip";
import { SUB_AGENT_INDENT_PX } from "../constants";
import { JumpHintBadge } from "../rowChrome";
import {
  ConversationDescription,
  ConversationDetailsTooltip,
  ConversationPrBadge,
} from "./ConversationParts";
import type { ConversationRowModel, ConversationRowProps } from "./useConversationRow";

/**
 * The shell every one-line conversation row shares: description, provider, and
 * a trailing slot. Rows that have stepped out of the inbox — settled, snoozed,
 * or merely quiet — differ in what they put in that slot and what they let you
 * do about it, not in how they're laid out.
 */
export function ConversationCompactRow(props: {
  readonly row: ConversationRowModel;
  readonly conversation: ConversationRowProps;
  readonly descriptionTone: SidebarCardDescriptionTone;
  /** Controls outside the row's own button: selection, sub-agent disclosure. */
  readonly leading?: ReactNode;
  /** Extra detail between the provider mark and the trailing slot. */
  readonly children?: ReactNode;
  /** Status at rest, actions on hover. */
  readonly trailing: ReactNode;
  readonly testId: string;
  /** Settled rows dim their PR badge until hovered. */
  readonly settledPr?: boolean;
  readonly faviconFallback?: boolean;
}) {
  const { conversation, row } = props;
  const { thread } = conversation;
  return (
    <SidebarCardItem size="slim">
      <div
        className={cn(row.surfaceClassName, "flex h-9 items-center gap-2.5 pr-2.5")}
        style={{ paddingInlineStart: 10 + conversation.depth * SUB_AGENT_INDENT_PX }}
      >
        {props.leading}
        <Tooltip>
          <TooltipTrigger
            render={
              <div
                role="button"
                tabIndex={0}
                data-testid={props.testId}
                className="flex h-full min-w-0 flex-1 items-center gap-2.5 outline-none"
                onClick={row.handleClick}
                onDoubleClick={row.handleDoubleClick}
                onKeyDown={row.handleKeyDown}
                onContextMenu={row.handleContextMenu}
              />
            }
          >
            {/* Settled history recedes: dimmed favicon at rest, restored on
                hover so the tail stays scannable when you're hunting. */}
            {conversation.showProjectIdentity ? (
              <span
                className={cn(
                  "shrink-0 transition-opacity",
                  !conversation.isActive &&
                    "opacity-40 grayscale group-hover/v2-row:opacity-100 group-hover/v2-row:grayscale-0",
                )}
              >
                <ProjectFavicon
                  environmentId={thread.environmentId}
                  cwd={conversation.projectCwd ?? ""}
                  className="size-4"
                  {...(props.faviconFallback === true ? { fallbackIcon: MessageSquareIcon } : {})}
                />
              </span>
            ) : null}
            <ConversationDescription
              row={row}
              conversation={conversation}
              tone={props.descriptionTone}
              brightenOnHover
            />
            <ConversationPrBadge
              row={row}
              {...(props.settledPr === true
                ? { settled: true, isActive: conversation.isActive }
                : {})}
            />
            <SidebarCardProvider
              driverKind={row.provider.driverKind}
              displayName={row.provider.displayName}
              modelLabel={row.provider.modelLabel}
            />
            {props.children}
            {props.trailing}
            {conversation.jumpLabel ? <JumpHintBadge label={conversation.jumpLabel} /> : null}
          </TooltipTrigger>
          <ConversationDetailsTooltip row={row} conversation={conversation} />
        </Tooltip>
      </div>
    </SidebarCardItem>
  );
}
