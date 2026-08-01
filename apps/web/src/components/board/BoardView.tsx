import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { groupBoardCards, selectBoardCards } from "@t3tools/client-runtime/state/boards";
import { BoardId, CardId, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { LayoutGridIcon, PencilIcon, PlusIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";

import { randomUUID } from "~/lib/utils";
import { boardEnvironment, useEnvironmentCards, useProjectBoards } from "../../state/boards";
import { useProject } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import type { BoardEditorSubmit } from "./BoardEditorDialog";
import { cardNeedsYou } from "./BoardRunTable.logic";
import { CardCreateDialog, type CardCreateSubmit } from "./CardCreateDialog";

const BoardEditorDialog = lazy(() =>
  import("./BoardEditorDialog").then((module) => ({
    default: module.BoardEditorDialog,
  })),
);

/**
 * Board index: the surface always shows a card, so landing here bounces to
 * the most urgent working one — needs-you first, then active, backlog, Done.
 * Settled history never resurfaces on its own. The page itself only renders
 * when there is nothing to bounce to: no board yet, or no working cards.
 */
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
  const boards = useProjectBoards(projectRef);
  const environmentCards = useEnvironmentCards(environmentId);
  // The landing pick considers every board's cards, not just the first's.
  const sections = useMemo(
    () => groupBoardCards(boards.flatMap((board) => selectBoardCards(environmentCards, board.id))),
    [boards, environmentCards],
  );
  const board = boards[0] ?? null;

  const createBoard = useAtomCommand(boardEnvironment.createBoard);
  const updateBoard = useAtomCommand(boardEnvironment.updateBoard);
  const createCard = useAtomCommand(boardEnvironment.createCard);
  const navigate = useNavigate();

  const [editorOpen, setEditorOpen] = useState(false);
  const [cardDialogOpen, setCardDialogOpen] = useState(false);

  const bestCardId =
    sections.inFlight.find(cardNeedsYou)?.id ??
    sections.inFlight[0]?.id ??
    sections.todo[0]?.id ??
    sections.done[0]?.id ??
    null;

  useEffect(() => {
    if (board === null || bestCardId === null) return;
    void navigate({
      to: "/board/$environmentId/$projectId/card/$cardId",
      params: { environmentId, projectId, cardId: bestCardId },
      replace: true,
    });
  }, [bestCardId, board, environmentId, navigate, projectId]);

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
      {board === null ? (
        <Empty className="flex-1 pb-16">
          <EmptyHeader className="starting:translate-y-3 starting:opacity-0 transition-[opacity,translate] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none">
            <EmptyMedia variant="icon">
              <LayoutGridIcon className="size-4.5 text-muted-foreground" />
            </EmptyMedia>
            <EmptyTitle>No board in {project?.title ?? projectId}</EmptyTitle>
            <EmptyDescription>
              Define the steps once for this project. Every card you create runs through them. If
              your board lives in another project, switch projects from the sidebar menu.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="starting:translate-y-3 starting:opacity-0 transition-[opacity,translate] duration-500 delay-100 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none">
            <Button size="sm" className="gap-1.5" onClick={() => setEditorOpen(true)}>
              <PlusIcon className="size-3.5" />
              Create board
            </Button>
          </EmptyContent>
        </Empty>
      ) : bestCardId === null ? (
        <Empty className="flex-1 pb-16">
          <EmptyHeader className="starting:translate-y-3 starting:opacity-0 transition-[opacity,translate] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none">
            <EmptyMedia variant="icon">
              <LayoutGridIcon className="size-4.5 text-muted-foreground" />
            </EmptyMedia>
            <EmptyTitle>
              {sections.settled.length > 0 ? "No active cards" : "No cards yet"}
            </EmptyTitle>
            <EmptyDescription>
              {sections.settled.length > 0
                ? "Choose a card from Settled history, or add a new one to the working board."
                : "Add a card and its fields fill the pipeline's placeholders. Start it whenever the backlog is ready."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="starting:translate-y-3 starting:opacity-0 transition-[opacity,translate] duration-500 delay-100 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none">
            <div className="flex items-center gap-2">
              <Button size="sm" className="gap-1.5" onClick={() => setCardDialogOpen(true)}>
                <PlusIcon className="size-3.5" />
                New card
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => setEditorOpen(true)}
              >
                <PencilIcon className="size-3.5" />
                Edit board
              </Button>
            </div>
          </EmptyContent>
        </Empty>
      ) : null}

      {editorOpen ? (
        <Suspense fallback={null}>
          <BoardEditorDialog
            open
            board={board}
            environmentId={environmentId}
            projectTitle={project?.title ?? projectId}
            workspaceRoot={project?.workspaceRoot ?? null}
            onOpenChange={setEditorOpen}
            onSubmit={handleBoardSubmit}
          />
        </Suspense>
      ) : null}
      <CardCreateDialog
        open={cardDialogOpen}
        board={board}
        onOpenChange={setCardDialogOpen}
        onSubmit={handleCardSubmit}
      />
    </div>
  );
}
