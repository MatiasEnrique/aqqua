import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { countCardsNeedingYou } from "@t3tools/client-runtime/state/boards";
import { BoardId, CardId, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { LayoutGridIcon, PencilIcon, PlusIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { randomUUID } from "~/lib/utils";
import { useAtomCommand } from "../../state/use-atom-command";
import { boardEnvironment, useProjectBoard, useProjectCardSections } from "../../state/boards";
import { useProject } from "../../state/entities";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { BoardEditorDialog, type BoardEditorSubmit } from "./BoardEditorDialog";
import { BoardRunTable } from "./BoardRunTable";
import { CardCreateDialog, type CardCreateSubmit } from "./CardCreateDialog";
import { boardParameterNames } from "./CardCreateDialog.logic";

export function BoardView({
  environmentId,
  projectId,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}) {
  const projectRef = useMemo(
    () => scopeProjectRef(environmentId, projectId),
    [environmentId, projectId],
  );
  const project = useProject(projectRef);
  const board = useProjectBoard(projectRef);
  const sections = useProjectCardSections(projectRef);
  const parameterNames = useMemo(() => boardParameterNames(board), [board]);

  const createBoard = useAtomCommand(boardEnvironment.createBoard);
  const updateBoard = useAtomCommand(boardEnvironment.updateBoard);
  const createCard = useAtomCommand(boardEnvironment.createCard);
  const releaseCard = useAtomCommand(boardEnvironment.releaseCard);
  const archiveCard = useAtomCommand(boardEnvironment.archiveCard);
  const continueCard = useAtomCommand(boardEnvironment.continueCard);
  const retryCard = useAtomCommand(boardEnvironment.retryCard);
  const cancelCard = useAtomCommand(boardEnvironment.cancelCard);
  const navigate = useNavigate();
  const needsYouCount = useMemo(() => countCardsNeedingYou(sections.inFlight), [sections.inFlight]);

  const [editorOpen, setEditorOpen] = useState(false);
  const [cardDialogOpen, setCardDialogOpen] = useState(false);
  const [pendingArchive, setPendingArchive] = useState<{ id: CardId; title: string } | null>(null);
  const [pendingCancel, setPendingCancel] = useState<{ id: CardId; title: string } | null>(null);
  const [pendingRetry, setPendingRetry] = useState<{ id: CardId; title: string } | null>(null);
  const [pendingCardIds, setPendingCardIds] = useState<ReadonlySet<string>>(() => new Set());

  const withPendingCard = useCallback(async (cardId: CardId, run: () => Promise<unknown>) => {
    setPendingCardIds((current) => new Set(current).add(cardId));
    try {
      await run();
    } finally {
      setPendingCardIds((current) => {
        const next = new Set(current);
        next.delete(cardId);
        return next;
      });
    }
  }, []);

  const handleBoardSubmit = async (input: BoardEditorSubmit) => {
    if (board === null) {
      await createBoard({
        environmentId,
        input: {
          boardId: BoardId.make(randomUUID()),
          projectId,
          name: input.name,
          steps: input.steps,
        },
      });
      return;
    }
    await updateBoard({
      environmentId,
      input: { boardId: board.id, name: input.name, steps: input.steps },
    });
  };

  const handleCardSubmit = async (input: CardCreateSubmit) => {
    if (board === null) return;
    await createCard({
      environmentId,
      input: {
        cardId: CardId.make(randomUUID()),
        boardId: board.id,
        title: input.title,
        parameters: input.parameters,
      },
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-4 pt-8 pb-10 sm:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <LayoutGridIcon className="size-4 text-muted-foreground" />
              <h1 className="truncate font-semibold text-lg tracking-[-0.025em] text-foreground">
                {board?.name ?? "Agentic board"}
              </h1>
              {board === null ? null : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Edit board"
                  onClick={() => setEditorOpen(true)}
                >
                  <PencilIcon className="size-3.5" />
                </Button>
              )}
            </div>
            <p className="mt-0.5 flex items-center gap-2 truncate text-xs text-muted-foreground">
              <span className="truncate">
                {project?.title ?? projectId}
                {board === null
                  ? null
                  : ` · ${board.steps.length} step${board.steps.length === 1 ? "" : "s"}`}
              </span>
              {needsYouCount === 0 ? null : (
                <Badge variant="warning" className="shrink-0">
                  {needsYouCount} needs you
                </Badge>
              )}
            </p>
          </div>
          {board === null ? null : (
            <Button size="sm" className="gap-1.5" onClick={() => setCardDialogOpen(true)}>
              <PlusIcon className="size-3.5" />
              New card
            </Button>
          )}
        </header>

        {board === null ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-border/70 py-16 text-center dark:border-transparent dark:bg-white/[0.035]">
            <p className="text-sm text-muted-foreground">
              No board in this project yet. Define the steps once; cards run them every time.
            </p>
            <Button size="sm" className="gap-1.5" onClick={() => setEditorOpen(true)}>
              <PlusIcon className="size-3.5" />
              Create board
            </Button>
          </div>
        ) : (
          <div className="rounded-lg border border-border/70 dark:border-transparent dark:bg-white/[0.035]">
            <BoardRunTable
              board={board}
              sections={sections}
              parameterNames={parameterNames}
              pendingCardIds={pendingCardIds}
              onStartCard={(cardId) => {
                void withPendingCard(cardId, () =>
                  releaseCard({ environmentId, input: { cardId } }),
                );
              }}
              onArchiveCard={(card) => setPendingArchive({ id: card.id, title: card.title })}
              onOpenCard={(cardId) => {
                void navigate({
                  to: "/board/$environmentId/$projectId/card/$cardId",
                  params: { environmentId, projectId, cardId },
                });
              }}
              onContinueCard={(card) => {
                void withPendingCard(card.id, () =>
                  continueCard({ environmentId, input: { cardId: card.id } }),
                );
              }}
              onRetryCard={(card) => setPendingRetry({ id: card.id, title: card.title })}
              onCancelCard={(card) => setPendingCancel({ id: card.id, title: card.title })}
            />
          </div>
        )}
      </div>

      <BoardEditorDialog
        open={editorOpen}
        board={board}
        onOpenChange={setEditorOpen}
        onSubmit={handleBoardSubmit}
      />
      <CardCreateDialog
        open={cardDialogOpen}
        board={board}
        onOpenChange={setCardDialogOpen}
        onSubmit={handleCardSubmit}
      />
      <CardConfirmDialog
        target={pendingRetry}
        title={(title) => `Retry the current step of '${title}'?`}
        description="The step's thread is discarded and a fresh one runs the same prompt again. The worktree keeps whatever the previous attempt changed."
        confirmLabel="Retry step"
        onClose={() => setPendingRetry(null)}
        onConfirm={(target) => {
          void withPendingCard(target.id, () =>
            retryCard({ environmentId, input: { cardId: target.id } }),
          );
        }}
      />
      <CardConfirmDialog
        target={pendingCancel}
        title={(title) => `Cancel '${title}'?`}
        description="This interrupts the running turn. The card stays in its column and can be resumed or retried afterwards."
        confirmLabel="Cancel card"
        destructive
        onClose={() => setPendingCancel(null)}
        onConfirm={(target) => {
          void withPendingCard(target.id, () =>
            cancelCard({ environmentId, input: { cardId: target.id } }),
          );
        }}
      />
      <AlertDialog
        open={pendingArchive !== null}
        onOpenChange={(open) => {
          if (!open) setPendingArchive(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive '{pendingArchive?.title}'?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the card's worktree and its artifacts. The branch's commits stay in the
              repository; anything uncommitted in the worktree is lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                const target = pendingArchive;
                setPendingArchive(null);
                if (target === null) return;
                void withPendingCard(target.id, () =>
                  archiveCard({ environmentId, input: { cardId: target.id } }),
                );
              }}
            >
              Archive card
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}

/** Confirmation for the destructive-ish row actions — retry and cancel. */
function CardConfirmDialog({
  target,
  title,
  description,
  confirmLabel,
  destructive = false,
  onClose,
  onConfirm,
}: {
  readonly target: { id: CardId; title: string } | null;
  readonly title: (cardTitle: string) => string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly destructive?: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (target: { id: CardId; title: string }) => void;
}) {
  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{title(target?.title ?? "")}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Keep going</AlertDialogClose>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={() => {
              if (target === null) return;
              onClose();
              onConfirm(target);
            }}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
