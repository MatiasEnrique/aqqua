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
        <Tooltip>
          <TooltipTrigger
            render={
              <div
                role="button"
                tabIndex={0}
                aria-label={thread.title}
                data-testid={props.testId}
                className="absolute inset-0 z-0 rounded-md outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
                onClick={row.handleClick}
                onDoubleClick={row.handleDoubleClick}
                onKeyDown={row.handleKeyDown}
                onContextMenu={row.handleContextMenu}
              />
            }
          />
          <ConversationDetailsTooltip row={row} conversation={conversation} />
        </Tooltip>
        <div className="pointer-events-none relative z-10 flex h-full min-w-0 flex-1 items-center gap-2.5">
          {props.leading === undefined ? null : (
            <span className="pointer-events-auto contents">{props.leading}</span>
          )}
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
          <span
            className={cn("flex min-w-0 flex-1", conversation.isRenaming && "pointer-events-auto")}
          >
            <ConversationDescription
              row={row}
              conversation={conversation}
              tone={props.descriptionTone}
              brightenOnHover
            />
          </span>
          <span className="pointer-events-auto contents">
            <ConversationPrBadge
              row={row}
              {...(props.settledPr === true
                ? { settled: true, isActive: conversation.isActive }
                : {})}
            />
          </span>
          <SidebarCardProvider
            driverKind={row.provider.driverKind}
            displayName={row.provider.displayName}
            modelLabel={row.provider.modelLabel}
          />
          {props.children === undefined ? null : (
            <span className="pointer-events-auto contents">{props.children}</span>
          )}
          <span className="pointer-events-auto contents">{props.trailing}</span>
          {conversation.jumpLabel ? <JumpHintBadge label={conversation.jumpLabel} /> : null}
        </div>
      </div>
    </SidebarCardItem>
  );
}
