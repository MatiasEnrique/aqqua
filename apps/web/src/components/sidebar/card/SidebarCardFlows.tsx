import { cardOperation } from "@aqqua/client-runtime/state/boards";
import type { OrchestrationCard } from "@aqqua/contracts";
import { Trash2Icon } from "lucide-react";
import { cn } from "~/lib/utils";
import {
  type BoardBadgeVariant,
  buildPositionSegments,
  cardFailureNote,
  cardOperationPresentation,
  cardSidebarSummaryState,
  cardStatusLine,
  cardWorktreeLabel,
  currentSegmentVariant,
} from "../../board/BoardRunTable.logic";
import { useSidebarRelativeTimeTick } from "../../board/useSidebarRelativeTimeTick";
import { SidebarSummaryStateLabel } from "../../sidebar-v2/SidebarStatusPresentations";
import { Spinner } from "../../ui/spinner";
import { SidebarCardBranch } from "./SidebarCardBranch";

const SEGMENT_FILL: Record<BoardBadgeVariant, string> = {
  info: "bg-info",
  warning: "bg-warning",
  error: "bg-destructive",
  success: "bg-success",
  secondary: "bg-muted-foreground",
};

/**
 * One badge, one vocabulary: an operation the server is running outranks the
 * card's resting state, so a row never reads Done while it is being deleted.
 */
export function FlowCardStateBadge({ card }: { readonly card: OrchestrationCard }) {
  const operation = cardOperation(card);
  if (operation === "deleting") {
    return (
      <span className="inline-flex h-4 shrink-0 items-center gap-1 font-medium text-[10px] text-destructive-foreground leading-none">
        <Trash2Icon aria-hidden className="size-3.5 shrink-0" />
        <span role="status" className="leading-none">
          Deleting
        </span>
      </span>
    );
  }
  if (operation !== null && operation !== "starting") {
    return (
      <span className="inline-flex h-4 shrink-0 items-center gap-1 font-medium text-[10px] text-sidebar-muted-foreground leading-none">
        <Spinner className="size-3 shrink-0" />
        <span role="status" className="leading-none">
          {cardOperationPresentation(operation).label}
        </span>
      </span>
    );
  }
  return <SidebarSummaryStateLabel state={cardSidebarSummaryState(card)} className="text-[10px]" />;
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

/** How far along the pipeline a card is, one segment per step. */
export function FlowCardProgress({
  card,
  stepNames,
}: {
  readonly card: OrchestrationCard;
  readonly stepNames: ReadonlyArray<string>;
}) {
  const segments = buildPositionSegments(card, stepNames);
  const variant = currentSegmentVariant(card);
  return (
    <span aria-hidden className="flex w-14 shrink-0 items-center gap-0.5">
      {segments.map((segment) => (
        <span
          key={segment.index}
          className={cn(
            "h-1 flex-1 rounded-full transition-colors duration-300 ease-out",
            segment.state === "complete"
              ? "bg-success"
              : segment.state === "current"
                ? SEGMENT_FILL[variant]
                : "bg-sidebar-muted-foreground/25",
          )}
        />
      ))}
    </span>
  );
}

/** A card's current step and how long it has been there, ticking as it ages. */
export function FlowCardStatusLine({
  card,
  stepNames,
  boardName,
}: {
  readonly card: OrchestrationCard;
  readonly stepNames: ReadonlyArray<string>;
  /** Set in the merged "All boards" view so a row says where it runs. */
  readonly boardName: string | null;
}) {
  const nowMs = useSidebarRelativeTimeTick();
  return (
    <span className="min-w-0 truncate text-[11px] text-sidebar-muted-foreground tabular-nums">
      {cardStatusLine(card, stepNames, nowMs)}
      {boardName === null ? null : (
        <span className="text-sidebar-muted-foreground/60"> · {boardName}</span>
      )}
    </span>
  );
}

/** The dot that colours a card by the state of the step it sits on. */
export function FlowCardStateDot({ card }: { readonly card: OrchestrationCard }) {
  return (
    <span
      aria-hidden
      className={cn("size-1.5 shrink-0 rounded-full", SEGMENT_FILL[currentSegmentVariant(card)])}
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
