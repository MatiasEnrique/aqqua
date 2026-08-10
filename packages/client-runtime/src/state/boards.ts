import type {
  BoardId,
  BoardStepContinuation,
  CardId,
  CardStatus,
  CardOperationKind as ContractCardOperationKind,
  OrchestrationBoard,
  OrchestrationCard,
  OrchestrationShellSnapshot,
  ProjectId,
  ScopedProjectRef,
  ThreadId,
} from "@aqqua/contracts";
import { BOARD_WS_METHODS, CONTINUABLE_CARD_STATUSES, EnvironmentId } from "@aqqua/contracts";
import { extractBoardTemplatePlaceholders } from "@aqqua/shared/boardTemplate";
import type * as Crypto from "effect/Crypto";
import { Atom } from "effect/unstable/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  type ArchiveCardInput,
  archiveCard,
  type ContinueCardInput,
  type CreateBoardInput,
  type CreateCardInput,
  continueCard,
  createBoard,
  createCard,
  type DeleteBoardInput,
  type DeleteCardInput,
  deleteBoard,
  deleteCard,
  type ForceAdvanceCardInput,
  forceAdvanceCard,
  type ReleaseCardInput,
  type ResetCardInput,
  type RetryCardInput,
  releaseCard,
  resetCard,
  retryCard,
  type SettleCardInput,
  settleCard,
  type UnsettleCardInput,
  type UnarchiveCardInput,
  unarchiveCard,
  type UpdateBoardInput,
  unsettleCard,
  updateBoard,
} from "../operations/commands.ts";
import { arrayElementsEqual, parseProjectKey, projectKey } from "./entities.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentCommand,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

export type {
  ArchiveCardInput,
  ContinueCardInput,
  CreateBoardInput,
  CreateCardInput,
  DeleteBoardInput,
  DeleteCardInput,
  ForceAdvanceCardInput,
  ReleaseCardInput,
  ResetCardInput,
  RetryCardInput,
  SettleCardInput,
  UnarchiveCardInput,
  UnsettleCardInput,
  UpdateBoardInput,
} from "../operations/commands.ts";

const EMPTY_BOARDS: ReadonlyArray<OrchestrationBoard> = Object.freeze([]);
const EMPTY_CARDS: ReadonlyArray<OrchestrationCard> = Object.freeze([]);
const EMPTY_CARDS_BY_ENVIRONMENT: ReadonlyMap<
  EnvironmentId,
  ReadonlyArray<OrchestrationCard>
> = new Map();

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

