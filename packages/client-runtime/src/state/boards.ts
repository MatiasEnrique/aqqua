import type {
  BoardId,
  BoardStepContinuation,
  CardId,
  CardStatus,
  EnvironmentId,
  OrchestrationBoard,
  OrchestrationCard,
  OrchestrationShellSnapshot,
  ProjectId,
  ScopedProjectRef,
  ThreadId,
} from "@t3tools/contracts";
import { BOARD_WS_METHODS, CONTINUABLE_CARD_STATUSES } from "@t3tools/contracts";
import { extractBoardTemplatePlaceholders } from "@t3tools/shared/boardTemplate";
import * as Crypto from "effect/Crypto";
import { Atom } from "effect/unstable/reactivity";

import {
  type ArchiveCardInput,
  type CancelCardInput,
  type ContinueCardInput,
  type CreateBoardInput,
  type CreateCardInput,
  type DeleteBoardInput,
  type ReleaseCardInput,
  type RetryCardInput,
  type UpdateBoardInput,
  archiveCard,
  cancelCard,
  continueCard,
  createBoard,
  createCard,
  deleteBoard,
  releaseCard,
  retryCard,
  updateBoard,
} from "../operations/commands.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentCommand,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";
import { arrayElementsEqual, parseProjectKey, projectKey } from "./entities.ts";

export type {
  ArchiveCardInput,
  CancelCardInput,
  ContinueCardInput,
  CreateBoardInput,
  CreateCardInput,
  DeleteBoardInput,
  ReleaseCardInput,
  RetryCardInput,
  UpdateBoardInput,
} from "../operations/commands.ts";

const EMPTY_BOARDS: ReadonlyArray<OrchestrationBoard> = Object.freeze([]);
const EMPTY_CARDS: ReadonlyArray<OrchestrationCard> = Object.freeze([]);

// ── Pure selectors ─────────────────────────────────────────────

