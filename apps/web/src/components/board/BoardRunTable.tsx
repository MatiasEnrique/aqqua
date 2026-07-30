import type { OrchestrationBoard, OrchestrationCard } from "@t3tools/contracts";
import { cardStepNames, type BoardCardSections } from "@t3tools/client-runtime/state/boards";
import { BanIcon, ArrowRightIcon, PlayIcon, RotateCcwIcon } from "lucide-react";
import { useMemo, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { useRelativeTimeTick } from "../settings/settingsLayout";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import {
  type BoardBadgeVariant,
  type BoardSegment,
  buildPositionSegments,
  cardPositionLabel,
  cardStatusPresentation,
  currentSegmentVariant,
  formatElapsed,
  inFlightRowActions,
  summarizeCardParameters,
} from "./BoardRunTable.logic";

const SEGMENT_FILL: Record<BoardBadgeVariant, string> = {
  info: "bg-info",
  warning: "bg-warning",
  error: "bg-destructive",
  success: "bg-success",
  secondary: "bg-muted-foreground",
};

export interface BoardRunTableProps {
  readonly board: OrchestrationBoard;
  readonly sections: BoardCardSections;
  readonly parameterNames: ReadonlyArray<string>;
  readonly onStartCard: (cardId: OrchestrationCard["id"]) => void;
  readonly onArchiveCard: (card: OrchestrationCard) => void;
  /**
   * Seam for the card-detail lane: rows are already clickable, they just have
   * nowhere to go yet.
   */
  readonly onOpenCard?: (cardId: OrchestrationCard["id"]) => void;
  /** Recovery actions on in-flight rows; also reachable in card detail. */
  readonly onCancelCard: (card: OrchestrationCard) => void;
  readonly onRetryCard: (card: OrchestrationCard) => void;
  readonly onContinueCard: (card: OrchestrationCard) => void;
  readonly pendingCardIds: ReadonlySet<string>;
}

export function BoardRunTable({
  board,
  sections,
  parameterNames,
  onStartCard,
  onArchiveCard,
  onOpenCard,
  onCancelCard,
  onRetryCard,
  onContinueCard,
  pendingCardIds,
}: BoardRunTableProps) {
  const nowMs = useRelativeTimeTick();
  const isEmpty = sections.todo.length + sections.inFlight.length + sections.done.length === 0;

  return (
    <Table className="text-sm">
      <TableHeader>
        <TableRow className="border-border/60">
          <TableHead className="w-[38%] text-muted-foreground">Card</TableHead>
          <TableHead className="w-[26%] text-muted-foreground">Position</TableHead>
          <TableHead className="w-[14%] text-muted-foreground">Status</TableHead>
          <TableHead className="w-[10%] text-right text-muted-foreground">Elapsed</TableHead>
          <TableHead className="w-[12%] text-right text-muted-foreground">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isEmpty ? (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
              No cards yet — create one to fill the backlog.
            </TableCell>
          </TableRow>
        ) : null}

        <BoardSection
          label="To-Do"
          cards={sections.todo}
          board={board}
          parameterNames={parameterNames}
          nowMs={nowMs}
          onOpenCard={onOpenCard}
          renderAction={(card) => (
            <Button
              size="sm"
              className="h-7 gap-1.5 px-2.5 text-xs"
              disabled={pendingCardIds.has(card.id)}
              onClick={(event) => {
                event.stopPropagation();
                onStartCard(card.id);
              }}
            >
              <PlayIcon className="size-3.5" />
              Start
            </Button>
          )}
        />

        <BoardSection
          label="In flight"
          cards={sections.inFlight}
          board={board}
          parameterNames={parameterNames}
          nowMs={nowMs}
          onOpenCard={onOpenCard}
          renderAction={(card) => {
            const actions = inFlightRowActions(card);
            const disabled = pendingCardIds.has(card.id);
            return (
              <div className="flex items-center justify-end gap-1.5">
                {actions.continue ? (
                  <Button
                    size="sm"
                    className="h-7 gap-1.5 px-2.5 text-xs"
                    disabled={disabled}
                    onClick={(event) => {
                      event.stopPropagation();
                      onContinueCard(card);
                    }}
                  >
                    <ArrowRightIcon className="size-3.5" />
                    Continue
                  </Button>
                ) : null}
                {actions.retry ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 px-2.5 text-xs"
                    disabled={disabled}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRetryCard(card);
                    }}
                  >
                    <RotateCcwIcon className="size-3.5" />
                    Retry
                  </Button>
                ) : null}
                {actions.cancel ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 px-2.5 text-xs"
                    disabled={disabled}
                    onClick={(event) => {
                      event.stopPropagation();
                      onCancelCard(card);
                    }}
                  >
                    <BanIcon className="size-3.5" />
                    Cancel
                  </Button>
                ) : null}
              </div>
            );
          }}
        />

        <BoardSection
          label="Done"
          cards={sections.done}
          board={board}
          parameterNames={parameterNames}
          nowMs={nowMs}
          onOpenCard={onOpenCard}
          renderAction={(card) => (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-xs"
              disabled={pendingCardIds.has(card.id)}
              onClick={(event) => {
                event.stopPropagation();
                onArchiveCard(card);
              }}
            >
              Archive
            </Button>
          )}
        />
      </TableBody>
    </Table>
  );
}