/** Unarchived cards from every live board in a project, oldest first. */
export function selectProjectCards(
  cards: ReadonlyArray<OrchestrationCard>,
  boards: ReadonlyArray<OrchestrationBoard>,
): ReadonlyArray<OrchestrationCard> {
  if (boards.length === 0) return EMPTY_CARDS;
  const boardIds = new Set(boards.map((board) => board.id as string));
  const matches = cards.filter(
    (card) => boardIds.has(card.boardId as string) && card.archivedAt === null,
  );
  if (matches.length === 0) return EMPTY_CARDS;
  return matches.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export interface BoardCardSections {
  /** Backlog: no worktree, no snapshot — the Start action lives here. */
  readonly todo: ReadonlyArray<OrchestrationCard>;
  /** Released and still inside the step pipeline. */
  readonly inFlight: ReadonlyArray<OrchestrationCard>;
  /** Finished the pipeline and still on the working board. */
  readonly done: ReadonlyArray<OrchestrationCard>;
  /** Done cards explicitly moved out of the working board. */
  readonly settled: ReadonlyArray<OrchestrationCard>;
  /**
   * Accepted for deletion and on their way out. Held apart from every normal
   * section so a card leaves the board the moment the server takes the
   * operation, rather than lingering until physical cleanup finishes.
   */
  readonly deleting: ReadonlyArray<OrchestrationCard>;
}

const EMPTY_SECTIONS: BoardCardSections = Object.freeze({
  todo: EMPTY_CARDS,
  inFlight: EMPTY_CARDS,
  done: EMPTY_CARDS,
  settled: EMPTY_CARDS,
  deleting: EMPTY_CARDS,
});

/**
 * Split a board's cards by position plus the settled lifecycle. In-flight rows
 * keep their release order (most recent first) so the active work reads top
 * down; To-Do and Done stay in creation order. A card being deleted is pulled
 * out of all of them; if its deletion fails the operation clears and the card
 * drops straight back into the section it came from.
 */
export function groupBoardCards(cards: ReadonlyArray<OrchestrationCard>): BoardCardSections {
  if (cards.length === 0) {
    return EMPTY_SECTIONS;
  }
  const todo: OrchestrationCard[] = [];
  const inFlight: OrchestrationCard[] = [];
  const done: OrchestrationCard[] = [];
  const settled: OrchestrationCard[] = [];
  const deleting: OrchestrationCard[] = [];
  for (const card of cards) {
    if (isCardDeleting(card)) {
      deleting.push(card);
      continue;
    }
    if (card.settledAt !== null) {
      settled.push(card);
      continue;
    }
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
  settled.sort((left, right) => (right.settledAt ?? "").localeCompare(left.settledAt ?? ""));
  return { todo, inFlight, done, settled, deleting };
}

const URGENT_STATUSES: ReadonlySet<CardStatus> = new Set<CardStatus>([
  "needs-input",
  "paused",
  "failed",
]);

/**
 * Where a route lands when the card it was showing leaves the board: the most
 * urgent card that is not the departing one, in the sidebar's own reading order
 * — flagged work, then active runs, then backlog, Done, and Settled history.
 * Cards being deleted are not in `sections` at all, so a freed route can never
 * bounce onto one that is itself on its way out.
 */
export function selectNextCardAfter(
  sections: BoardCardSections,
  departingCardId: CardId,
): CardId | null {
  const urgent = sections.inFlight.filter(
    (card) => card.status !== null && URGENT_STATUSES.has(card.status),
  );
  const active = sections.inFlight.filter(
    (card) => card.status === null || !URGENT_STATUSES.has(card.status),
  );
  const ordered = [...urgent, ...active, ...sections.todo, ...sections.done, ...sections.settled];
  return ordered.find((card) => card.id !== departingCardId)?.id ?? null;
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
  readonly parentThreadId?: ThreadId | null | undefined;
  readonly createdAt?: string | undefined;
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

function selectFlowStepRootThreadIds(cards: ReadonlyArray<OrchestrationCard>): ReadonlySet<string> {
  const roots = new Set<string>();
  for (const card of cards) {
    if (card.archivedAt !== null) continue;
    for (const entry of card.stepThreads) {
      roots.add(entry.threadId as string);
    }
  }
  return roots;
}

export interface FlowThreadOwnership {
  readonly isFlowOwned: (threadId: ThreadId) => boolean;
}

export function createFlowThreadOwnership(input: {
  readonly cards: ReadonlyArray<OrchestrationCard>;
  readonly threads: ReadonlyArray<ThreadParentRef>;
}): FlowThreadOwnership {
  const roots = selectFlowStepRootThreadIds(input.cards);
  const parentById = new Map<string, string | null>();
  for (const thread of input.threads) {
    parentById.set(thread.id as string, (thread.parentThreadId as string | null) ?? null);
  }
  const resolved = new Map<string, boolean>();

  const isFlowOwned = (threadId: ThreadId): boolean => {
    if (roots.size === 0) return false;
    const chain: string[] = [];
    const seen = new Set<string>();
    let cursor: string | null = threadId as string;
    let owned = false;
    while (cursor !== null && !seen.has(cursor)) {
      const cached = resolved.get(cursor);
      if (cached !== undefined) {
        owned = cached;
        break;
      }
      if (roots.has(cursor)) {
        owned = true;
        break;
      }
      seen.add(cursor);
      chain.push(cursor);
      cursor = parentById.get(cursor) ?? null;
    }
    for (const id of chain) {
      resolved.set(id, owned);
    }
    return owned;
  };

  return { isFlowOwned };
}

export function findFlowOwnedThread<T extends { readonly id: ThreadId }>(input: {
  readonly targets: ReadonlyArray<T>;
  readonly cards: ReadonlyArray<OrchestrationCard>;
  readonly threads: ReadonlyArray<ThreadParentRef>;
}): T | null {
  const ownership = createFlowThreadOwnership(input);
  return input.targets.find((target) => ownership.isFlowOwned(target.id)) ?? null;
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
        readBy.push({
          stepIndex: index,
          stepName: step.name,
          placeholder: `\${artifact}`,
        });
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

// ── Card operations ────────────────────────────────────────────

/**
 * What the server is doing to a card right now, as the durable `operation`
 * claim spells it. One vocabulary for badges, sidebar grouping, action
 * availability, and the detail composer, so a card never says "Deleting" in
 * one place and "Running" in another.
 */
export type CardOperationKind = ContractCardOperationKind;

/**
 * The operation a card is under, preferring the server's durable claim. Rows
 * projected before that column existed still have to read correctly: deletion
 * was a status then, and a released card with no step thread yet is starting.
 */
export function cardOperation(card: OrchestrationCard): CardOperationKind | null {
  if (card.operation !== null) return card.operation.kind;
  if (card.status === "deleting") return "deleting";
  return isCardStarting(card) ? "starting" : null;
}

/** True while a card is on its way off the board. */
export function isCardDeleting(card: OrchestrationCard): boolean {
  return cardOperation(card) === "deleting";
}

/**
 * Why the last operation failed, as the server persisted it. Survives a reload
 * — a deletion that failed while the tab was closed still explains itself.
 */
export function cardOperationFailure(card: OrchestrationCard): string | null {
  const trimmed = card.lastError?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/**
 * True from the moment Start is accepted until the first step thread exists:
 * release captured a snapshot (`card.release-requested`) but the card is still
 * in To-Do while the server creates the worktree, checks out the branch, and
 * launches the setup script. A failed release drops back out via `failed`.
 */
export function isCardStarting(card: OrchestrationCard): boolean {
  return card.position.kind === "todo" && card.snapshot !== null && card.status !== "failed";
}

/**
 * A card may be deleted once no release or turn can still mutate its owned
 * worktree. Any operation the server has claimed — not just a deletion — holds
 * the action: cleanup must not race work already under way, and the server
 * rejects it anyway. Running cards must be reset first. A deletion that failed
 * leaves the card stable and offers the action again.
 */
export function canDeleteCard(card: OrchestrationCard): boolean {
  if (card.archivedAt !== null) return false;
  // Subsumes the pre-operation reading of "starting" — `cardOperation` reports
  // a released-but-unstarted card as starting whether or not a claim exists.
  if (cardOperation(card) !== null) return false;
  switch (card.position.kind) {
    case "todo":
      return true;
    case "step":
      return card.status !== null && card.status !== "running";
    case "done":
      return true;
  }
}

const NEEDS_YOU_STATUSES: ReadonlySet<CardStatus> = new Set<CardStatus>(["needs-input", "paused"]);

/** Cards waiting on the user — `needs-input` and `paused` count the same. */
export function countCardsNeedingYou(cards: ReadonlyArray<OrchestrationCard>): number {
  return cards.filter(
    (card) =>
      card.position.kind === "step" &&
      card.status !== null &&
      NEEDS_YOU_STATUSES.has(card.status) &&
      !isCardDeleting(card),
  ).length;
}

export interface CardActionAvailability {
  /** The operation already in flight, if any — every action waits on it. */
  readonly operation: CardOperationKind | null;
  /** Reset the whole released card to To-Do; an active turn is interrupted. */
  readonly canReset: boolean;
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
 * cards start, while Done cards settle or delete through separate actions.
 * An operation the server is already running suspends all of them — it is the
 * authority, and a second submission would only be rejected.
 */
export function cardActionAvailability(card: OrchestrationCard): CardActionAvailability {
  const operation = cardOperation(card);
  if (card.position.kind !== "step" || operation !== null) {
    return { operation, canReset: false, canRetry: false, canContinue: false };
  }
  const flagged = card.status !== null && CONTINUABLE_STATUSES.has(card.status);
  return {
    operation,
    canReset: true,
    // Retry while a turn runs would put two agents in one worktree — the
    // decider rejects it too; full-card Cancel is the running-card path.
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

  const environmentsBoardsAtomFamily = Atom.family((key: string) => {
    const environmentIds = (JSON.parse(key) as ReadonlyArray<string>).map((id) =>
      EnvironmentId.make(id),
    );
    let previous: ReadonlyArray<OrchestrationBoard> = EMPTY_BOARDS;
    return Atom.make((get) => {
      const next = environmentIds.flatMap((environmentId) =>
        get(environmentBoardsAtom(environmentId)),
      );
      if (arrayElementsEqual(previous, next)) return previous;
      previous = next;
      return next;
    }).pipe(Atom.withLabel(`environment-boards-many:${key}`));
  });

  const environmentsCardsAtomFamily = Atom.family((key: string) => {
    const environmentIds = (JSON.parse(key) as ReadonlyArray<string>).map((id) =>
      EnvironmentId.make(id),
    );
    let previous: ReadonlyMap<
      EnvironmentId,
      ReadonlyArray<OrchestrationCard>
    > = EMPTY_CARDS_BY_ENVIRONMENT;
    return Atom.make((get) => {
      const next = new Map<EnvironmentId, ReadonlyArray<OrchestrationCard>>();
      for (const environmentId of environmentIds) {
        next.set(environmentId, get(environmentCardsAtom(environmentId)));
      }
      const unchanged =
        previous.size === next.size &&
        [...next].every(([environmentId, cards]) => previous.get(environmentId) === cards);
      if (unchanged) return previous;
      previous = next;
      return next;
    }).pipe(Atom.withLabel(`environment-cards-many:${key}`));
  });

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
      const next = selectProjectCards(
        get(environmentCardsAtom(ref.environmentId)),
        get(projectBoardsAtomFamily(key)),
      );
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
    environmentsBoardsAtom: (environmentIds: ReadonlyArray<EnvironmentId>) =>
      environmentsBoardsAtomFamily(JSON.stringify(environmentIds)),
    environmentCardsAtom,
    environmentsCardsAtom: (environmentIds: ReadonlyArray<EnvironmentId>) =>
      environmentsCardsAtomFamily(JSON.stringify(environmentIds)),
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
    forceAdvanceCard: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:card:force-advance",
      execute: (input: ForceAdvanceCardInput) => forceAdvanceCard(input),
      scheduler: cardScheduler,
      concurrency: cardConcurrency,
    }),
    retryCard: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:card:retry",
      execute: (input: RetryCardInput) => retryCard(input),
      scheduler: cardScheduler,
      concurrency: cardConcurrency,
    }),
    resetCard: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:card:reset",
      execute: (input: ResetCardInput) => resetCard(input),
      scheduler: cardScheduler,
      concurrency: cardConcurrency,
    }),
    settleCard: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:card:settle",
      execute: (input: SettleCardInput) => settleCard(input),
      scheduler: cardScheduler,
      concurrency: cardConcurrency,
    }),
    unsettleCard: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:card:unsettle",
      execute: (input: UnsettleCardInput) => unsettleCard(input),
      scheduler: cardScheduler,
      concurrency: cardConcurrency,
    }),
    archiveCard: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:card:archive",
      execute: (input: ArchiveCardInput) => archiveCard(input),
      scheduler: cardScheduler,
      concurrency: cardConcurrency,
    }),
    unarchiveCard: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:card:unarchive",
      execute: (input: UnarchiveCardInput) => unarchiveCard(input),
      scheduler: cardScheduler,
      concurrency: cardConcurrency,
    }),
    deleteCard: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:card:delete",
      execute: (input: DeleteCardInput) => deleteCard(input),
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