/** Live boards of a project, oldest first — deleted boards never surface. */
export function selectProjectBoards(
  boards: ReadonlyArray<OrchestrationBoard>,
  projectId: ProjectId,
): ReadonlyArray<OrchestrationBoard> {
  const matches = boards.filter(
    (board) => board.projectId === projectId && board.deletedAt === null,
  );
  if (matches.length === 0) {
    return EMPTY_BOARDS;
  }
  return matches.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

/**
 * The board a project's board route shows. v1 has one board per project; the
 * oldest live board wins if a project somehow carries several.
 */
export function selectProjectBoard(
  boards: ReadonlyArray<OrchestrationBoard>,
  projectId: ProjectId,
): OrchestrationBoard | null {
  return selectProjectBoards(boards, projectId)[0] ?? null;
}

/** Unarchived cards of a board, oldest first. */
export function selectBoardCards(
  cards: ReadonlyArray<OrchestrationCard>,
  boardId: BoardId,
): ReadonlyArray<OrchestrationCard> {
  const matches = cards.filter((card) => card.boardId === boardId && card.archivedAt === null);
  if (matches.length === 0) {
    return EMPTY_CARDS;
  }
  return matches.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export interface BoardCardSections {
  /** Backlog: no worktree, no snapshot — the Start action lives here. */
  readonly todo: ReadonlyArray<OrchestrationCard>;
  /** Released and still inside the step pipeline. */
  readonly inFlight: ReadonlyArray<OrchestrationCard>;
  /** Finished the pipeline; the Archive action lives here. */
  readonly done: ReadonlyArray<OrchestrationCard>;
}

const EMPTY_SECTIONS: BoardCardSections = Object.freeze({
  todo: EMPTY_CARDS,
  inFlight: EMPTY_CARDS,
  done: EMPTY_CARDS,
});

/**
 * Split a board's cards into the run table's three sections. In-flight rows
 * keep their release order (most recent first) so the active work reads top
 * down; To-Do and Done stay in creation order.
 */
export function groupBoardCards(cards: ReadonlyArray<OrchestrationCard>): BoardCardSections {
  if (cards.length === 0) {
    return EMPTY_SECTIONS;
  }
  const todo: OrchestrationCard[] = [];
  const inFlight: OrchestrationCard[] = [];
  const done: OrchestrationCard[] = [];
  for (const card of cards) {
    switch (card.position.kind) {
      case "todo":
        todo.push(card);
        break;
      case "step":
        inFlight.push(card);
        break;
      case "done":
        done.push(card);
        break;
    }
  }
  inFlight.sort((left, right) => (right.releasedAt ?? "").localeCompare(left.releasedAt ?? ""));
  return { todo, inFlight, done };
}

/**
 * How many segments a card's position track has. A released card is measured
 * against its own snapshot — board edits must not restripe in-flight rows.
 */
export function cardStepCount(card: OrchestrationCard, board: OrchestrationBoard): number {
  return card.snapshot?.steps.length ?? board.steps.length;
}

/** Step names for a card's track, taken from its snapshot once released. */
export function cardStepNames(
  card: OrchestrationCard,
  board: OrchestrationBoard,
): ReadonlyArray<string> {
  return (card.snapshot?.steps ?? board.steps).map((step) => step.name);
}

// ── Card detail selectors ──────────────────────────────────────

/** The one card a detail route addresses; archived cards still resolve. */
export function selectCard(
  cards: ReadonlyArray<OrchestrationCard>,
  cardId: CardId,
): OrchestrationCard | null {
  return cards.find((card) => card.id === cardId) ?? null;
}

/** Where a card sits, as a step index — null while in To-Do or Done. */
export function cardCurrentStepIndex(card: OrchestrationCard): number | null {
  return card.position.kind === "step" ? card.position.stepIndex : null;
}

/**
 * The thread spawned for a step. Retry replaces the thread, so the newest
 * entry for the index wins.
 */
export function cardStepThreadId(card: OrchestrationCard, stepIndex: number): ThreadId | null {
  let latest: OrchestrationCard["stepThreads"][number] | null = null;
  for (const entry of card.stepThreads) {
    if (entry.stepIndex !== stepIndex) continue;
    if (latest === null || entry.spawnedAt.localeCompare(latest.spawnedAt) >= 0) {
      latest = entry;
    }
  }
  return latest?.threadId ?? null;
}

/** The thread whose composer owns the card — the step the card sits in. */
export function cardCurrentThreadId(card: OrchestrationCard): ThreadId | null {
  const stepIndex = cardCurrentStepIndex(card);
  return stepIndex === null ? null : cardStepThreadId(card, stepIndex);
}

export type CardStepState = "complete" | "current" | "pending";

export interface CardStepView {
  readonly stepIndex: number;
  readonly name: string;
  readonly continuation: BoardStepContinuation;
  readonly threadId: ThreadId | null;
  readonly state: CardStepState;
}

/**
 * The card tree's top-level rows: the card's own pipeline (its snapshot once
 * released), each step carrying the thread it spawned and where it stands.
 */
export function selectCardSteps(
  card: OrchestrationCard,
  board: OrchestrationBoard,
): ReadonlyArray<CardStepView> {
  const steps = card.snapshot?.steps ?? board.steps;
  const current = cardCurrentStepIndex(card);
  return steps.map((step, stepIndex) => ({
    stepIndex,
    name: step.name,
    continuation: step.continuation,
    threadId: cardStepThreadId(card, stepIndex),
    state:
      card.position.kind === "done" || (current !== null && stepIndex < current)
        ? "complete"
        : stepIndex === current
          ? "current"
          : "pending",
  }));
}

/** Minimal thread shape the tree needs — keeps the selector app-agnostic. */
export interface ThreadParentRef {
  readonly id: ThreadId;
  readonly parentThreadId?: ThreadId | null;
  readonly createdAt?: string;
}

/**
 * Sub-agent threads of a step thread, oldest first. Nesting is the existing
 * `parentThreadId` edge; the board adds no delegation machinery of its own.
 */
export function selectSubAgentThreads<T extends ThreadParentRef>(
  threads: ReadonlyArray<T>,
  parentThreadId: ThreadId | null,
): ReadonlyArray<T> {
  if (parentThreadId === null) {
    return [];
  }
  const matches = threads.filter((thread) => (thread.parentThreadId ?? null) === parentThreadId);
  return matches.sort((left, right) => (left.createdAt ?? "").localeCompare(right.createdAt ?? ""));
}

/**
 * Display name of a step's artifact file. Mirrors the server's path sanitizer
 * (`sanitizeBoardStepName`) for labelling only — the RPCs address artifacts by
 * step name, never by the name shown here.
 */
export function boardArtifactFileName(stepName: string): string {
  const sanitized = stepName
    .trim()
    .replace(/[^a-zA-Z0-9._\-\s]/g, "_")
    .replace(/\s+/g, "-");
  return sanitized === "" ? "artifact.md" : `${sanitized}.md`;
}

export interface CardArtifactReader {
  readonly stepIndex: number;
  readonly stepName: string;
  /** How the reading step names it: `${artifact}` or `${artifact:Plan}`. */
  readonly placeholder: string;
}

export interface CardArtifactProvenance {
  readonly writtenBy: { readonly stepIndex: number; readonly stepName: string };
  readonly readBy: ReadonlyArray<CardArtifactReader>;
}

/**
 * Who wrote an artifact and which later steps consume it, read straight off the
 * card's templates: `${artifact}` binds to the immediately preceding step,
 * `${artifact:<step>}` to any earlier one. Nothing is injected implicitly, so
 * the templates are the whole truth.
 */
export function cardArtifactProvenance(
  card: OrchestrationCard,
  board: OrchestrationBoard,
  stepIndex: number,
): CardArtifactProvenance | null {
  const steps = card.snapshot?.steps ?? board.steps;
  const source = steps[stepIndex];
  if (source === undefined) {
    return null;
  }
  const readBy: CardArtifactReader[] = [];
  steps.forEach((step, index) => {
    if (index <= stepIndex) return;
    for (const placeholder of extractBoardTemplatePlaceholders(step.promptTemplate)) {
      if (placeholder.kind === "artifact-previous" && index === stepIndex + 1) {
        readBy.push({ stepIndex: index, stepName: step.name, placeholder: "${artifact}" });
      }
      if (placeholder.kind === "artifact-step" && placeholder.stepName === source.name) {
        readBy.push({
          stepIndex: index,
          stepName: step.name,
          placeholder: `\${artifact:${source.name}}`,
        });
      }
    }
  });
  return { writtenBy: { stepIndex, stepName: source.name }, readBy };
}

const NEEDS_YOU_STATUSES: ReadonlySet<CardStatus> = new Set<CardStatus>(["needs-input", "paused"]);

/** Cards waiting on the user — `needs-input` and `paused` count the same. */
export function countCardsNeedingYou(cards: ReadonlyArray<OrchestrationCard>): number {
  return cards.filter(
    (card) =>
      card.position.kind === "step" && card.status !== null && NEEDS_YOU_STATUSES.has(card.status),
  ).length;
}

export interface CardActionAvailability {
  /** Interrupt the running turn. */
  readonly canCancel: boolean;
  /** Discard the step thread and spawn a fresh one from the same template. */
  readonly canRetry: boolean;
  /** Mark the step done and advance — the manual gate and the flagged override. */
  readonly canContinue: boolean;
}

const CONTINUABLE_STATUSES: ReadonlySet<CardStatus> = new Set<CardStatus>(
  CONTINUABLE_CARD_STATUSES,
);

/**
 * Which recovery actions a card offers. Only in-flight cards have any: To-Do
 * cards start, Done cards archive.
 */
export function cardActionAvailability(card: OrchestrationCard): CardActionAvailability {
  if (card.position.kind !== "step") {
    return { canCancel: false, canRetry: false, canContinue: false };
  }
  const flagged = card.status !== null && CONTINUABLE_STATUSES.has(card.status);
  return {
    canCancel: card.status === "running",
    // Retry while a turn runs would put two agents in one worktree — the
    // decider rejects it too; Cancel first is the running-card path.
    canRetry: flagged,
    canContinue: flagged,
  };
}

// ── Atoms ──────────────────────────────────────────────────────

export function createEnvironmentBoardAtoms(input: {
  readonly snapshotAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<OrchestrationShellSnapshot | null>;
}) {
  const environmentBoardsAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make(
      (get): ReadonlyArray<OrchestrationBoard> =>
        get(input.snapshotAtom(environmentId))?.boards ?? EMPTY_BOARDS,
    ).pipe(Atom.withLabel(`environment-boards:${environmentId}`)),
  );

  const environmentCardsAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make(
      (get): ReadonlyArray<OrchestrationCard> =>
        get(input.snapshotAtom(environmentId))?.cards ?? EMPTY_CARDS,
    ).pipe(Atom.withLabel(`environment-cards:${environmentId}`)),
  );

  const projectBoardsAtomFamily = Atom.family((key: string) => {
    const ref = parseProjectKey(key);
    let previous: ReadonlyArray<OrchestrationBoard> = EMPTY_BOARDS;
    return Atom.make((get) => {
      const next = selectProjectBoards(
        get(environmentBoardsAtom(ref.environmentId)),
        ref.projectId,
      );
      if (arrayElementsEqual(previous, next)) {
        return previous;
      }
      previous = next;
      return next;
    }).pipe(Atom.withLabel(`project-boards:${key}`));
  });

  const projectBoardAtomFamily = Atom.family((key: string) =>
    Atom.make(
      (get): OrchestrationBoard | null => get(projectBoardsAtomFamily(key))[0] ?? null,
    ).pipe(Atom.withLabel(`project-board:${key}`)),
  );

  const projectCardsAtomFamily = Atom.family((key: string) => {
    const ref = parseProjectKey(key);
    let previous: ReadonlyArray<OrchestrationCard> = EMPTY_CARDS;
    return Atom.make((get) => {
      const board = get(projectBoardAtomFamily(key));
      const next =
        board === null
          ? EMPTY_CARDS
          : selectBoardCards(get(environmentCardsAtom(ref.environmentId)), board.id);
      if (arrayElementsEqual(previous, next)) {
        return previous;
      }
      previous = next;
      return next;
    }).pipe(Atom.withLabel(`project-board-cards:${key}`));
  });

  const projectCardSectionsAtomFamily = Atom.family((key: string) =>
    Atom.make((get): BoardCardSections => groupBoardCards(get(projectCardsAtomFamily(key)))).pipe(
      Atom.withLabel(`project-board-card-sections:${key}`),
    ),
  );

  return {
    environmentBoardsAtom,
    environmentCardsAtom,
    projectBoardsAtom: (ref: ScopedProjectRef) => projectBoardsAtomFamily(projectKey(ref)),
    projectBoardAtom: (ref: ScopedProjectRef) => projectBoardAtomFamily(projectKey(ref)),
    projectCardsAtom: (ref: ScopedProjectRef) => projectCardsAtomFamily(projectKey(ref)),
    projectCardSectionsAtom: (ref: ScopedProjectRef) =>
      projectCardSectionsAtomFamily(projectKey(ref)),
  };
}