function BoardSection({
  label,
  cards,
  board,
  parameterNames,
  nowMs,
  onOpenCard,
  renderAction,
}: {
  readonly label: string;
  readonly cards: ReadonlyArray<OrchestrationCard>;
  readonly board: OrchestrationBoard;
  readonly parameterNames: ReadonlyArray<string>;
  readonly nowMs: number;
  readonly onOpenCard: ((cardId: OrchestrationCard["id"]) => void) | undefined;
  readonly renderAction?: (card: OrchestrationCard) => ReactNode;
}) {
  if (cards.length === 0) {
    return null;
  }
  return (
    <>
      <TableRow className="border-border/60 hover:bg-transparent">
        <TableCell
          colSpan={5}
          className="bg-muted/40 py-1.5 font-medium text-[11px] tracking-[0.06em] text-muted-foreground uppercase"
        >
          {label}
          <span className="ml-2 text-muted-foreground/60">{cards.length}</span>
        </TableCell>
      </TableRow>
      {cards.map((card) => (
        <BoardCardRow
          key={card.id}
          card={card}
          board={board}
          parameterNames={parameterNames}
          nowMs={nowMs}
          onOpenCard={onOpenCard}
          action={renderAction?.(card)}
        />
      ))}
    </>
  );
}

function BoardCardRow({
  card,
  board,
  parameterNames,
  nowMs,
  onOpenCard,
  action,
}: {
  readonly card: OrchestrationCard;
  readonly board: OrchestrationBoard;
  readonly parameterNames: ReadonlyArray<string>;
  readonly nowMs: number;
  readonly onOpenCard: ((cardId: OrchestrationCard["id"]) => void) | undefined;
  readonly action: ReactNode;
}) {
  const stepNames = useMemo(() => cardStepNames(card, board), [card, board]);
  const segments = useMemo(() => buildPositionSegments(card, stepNames), [card, stepNames]);
  const status = cardStatusPresentation(card);
  const parameters = summarizeCardParameters(card.parameters, parameterNames);
  const elapsed = formatElapsed(card.releasedAt, nowMs);

  return (
    <TableRow
      className={cn("border-border/50", onOpenCard ? "cursor-pointer" : undefined)}
      onClick={onOpenCard ? () => onOpenCard(card.id) : undefined}
    >
      <TableCell className="max-w-0 py-2.5">
        <div className="truncate font-medium text-foreground">{card.title}</div>
        {parameters === null ? null : (
          <div className="truncate font-mono text-[11px] text-muted-foreground">{parameters}</div>
        )}
      </TableCell>
      <TableCell className="py-2.5">
        <PositionTrack card={card} segments={segments} />
        <div className="mt-1 text-[11px] text-muted-foreground">
          {cardPositionLabel(card, stepNames)}
        </div>
      </TableCell>
      <TableCell className="py-2.5">
        {status === null ? (
          <span className="text-muted-foreground/60">—</span>
        ) : (
          <Badge variant={status.variant}>{status.label}</Badge>
        )}
      </TableCell>
      <TableCell className="py-2.5 text-right font-mono text-xs text-muted-foreground tabular-nums">
        {elapsed ?? "—"}
      </TableCell>
      <TableCell className="py-2.5 text-right">{action}</TableCell>
    </TableRow>
  );
}

function PositionTrack({
  card,
  segments,
}: {
  readonly card: OrchestrationCard;
  readonly segments: ReadonlyArray<BoardSegment>;
}) {
  const currentFill = SEGMENT_FILL[currentSegmentVariant(card)];
  return (
    <div
      className="flex items-center gap-1"
      aria-label={`Position: ${cardPositionLabel(
        card,
        segments.map((segment) => segment.stepName ?? ""),
      )}`}
    >
      {segments.length === 0 ? (
        <div className="h-1.5 w-full rounded-full bg-muted-foreground/15" />
      ) : (
        segments.map((segment) => (
          <div
            key={segment.index}
            title={segment.stepName ?? undefined}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              segment.state === "complete"
                ? "bg-success"
                : segment.state === "current"
                  ? currentFill
                  : "bg-muted-foreground/15",
            )}
          />
        ))
      )}
    </div>
  );
}
