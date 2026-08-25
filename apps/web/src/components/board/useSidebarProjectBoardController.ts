import autoAnimate from "@formkit/auto-animate";
import {
  groupBoardCards,
  isCardDeleting,
  selectBoardCards,
  selectNextCardAfter,
} from "@aqqua/client-runtime/state/boards";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@aqqua/client-runtime/state/runtime";
import {
  BoardId,
  CardId,
  type OrchestrationBoard,
  type OrchestrationCard,
  type ScopedProjectRef,
} from "@aqqua/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { randomUUID } from "../../lib/utils";
import { boardEnvironment, useProjectBoards, useProjectCards } from "../../state/boards";
import { useProject } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { stackedThreadToast, toastManager } from "../ui/toast";
import type { BoardEditorSubmit } from "./BoardEditorDialog";
import { boardCommandFailureDescription, reportBoardCommandResult } from "./boardCommandFeedback";
import { cardNeedsYou } from "./BoardRunTable.logic";
import type { CardCreateSubmit } from "./CardCreateDialog";

export type BoardEditorTarget = {
  /** `null` creates a new board; a board edits it. */
  readonly board: OrchestrationBoard | null;
};

export function useSidebarProjectBoardController({
  projectRef,
}: {
  readonly projectRef: ScopedProjectRef;
}) {
  const { environmentId, projectId } = projectRef;
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const selectedCardId =
    (params.projectId as string | undefined) === projectId
      ? ((params.cardId as string | undefined) ?? null)
      : null;
  const selectedCardIdRef = useRef(selectedCardId);
  selectedCardIdRef.current = selectedCardId;
  const project = useProject(projectRef);
  const boards = useProjectBoards(projectRef);
  const projectCards = useProjectCards(projectRef);
  const createBoard = useAtomCommand(boardEnvironment.createBoard);
  const updateBoard = useAtomCommand(boardEnvironment.updateBoard);
  const createCard = useAtomCommand(boardEnvironment.createCard);
  const releaseCard = useAtomCommand(boardEnvironment.releaseCard);
  const unsettleCard = useAtomCommand(boardEnvironment.unsettleCard);
  const archiveCard = useAtomCommand(boardEnvironment.archiveCard);
  const unarchiveCard = useAtomCommand(boardEnvironment.unarchiveCard);
  const deleteCard = useAtomCommand(boardEnvironment.deleteCard);
  // Empty is the resting "All flows" scope, matching the project multi-select.
  const [chosenBoardIds, setChosenBoardIds] = useState<ReadonlyArray<BoardId>>([]);
  const [editorTarget, setEditorTarget] = useState<BoardEditorTarget | null>(null);
  const [cardDialogOpen, setCardDialogOpen] = useState(false);
  const [settledCollapsed, setSettledCollapsed] = useState(false);
  const [archivedCollapsed, setArchivedCollapsed] = useState(true);
  const [navigateAfterDeletedCard, setNavigateAfterDeletedCard] = useState<CardId | null>(null);
  const [navigateAfterArchivedCard, setNavigateAfterArchivedCard] = useState<CardId | null>(null);
  const [pendingArchive, setPendingArchive] = useState<{
    id: CardId;
    title: string;
    deleteWorktree: boolean;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    id: CardId;
    title: string;
  } | null>(null);
  const [pendingCardIds, setPendingCardIds] = useState<ReadonlySet<CardId>>(() => new Set());
  const routedBoardId = useMemo(() => {
    if (selectedCardId === null) return null;
    return projectCards.find((card) => card.id === selectedCardId)?.boardId ?? null;
  }, [projectCards, selectedCardId]);
  const visibleBoards = useMemo(
    () =>
      chosenBoardIds.length === 0
        ? boards
        : boards.filter((candidate) => chosenBoardIds.includes(candidate.id)),
    [boards, chosenBoardIds],
  );
  useEffect(() => {
    if (chosenBoardIds.length === 0) return;
    const liveIds = new Set(boards.map((candidate) => candidate.id));
    const next = chosenBoardIds.filter((id) => liveIds.has(id));
    if (next.length !== chosenBoardIds.length) setChosenBoardIds(next);
  }, [boards, chosenBoardIds]);
  const board =
    visibleBoards.length === 1
      ? (visibleBoards[0] ?? null)
      : routedBoardId === null
        ? null
        : (visibleBoards.find((candidate) => candidate.id === routedBoardId) ?? null);
  const boardById = useMemo(
    () => new Map(boards.map((candidate) => [candidate.id, candidate])),
    [boards],
  );
  const sections = useMemo(
    () =>
      groupBoardCards(
        visibleBoards.flatMap((candidate) => selectBoardCards(projectCards, candidate.id)),
      ),
    [projectCards, visibleBoards],
  );
  const archivedCards = useMemo(
    () =>
      projectCards.filter(
        (card) =>
          card.archivedAt !== null &&
          visibleBoards.some((candidate) => candidate.id === card.boardId),
      ),
    [projectCards, visibleBoards],
  );
  const needsYouCards = useMemo(() => sections.inFlight.filter(cardNeedsYou), [sections.inFlight]);
  const activeCards = useMemo(
    () => sections.inFlight.filter((card) => !cardNeedsYou(card)),
    [sections.inFlight],
  );

  useEffect(() => {
    if (navigateAfterDeletedCard === null) return;
    if (selectedCardId !== navigateAfterDeletedCard) {
      setNavigateAfterDeletedCard(null);
      return;
    }
    const projectedCard = projectCards.find(
      (candidate) => candidate.id === navigateAfterDeletedCard,
    );
    if (projectedCard !== undefined && !isCardDeleting(projectedCard)) return;
    setNavigateAfterDeletedCard(null);
    void navigate({
      to: "/board/$environmentId/$projectId",
      params: { environmentId, projectId },
    });
  }, [projectCards, environmentId, navigate, navigateAfterDeletedCard, projectId, selectedCardId]);
  useEffect(() => {
    if (navigateAfterArchivedCard === null) return;
    if (selectedCardId !== navigateAfterArchivedCard) {
      setNavigateAfterArchivedCard(null);
      return;
    }
    const projectedCard = projectCards.find(
      (candidate) => candidate.id === navigateAfterArchivedCard,
    );
    if (projectedCard?.archivedAt === null) return;
    setNavigateAfterArchivedCard(null);
    void navigate({
      to: "/board/$environmentId/$projectId",
      params: { environmentId, projectId },
    });
  }, [projectCards, environmentId, navigate, navigateAfterArchivedCard, projectId, selectedCardId]);

  const attachAnimatedList = useCallback((node: HTMLElement | null) => {
    if (node) autoAnimate(node, { duration: 150, easing: "ease-out" });
  }, []);
  const boardNameFor = (card: OrchestrationCard): string =>
    boardById.get(card.boardId)?.name ?? "Unknown flow";
  const openCard = (cardId: CardId) => {
    void navigate({
      to: "/board/$environmentId/$projectId/card/$cardId",
      params: { environmentId, projectId, cardId },
    });
  };
  const withPendingCard = async (cardId: CardId, run: () => Promise<unknown>) => {
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
  };
  const deleteCardRun = async (cardId: CardId) => {
    const nextCardId = selectNextCardAfter(sections, cardId);
    await withPendingCard(cardId, async () => {
      const result = await deleteCard({ environmentId, input: { cardId } });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not delete card",
              description: boardCommandFailureDescription(squashAtomCommandFailure(result)),
            }),
          );
        }
        return;
      }
      if (selectedCardIdRef.current !== cardId) return;
      if (nextCardId !== null) return openCard(nextCardId);
      setNavigateAfterDeletedCard(cardId);
    });
  };
  const archiveCardRun = async (cardId: CardId, deleteWorktree: boolean) => {
    const nextCardId = selectNextCardAfter(sections, cardId);
    await withPendingCard(cardId, async () => {
      const result = await archiveCard({
        environmentId,
        input: { cardId, deleteWorktree },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not archive card",
              description: boardCommandFailureDescription(squashAtomCommandFailure(result)),
            }),
          );
        }
        return;
      }
      if (selectedCardIdRef.current !== cardId) return;
      if (nextCardId !== null) return openCard(nextCardId);
      setNavigateAfterArchivedCard(cardId);
    });
  };
  const unarchiveCardRun = async (cardId: CardId) => {
    await withPendingCard(cardId, async () => {
      const result = await unarchiveCard({ environmentId, input: { cardId } });
      if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not restore card",
          description: boardCommandFailureDescription(squashAtomCommandFailure(result)),
        }),
      );
    });
  };
  const retryDeleteCleanup = async (cardId: CardId) => {
    await withPendingCard(cardId, async () => {
      const result = await deleteCard({ environmentId, input: { cardId } });
      if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not resume deletion",
          description: boardCommandFailureDescription(squashAtomCommandFailure(result)),
        }),
      );
    });
  };
  const handleBoardSubmit = async (input: BoardEditorSubmit) => {
    const target = editorTarget?.board ?? null;
    if (target === null) {
      const boardId = BoardId.make(randomUUID());
      const result = await createBoard({
        environmentId,
        input: { boardId, projectId, name: input.name, steps: input.steps },
      });
      if (!reportBoardCommandResult(result, "Could not create flow")) return false;
      setChosenBoardIds([boardId]);
      return true;
    }
    const result = await updateBoard({
      environmentId,
      input: { boardId: target.id, name: input.name, steps: input.steps },
    });
    return reportBoardCommandResult(result, "Could not update flow");
  };
  const handleCardSubmit = async (input: CardCreateSubmit) => {
    const result = await createCard({
      environmentId,
      input: {
        cardId: CardId.make(randomUUID()),
        boardId: input.boardId,
        title: input.title,
        parameters: input.parameters,
      },
    });
    return reportBoardCommandResult(result, "Could not create card");
  };

  return {
    activeCards,
    archivedCards,
    archivedCollapsed,
    archiveCardRun,
    attachAnimatedList,
    board,
    boardNameFor,
    boards,
    chosenBoardIds,
    cardDialogOpen,
    deleteCardRun,
    editorTarget,
    environmentId,
    handleBoardSubmit,
    handleCardSubmit,
    needsYouCards,
    openCard,
    pendingCardIds,
    pendingArchive,
    pendingDelete,
    project,
    releaseCard,
    retryDeleteCleanup,
    sections,
    selectedCardId,
    setCardDialogOpen,
    setArchivedCollapsed,
    setChosenBoardIds,
    setEditorTarget,
    setPendingDelete,
    setPendingArchive,
    setSettledCollapsed,
    settledCollapsed,
    unsettleCard,
    unarchiveCardRun,
    withPendingCard,
  };
}