// ── Command atoms ──────────────────────────────────────────────

export function createBoardEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Crypto.Crypto | R, E>,
) {
  const boardScheduler = createAtomCommandScheduler();
  const cardScheduler = createAtomCommandScheduler();
  const boardConcurrency = {
    mode: "serial" as const,
    key: ({ environmentId, input }: { environmentId: string; input: { boardId: string } }) =>
      JSON.stringify([environmentId, input.boardId]),
  };
  const cardConcurrency = {
    mode: "serial" as const,
    key: ({ environmentId, input }: { environmentId: string; input: { cardId: string } }) =>
      JSON.stringify([environmentId, input.cardId]),
  };
  return {
    createBoard: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:board:create",
      execute: (input: CreateBoardInput) => createBoard(input),
      scheduler: boardScheduler,
      concurrency: boardConcurrency,
    }),
    updateBoard: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:board:update",
      execute: (input: UpdateBoardInput) => updateBoard(input),
      scheduler: boardScheduler,
      concurrency: boardConcurrency,
    }),
    deleteBoard: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:board:delete",
      execute: (input: DeleteBoardInput) => deleteBoard(input),
      scheduler: boardScheduler,
      concurrency: boardConcurrency,
    }),
    createCard: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:card:create",
      execute: (input: CreateCardInput) => createCard(input),
      scheduler: cardScheduler,
      concurrency: cardConcurrency,
    }),
    releaseCard: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:card:release",
      execute: (input: ReleaseCardInput) => releaseCard(input),
      scheduler: cardScheduler,
      concurrency: cardConcurrency,
    }),
    continueCard: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:card:continue",
      execute: (input: ContinueCardInput) => continueCard(input),
      scheduler: cardScheduler,
      concurrency: cardConcurrency,
    }),
    retryCard: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:card:retry",
      execute: (input: RetryCardInput) => retryCard(input),
      scheduler: cardScheduler,
      concurrency: cardConcurrency,
    }),
    cancelCard: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:card:cancel",
      execute: (input: CancelCardInput) => cancelCard(input),
      scheduler: cardScheduler,
      concurrency: cardConcurrency,
    }),
    archiveCard: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:card:archive",
      execute: (input: ArchiveCardInput) => archiveCard(input),
      scheduler: cardScheduler,
      concurrency: cardConcurrency,
    }),
    /**
     * Artifact writes are serialized per card+step: the inline editor debounces
     * keystrokes, and out-of-order writes would resurrect stale text on disk.
     */
    writeArtifact: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:board:write-artifact",
      tag: BOARD_WS_METHODS.writeArtifact,
      concurrency: {
        mode: "serial" as const,
        key: ({
          environmentId,
          input,
        }: {
          environmentId: string;
          input: { cardId: string; stepName: string };
        }) => JSON.stringify([environmentId, input.cardId, input.stepName]),
      },
    }),
  };
}

/** Artifact file behind a step, read from the state dir over the board RPC. */
export function createBoardArtifactAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    artifact: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:board:read-artifact",
      tag: BOARD_WS_METHODS.readArtifact,
    }),
  };
}
