import { useAtomValue } from "@effect/atom-react";
import {
  type BoardCardSections,
  createBoardArtifactAtoms,
  createBoardEnvironmentAtoms,
  createEnvironmentBoardAtoms,
  selectCard,
} from "@t3tools/client-runtime/state/boards";
import type {
  CardId,
  OrchestrationBoard,
  OrchestrationCard,
  ScopedProjectRef,
} from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

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
});
const EMPTY_SECTIONS_ATOM = Atom.make(EMPTY_SECTIONS).pipe(
  Atom.withLabel("web-board-card-sections:empty"),
);

export function useProjectBoard(ref: ScopedProjectRef | null): OrchestrationBoard | null {
  return useAtomValue(ref === null ? EMPTY_BOARD_ATOM : environmentBoards.projectBoardAtom(ref));
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
