import { useAtomValue } from "@effect/atom-react";
import {
  type BoardCardSections,
  createBoardArtifactAtoms,
  createBoardEnvironmentAtoms,
  createEnvironmentBoardAtoms,
  selectCard,
} from "@aqqua/client-runtime/state/boards";
import type {
  CardId,
  EnvironmentId,
  OrchestrationBoard,
  OrchestrationCard,
  ScopedProjectRef,
} from "@aqqua/contracts";
import { Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { environmentSnapshotAtom } from "./shell";

export const boardEnvironment = createBoardEnvironmentAtoms(connectionAtomRuntime);
export const boardArtifacts = createBoardArtifactAtoms(connectionAtomRuntime);
export const environmentBoards = createEnvironmentBoardAtoms({
  snapshotAtom: environmentSnapshotAtom,
});

const EMPTY_BOARD_ATOM = Atom.make<OrchestrationBoard | null>(null).pipe(
  Atom.withLabel("web-board:empty"),
);
const EMPTY_SECTIONS: BoardCardSections = Object.freeze({
  todo: Object.freeze([]),
  inFlight: Object.freeze([]),
  done: Object.freeze([]),
  settled: Object.freeze([]),
  deleting: Object.freeze([]),
});
const EMPTY_SECTIONS_ATOM = Atom.make(EMPTY_SECTIONS).pipe(
  Atom.withLabel("web-board-card-sections:empty"),
);

export function useProjectBoard(ref: ScopedProjectRef | null): OrchestrationBoard | null {
  return useAtomValue(ref === null ? EMPTY_BOARD_ATOM : environmentBoards.projectBoardAtom(ref));
}

const EMPTY_BOARDS_ATOM = Atom.make<ReadonlyArray<OrchestrationBoard>>([]).pipe(
  Atom.withLabel("web-environment-boards:empty"),
);

/** Every board in the environment, across projects. */
export function useEnvironmentBoards(
  environmentId: EnvironmentId | null,
): ReadonlyArray<OrchestrationBoard> {
  return useAtomValue(
    environmentId === null
      ? EMPTY_BOARDS_ATOM
      : environmentBoards.environmentBoardsAtom(environmentId),
  );
}

/** Live boards across exactly the environments represented in an all-projects view. */
export function useEnvironmentsBoards(
  environmentIds: ReadonlyArray<EnvironmentId>,
): ReadonlyArray<OrchestrationBoard> {
  return useAtomValue(environmentBoards.environmentsBoardsAtom(environmentIds));
}

/** All of a project's boards — projects can hold more than one. */
export function useProjectBoards(ref: ScopedProjectRef | null): ReadonlyArray<OrchestrationBoard> {
  return useAtomValue(ref === null ? EMPTY_BOARDS_ATOM : environmentBoards.projectBoardsAtom(ref));
}

/** One board by id, live from the environment snapshot. */
export function useBoard(
  environmentId: EnvironmentId | null,
  boardId: string | null,
): OrchestrationBoard | null {
  const boards = useEnvironmentBoards(environmentId);
  return useMemo(
    () => (boardId === null ? null : (boards.find((board) => board.id === boardId) ?? null)),
    [boards, boardId],
  );
}

/** Every card in the environment, across boards. */
export function useEnvironmentCards(
  environmentId: EnvironmentId | null,
): ReadonlyArray<OrchestrationCard> {
  return useAtomValue(
    environmentId === null
      ? EMPTY_CARDS_ATOM
      : environmentBoards.environmentCardsAtom(environmentId),
  );
}

export function useProjectCardSections(ref: ScopedProjectRef | null): BoardCardSections {
  return useAtomValue(
    ref === null ? EMPTY_SECTIONS_ATOM : environmentBoards.projectCardSectionsAtom(ref),
  );
}

const EMPTY_CARDS_ATOM = Atom.make<ReadonlyArray<OrchestrationCard>>([]).pipe(
  Atom.withLabel("web-board-cards:empty"),
);

export function useProjectCards(ref: ScopedProjectRef | null): ReadonlyArray<OrchestrationCard> {
  return useAtomValue(ref === null ? EMPTY_CARDS_ATOM : environmentBoards.projectCardsAtom(ref));
}

/** The one card a detail route addresses, live from the shell snapshot. */
export function useCard(
  ref: ScopedProjectRef | null,
  cardId: CardId | null,
): OrchestrationCard | null {
  const cards = useProjectCards(ref);
  return cardId === null ? null : selectCard(cards, cardId);
}
