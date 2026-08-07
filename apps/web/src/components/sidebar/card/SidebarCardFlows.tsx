import { cardOperation } from "@aqqua/client-runtime/state/boards";
import type { OrchestrationCard } from "@aqqua/contracts";
import { cn } from "~/lib/utils";
import {
  cardFailureNote,
  cardOperationPresentation,
  cardSidebarSummaryState,
  cardWorktreeLabel,
} from "../../board/BoardRunTable.logic";
import { SidebarSummaryStateLabel } from "../../sidebar-v2/SidebarStatusPresentations";
import { StatusIndicator } from "../../StatusIndicator";
import { SidebarCardBranch } from "./SidebarCardBranch";

/**
 * One badge, one vocabulary: an operation the server is running outranks the
 * card's resting state, so a row never reads Done while it is being deleted.
 */
export function FlowCardStateBadge({
  card,
  className,
}: {
  readonly card: OrchestrationCard;
  /** Size class, so a full card and a slim row can weigh the badge differently. */
  readonly className?: string;
}) {
  const operation = cardOperation(card);
  if (operation === "deleting") {
    return (
      <StatusIndicator
        state="failed"
        label="Deleting"
        showLabel
        size="size-2"
        className={cn("h-4 text-[10px] text-destructive-foreground", className)}
      />
    );
  }
  if (operation !== null && operation !== "starting") {
    return (
      <StatusIndicator
        state="working"
        label={cardOperationPresentation(operation).label}
        showLabel
        size="size-2"
        className={cn("h-4 text-[10px] text-sidebar-muted-foreground", className)}
      />
    );
  }
  return (
    <SidebarSummaryStateLabel
      state={cardSidebarSummaryState(card)}
      className={cn("text-[10px]", className)}
    />
  );
}

/**
 * The worktree a card runs in. Cards that have never been released have none,
 * so the line simply isn't there; once released it stays put through Done and
 * Settled, because the checkout does too.
 */
export function FlowCardBranch({
  card,
  className,
}: {
  readonly card: OrchestrationCard;
  readonly className?: string;
}) {
  const worktree = cardWorktreeLabel(card);
  return (
    <SidebarCardBranch
      branch={worktree === null ? null : { ...worktree, isWorktree: card.worktreePath !== null }}
      className={cn("text-[11px] text-sidebar-muted-foreground/70", className)}
    />
  );
}

/** The reason a card came back from an operation it was supposed to leave on. */
export function FlowCardFailureNote({ card }: { readonly card: OrchestrationCard }) {
  const note = cardFailureNote(card);
  if (note === null) return null;
  return (
    <p className="truncate px-2 pb-1 text-[11px] text-destructive-foreground" title={note}>
      {note}
    </p>
  );
}
