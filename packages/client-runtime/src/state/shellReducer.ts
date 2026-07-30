import * as Arr from "effect/Array";
import type { OrchestrationShellSnapshot, OrchestrationShellStreamEvent } from "@t3tools/contracts";

/**
 * Reduce a single shell stream event into an existing snapshot, returning a new
 * snapshot with the event's changes applied. This is a pure reducer that both
 * web and mobile can use to keep their local shell snapshot in sync.
 *
 * Returns the original snapshot reference unchanged if the event is not
 * recognized (forward-compatible).
 */
export function applyShellStreamEvent(
  snapshot: OrchestrationShellSnapshot,
  event: OrchestrationShellStreamEvent,
): OrchestrationShellSnapshot {
  if (event.sequence <= snapshot.snapshotSequence) return snapshot;

  switch (event.kind) {
    case "project-upserted": {
      const projects = snapshot.projects.some((p) => p.id === event.project.id)
        ? Arr.map(snapshot.projects, (p) => (p.id === event.project.id ? event.project : p))
        : Arr.append(snapshot.projects, event.project);
      return { ...snapshot, projects, snapshotSequence: event.sequence };
    }
    case "project-removed":
      return {
        ...snapshot,
        projects: Arr.filter(snapshot.projects, (p) => p.id !== event.projectId),
        snapshotSequence: event.sequence,
      };
    case "thread-upserted": {
      const threads = snapshot.threads.some((t) => t.id === event.thread.id)
        ? Arr.map(snapshot.threads, (t) => (t.id === event.thread.id ? event.thread : t))
        : Arr.append(snapshot.threads, event.thread);
      return { ...snapshot, threads, snapshotSequence: event.sequence };
    }
    case "thread-removed":
      return {
        ...snapshot,
        threads: Arr.filter(snapshot.threads, (t) => t.id !== event.threadId),
        snapshotSequence: event.sequence,
      };
    case "board-upserted": {
      const boards = snapshot.boards.some((b) => b.id === event.board.id)
        ? Arr.map(snapshot.boards, (b) => (b.id === event.board.id ? event.board : b))
        : Arr.append(snapshot.boards, event.board);
      return { ...snapshot, boards, snapshotSequence: event.sequence };
    }
    case "board-removed":
      return {
        ...snapshot,
        boards: Arr.filter(snapshot.boards, (b) => b.id !== event.boardId),
        // Cards are left alone: the server owns their lifecycle and emits its
        // own card-removed events. Board selectors scope cards by board id, so
        // any card whose board is gone is already invisible.
        snapshotSequence: event.sequence,
      };
    case "card-upserted": {
      const cards = snapshot.cards.some((c) => c.id === event.card.id)
        ? Arr.map(snapshot.cards, (c) => (c.id === event.card.id ? event.card : c))
        : Arr.append(snapshot.cards, event.card);
      return { ...snapshot, cards, snapshotSequence: event.sequence };
    }
    case "card-removed":
      return {
        ...snapshot,
        cards: Arr.filter(snapshot.cards, (c) => c.id !== event.cardId),
        snapshotSequence: event.sequence,
      };
    default:
      return snapshot;
  }
}
