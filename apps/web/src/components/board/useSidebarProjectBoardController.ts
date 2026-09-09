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
import { type BoardId, CardId, type ScopedProjectRef } from "@aqqua/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { randomUUID } from "../../lib/utils";
import { boardEnvironment, useProjectBoards, useProjectCards } from "../../state/boards";
import { useProject } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { boardCommandFailureDescription, reportBoardCommandResult } from "./boardCommandFeedback";
import { cardNeedsYou } from "./BoardRunTable.logic";
import type { CardCreateSubmit } from "./CardCreateDialog";

export function useSidebarProjectBoardController({
  projectRef,
  boardId,
}: {
  readonly projectRef: ScopedProjectRef;
  /** The one flow the sidebar shows; `null` while the project has none. */
  readonly boardId: BoardId | null;
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
  const projectDetails = useProject(projectRef);
  const boards = useProjectBoards(projectRef);
  const projectCards = useProjectCards(projectRef);
  const createCard = useAtomCommand(boardEnvironment.createCard);
  const releaseCard = useAtomCommand(boardEnvironment.releaseCard);
  const unsettleCard = useAtomCommand(boardEnvironment.unsettleCard);
  const archiveCard = useAtomCommand(boardEnvironment.archiveCard);
  const unarchiveCard = useAtomCommand(boardEnvironment.unarchiveCard);
  const deleteCard = useAtomCommand(boardEnvironment.deleteCard);
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
  const board = useMemo(
    () =>
      boardId === null ? null : (boards.find((candidate) => candidate.id === boardId) ?? null),
    [boards, boardId],
  );
  const sections = useMemo(
    () => groupBoardCards(board === null ? [] : selectBoardCards(projectCards, board.id)),
    [board, projectCards],
  );
  const archivedCards = useMemo(
    () =>
      board === null
        ? []
        : projectCards.filter((card) => card.archivedAt !== null && card.boardId === board.id),
    [board, projectCards],
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
    boards,
    deleteCardRun,
    environmentId,
    handleCardSubmit,
    needsYouCards,
    openCard,
    pendingCardIds,
    pendingArchive,
    pendingDelete,
    projectDetails,
    releaseCard,
    retryDeleteCleanup,
    sections,
    selectedCardId,
    setArchivedCollapsed,
    setPendingDelete,
    setPendingArchive,
    setSettledCollapsed,
    settledCollapsed,
    unsettleCard,
    unarchiveCardRun,
    withPendingCard,
  };
}
