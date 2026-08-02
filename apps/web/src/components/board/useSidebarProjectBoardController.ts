import autoAnimate from "@formkit/auto-animate";
import {
  cardStepNames,
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
import {
  cardNeedsYou,
  sidebarBoardChoiceAfterSettle,
  sidebarFallbackBoard,
} from "./BoardRunTable.logic";
import type { CardCreateSubmit } from "./CardCreateDialog";

export type BoardEditorTarget = {
  /** `null` creates a new board; a board edits it. */
  readonly board: OrchestrationBoard | null;
};

function cardCommandFailureDescription(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (typeof error === "string" && error.trim().length > 0) return error;
  if (typeof error === "object" && error !== null) {
    const message = (error as { readonly message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) return message;
    const detail = (error as { readonly detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim().length > 0) return detail;
  }
  return "The server rejected the card command without a reason.";
}

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
  const settleCard = useAtomCommand(boardEnvironment.settleCard);
  const unsettleCard = useAtomCommand(boardEnvironment.unsettleCard);
  const deleteCard = useAtomCommand(boardEnvironment.deleteCard);
  const [chosenBoard, setChosenBoard] = useState<"all" | string | null>(null);
  const [editorTarget, setEditorTarget] = useState<BoardEditorTarget | null>(null);
  const [cardDialogOpen, setCardDialogOpen] = useState(false);
  const [settledCollapsed, setSettledCollapsed] = useState(false);
  const [navigateAfterSettledCardId, setNavigateAfterSettledCardId] = useState<CardId | null>(null);
  const [navigateAfterDeletedCard, setNavigateAfterDeletedCard] = useState<CardId | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    id: CardId;
    title: string;
  } | null>(null);
  const [pendingCardIds, setPendingCardIds] = useState<ReadonlySet<string>>(() => new Set());
  const routedBoardId = useMemo(() => {
    if (selectedCardId === null) return null;
    return projectCards.find((card) => card.id === selectedCardId)?.boardId ?? null;
  }, [projectCards, selectedCardId]);
  const isAllBoards = chosenBoard === "all" && boards.length > 0;
  const fallbackBoard = useMemo(
    () => sidebarFallbackBoard(boards, projectCards),
    [boards, projectCards],
  );
  const board = isAllBoards
    ? null
    : (boards.find((candidate) => candidate.id === chosenBoard) ??
      boards.find((candidate) => candidate.id === routedBoardId) ??
      fallbackBoard);
  const boardById = useMemo(
    () => new Map(boards.map((candidate) => [candidate.id as string, candidate])),
    [boards],
  );
  const visibleBoards = useMemo(
    () => (isAllBoards ? boards : board === null ? [] : [board]),
    [board, boards, isAllBoards],
  );
  const sections = useMemo(
    () =>
      groupBoardCards(
        visibleBoards.flatMap((candidate) => selectBoardCards(projectCards, candidate.id)),
      ),
    [projectCards, visibleBoards],
  );
  const needsYouCards = useMemo(() => sections.inFlight.filter(cardNeedsYou), [sections.inFlight]);
  const activeCards = useMemo(
    () => sections.inFlight.filter((card) => !cardNeedsYou(card)),
    [sections.inFlight],
  );

  useEffect(() => {
    if (navigateAfterSettledCardId === null) return;
    if (selectedCardId !== navigateAfterSettledCardId) {
      setNavigateAfterSettledCardId(null);
      return;
    }
    const projectedCard = projectCards.find(
      (candidate) => candidate.id === navigateAfterSettledCardId,
    );
    if (projectedCard?.settledAt == null) return;
    setNavigateAfterSettledCardId(null);
    void navigate({
      to: "/board/$environmentId/$projectId",
      params: { environmentId, projectId },
    });
  }, [
    projectCards,
    environmentId,
    navigate,
    navigateAfterSettledCardId,
    projectId,
    selectedCardId,
  ]);
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

  const attachAnimatedList = useCallback((node: HTMLElement | null) => {
    if (node) autoAnimate(node, { duration: 150, easing: "ease-out" });
  }, []);
  const stepNamesFor = (card: OrchestrationCard): ReadonlyArray<string> => {
    const owner = boardById.get(card.boardId);
    return owner === undefined ? [] : cardStepNames(card, owner);
  };
  const boardNameFor = (card: OrchestrationCard): string | null =>
    isAllBoards ? (boardById.get(card.boardId)?.name ?? null) : null;
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
  const settleDoneCard = async (card: OrchestrationCard) => {
    const cardId = card.id;
    const nextWorkingCardId = selectNextCardAfter({ ...sections, settled: [] }, cardId);
    await withPendingCard(cardId, async () => {
      const result = await settleCard({ environmentId, input: { cardId } });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not settle card",
              description: cardCommandFailureDescription(squashAtomCommandFailure(result)),
            }),
          );
        }
        return;
      }
      setChosenBoard((current) => sidebarBoardChoiceAfterSettle(current, card.boardId));
      if (selectedCardIdRef.current !== cardId) return;
      if (nextWorkingCardId !== null) return openCard(nextWorkingCardId);
      setNavigateAfterSettledCardId(cardId);
    });
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
              description: cardCommandFailureDescription(squashAtomCommandFailure(result)),
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
  const retryDeleteCleanup = async (cardId: CardId) => {
    await withPendingCard(cardId, async () => {
      const result = await deleteCard({ environmentId, input: { cardId } });
      if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not resume deletion",
          description: cardCommandFailureDescription(squashAtomCommandFailure(result)),
        }),
      );
    });
  };
  const handleBoardSubmit = async (input: BoardEditorSubmit) => {
    const target = editorTarget?.board ?? null;
    if (target === null) {
      const boardId = BoardId.make(randomUUID());
      await createBoard({
        environmentId,
        input: { boardId, projectId, name: input.name, steps: input.steps },
      });
      setChosenBoard(boardId);
      return;
    }
    await updateBoard({
      environmentId,
      input: { boardId: target.id, name: input.name, steps: input.steps },
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

  return {
    activeCards,
    attachAnimatedList,
    board,
    boardNameFor,
    boards,
    cardDialogOpen,
    deleteCardRun,
    editorTarget,
    environmentId,
    handleBoardSubmit,
    handleCardSubmit,
    isAllBoards,
    needsYouCards,
    openCard,
    pendingCardIds,
    pendingDelete,
    project,
    releaseCard,
    retryDeleteCleanup,
    sections,
    selectedCardId,
    setCardDialogOpen,
    setChosenBoard,
    setEditorTarget,
    setPendingDelete,
    setSettledCollapsed,
    settleDoneCard,
    settledCollapsed,
    stepNamesFor,
    unsettleCard,
    withPendingCard,
  };
}
