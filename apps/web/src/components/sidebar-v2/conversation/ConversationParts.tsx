import { cn } from "~/lib/utils";
import {
  SidebarCardDescription,
  SidebarCardDescriptionInput,
  type SidebarCardDescriptionTone,
} from "../../sidebar/card";
import { SidebarV2ThreadTooltip } from "../rowChrome";
import type { ConversationRowModel, ConversationRowProps } from "./useConversationRow";

/**
 * The thread's description, or the field that renames it. Every row shares the
 * rename wiring; only the tone differs, and the row that knows why it is quiet
 * passes it in.
 */
export function ConversationDescription(props: {
  readonly row: ConversationRowModel;
  readonly conversation: ConversationRowProps;
  readonly tone: SidebarCardDescriptionTone;
  readonly brightenOnHover?: boolean;
}) {
  const { conversation, row } = props;
  if (conversation.isRenaming) {
    return (
      <SidebarCardDescriptionInput
        value={conversation.renamingTitle}
        label="Thread title"
        onChange={conversation.onRenameTitleChange}
        onKeyDown={row.handleRenameKeyDown}
        onBlur={row.handleRenameBlur}
      />
    );
  }
  return (
    <SidebarCardDescription
      tone={props.tone}
      muted={row.shouldRecede}
      {...(props.brightenOnHover === undefined ? {} : { brightenOnHover: props.brightenOnHover })}
    >
      {conversation.thread.title}
    </SidebarCardDescription>
  );
}

/**
 * The pull request a thread's branch opened. Kept out of any hover-fading slot:
 * it must stay visible and clickable while the row is hovered.
 */
export function ConversationPrBadge(props: {
  readonly row: ConversationRowModel;
  /** Settled rows dim the badge until hovered, then colour it by PR state. */
  readonly settled?: boolean;
  readonly isActive?: boolean;
}) {
  const { pr, prStatus } = props.row;
  if (prStatus === null || pr === null) return null;
  return (
    <button
      type="button"
      onClick={props.row.handlePrClick}
      className={cn(
        "shrink-0 text-xs tabular-nums hover:underline",
        props.settled === true
          ? props.isActive === true
            ? "text-muted-foreground/70"
            : cn("text-muted-foreground/35 transition-colors", props.row.settledPrHoverClass)
          : prStatus.colorClass,
      )}
      aria-label={prStatus.tooltip}
    >
      #{pr.number}
    </button>
  );
}

/** The row's full identity, on hover: project, environment, branch, model. */
export function ConversationDetailsTooltip(props: {
  readonly row: ConversationRowModel;
  readonly conversation: ConversationRowProps;
}) {
  const { conversation, row } = props;
  return (
    <SidebarV2ThreadTooltip
      thread={conversation.thread}
      projectTitle={conversation.projectTitle}
      projectCwd={conversation.projectCwd}
      environmentLabel={conversation.environmentLabel}
      driverKind={row.provider.driverKind}
      modelInstanceId={row.provider.instanceId}
      modelLabel={row.provider.modelLabel}
      branchMismatch={row.branchMismatch}
    />
  );
}
