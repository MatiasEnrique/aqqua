/**
 * orphanedSessions - Close out provider sessions the projection still believes
 * are live after the process that owned them is gone.
 *
 * Provider sessions run as child processes of the server, so anything that ends
 * the server — a dev-mode reload, a crash, a quit mid-turn — kills them without
 * a `turn.completed` or `session.exited` ever reaching the orchestration
 * projection. The thread row keeps `status: "running"` and its `activeTurnId`
 * forever, which the UI renders as a permanently working agent, and
 * `ProviderSessionReaper` cannot help: it skips bindings already marked
 * `stopped` and skips threads holding an active turn.
 *
 * A stale projection row is not proof on its own, though. More than one server
 * can point at the same state directory (a packaged app and a dev server both
 * homed at `~/.t3`), so "the projection says running" must be corroborated by
 * the provider directory before anything is closed. The shutdown path stamps
 * every binding `stopped`, so a binding still claiming its thread means some
 * process may yet own that session — those are left alone rather than pulled
 * out from under a server that is still running.
 *
 * The trade-off is deliberate: a server killed outright (SIGKILL, power loss)
 * never runs that shutdown stamp, so its bindings stay claimed and its threads
 * stay stuck. Closing that case safely needs an owner id on the binding, not a
 * status guess.
 *
 * @module orphanedSessions
 */
import type { OrchestrationSession, ThreadId } from "@t3tools/contracts";

/** Surfaced on the thread so a turn that died with the server explains itself
    instead of just going quiet. */
export const ORPHANED_SESSION_DETAIL =
  "The T3 Code server restarted while this turn was running, so the provider session was lost. Send a message to pick the thread back up.";

/** Statuses that claim a live provider process. `ready` and `interrupted` do not
    outlive the process either, but they already render as settled and recover
    through the normal session-recovery path on the next turn; only these two
    strand a thread in a working state that nothing else ever clears. */
const ORPHANED_SESSION_STATUSES: ReadonlySet<OrchestrationSession["status"]> = new Set([
  "starting",
  "running",
]);

export interface OrphanedSessionCandidate {
  readonly id: ThreadId;
  readonly session: OrchestrationSession | null;
}

export interface OrphanedSession {
  readonly threadId: ThreadId;
  readonly session: OrchestrationSession;
}

export interface SelectOrphanedSessionsInput {
  /** Thread shells from the projection, as persisted by the previous process. */
  readonly threads: ReadonlyArray<OrphanedSessionCandidate>;
  /**
   * Threads whose provider binding is still claimed — anything the directory
   * does not report as `stopped`. A claim may belong to a server that is still
   * running, so these are never closed from here.
   */
  readonly claimedThreadIds: ReadonlySet<string>;
  readonly stoppedAt: string;
}

/**
 * Rewrite every stranded session to `stopped`, dropping the active turn no
 * provider will ever complete. Threads that are already settled, or whose
 * binding is still claimed, are left alone — so a boot with nothing stranded
 * produces no commands at all.
 */
export function selectOrphanedSessions(
  input: SelectOrphanedSessionsInput,
): ReadonlyArray<OrphanedSession> {
  const orphaned: OrphanedSession[] = [];
  for (const thread of input.threads) {
    const session = thread.session;
    if (session === null || !ORPHANED_SESSION_STATUSES.has(session.status)) {
      continue;
    }
    if (input.claimedThreadIds.has(thread.id)) {
      continue;
    }
    orphaned.push({
      threadId: thread.id,
      session: {
        ...session,
        status: "stopped",
        activeTurnId: null,
        lastError: ORPHANED_SESSION_DETAIL,
        updatedAt: input.stoppedAt,
      },
    });
  }
  return orphaned;
}

/**
 * Thread ids whose provider binding still claims ownership. Bindings the
 * directory reports as `stopped` were released by a clean shutdown and are
 * therefore safe to reconcile.
 */
export function claimedThreadIdsFromBindings(
  bindings: ReadonlyArray<{ readonly threadId: ThreadId; readonly status?: string | undefined }>,
): ReadonlySet<string> {
  const claimed = new Set<string>();
  for (const binding of bindings) {
    if (binding.status !== "stopped") {
      claimed.add(binding.threadId);
    }
  }
  return claimed;
}
