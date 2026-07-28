import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
} from "@t3tools/client-runtime/state/runtime";
import type * as Cause from "effect/Cause";

/**
 * The failed write, narrowed to what a caller needs to describe it. Keeping the
 * command's own type parameters out of the callback keeps the coordinator
 * assignable to `FileSaveCoordinator<unknown, unknown>`.
 */
export interface FileSaveFailure {
  readonly cause: Cause.Cause<unknown>;
}

/** Consecutive failed writes tolerated before the failure is surfaced. */
const MAX_SAVE_ATTEMPTS = 3;
/** First retry delay; each further retry doubles it. */
const SAVE_RETRY_BASE_MS = 400;

export interface FileSaveCoordinatorOptions<A, E> {
  readonly debounceMs: number;
  readonly persist: (contents: string) => Promise<AtomCommandResult<A, E>>;
  readonly onPendingChange: (pending: boolean) => void;
  readonly onConfirmed: (contents: string) => void;
  /**
   * Called once the bounded retries are exhausted. The contents stay dirty and
   * pending, so the caller should tell the user rather than quietly move on.
   */
  readonly onError: (failure: FileSaveFailure) => void;
}

export class FileSaveCoordinator<A = unknown, E = unknown> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private latestContents = "";
  private latestRevision = 0;
  private lastChangeAt = 0;
  private saving = false;
  private disposed = false;
  private flushRequested = false;
  /** Reset only by a successful write, so an outage cannot hide behind edits. */
  private consecutiveFailures = 0;
  private reportedFailure = false;

  constructor(private readonly options: FileSaveCoordinatorOptions<A, E>) {}

  change(contents: string): void {
    this.latestContents = contents;
    this.latestRevision += 1;
    this.lastChangeAt = Date.now();
    this.options.onPendingChange(true);
    this.schedule(this.options.debounceMs);
  }

  /**
   * Writes the buffered contents now instead of waiting out the debounce, for
   * an explicit save. A no-op when nothing is buffered; when a write is already
   * in flight the follow-up write skips the remaining debounce too.
   */
  flush(): void {
    if (this.latestRevision === 0) return;
    // An explicit save is the user retrying by hand, so let it past the bound.
    this.consecutiveFailures = 0;
    this.reportedFailure = false;
    if (this.saving) {
      this.flushRequested = true;
      return;
    }
    this.clearTimer();
    void this.persistLatest();
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    if (this.latestRevision > 0) void this.persistLatest();
  }

  private schedule(delay: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.persistLatest();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private async persistLatest(): Promise<void> {
    if (this.saving || this.latestRevision === 0) return;

    this.saving = true;
    const contents = this.latestContents;
    const revision = this.latestRevision;
    const result = await this.options.persist(contents);
    const succeeded = result._tag === "Success";
    if (succeeded) {
      this.consecutiveFailures = 0;
      this.reportedFailure = false;
      this.options.onConfirmed(contents);
    }

    this.saving = false;
    const flushed = this.flushRequested;
    this.flushRequested = false;

    if (!succeeded) {
      // Deliberately before the revision check: the contents are still dirty
      // whether or not a newer edit landed, so pending stays true either way
      // and the next attempt picks up whatever is newest.
      this.handleFailure(result);
      return;
    }

    if (revision === this.latestRevision) {
      this.options.onPendingChange(false);
      return;
    }

    const remainingDebounce = flushed
      ? 0
      : Math.max(0, this.options.debounceMs - (Date.now() - this.lastChangeAt));
    if (this.disposed) {
      void this.persistLatest();
    } else {
      this.schedule(remainingDebounce);
    }
  }

  private handleFailure(result: AtomCommandResult<A, E>): void {
    if (result._tag !== "Failure") return;
    // A torn-down atom is not a write that failed — `dispose` re-drives the
    // write itself, and reporting here would toast on every navigation.
    if (isAtomCommandInterrupted(result)) return;

    this.consecutiveFailures += 1;

    // After `dispose` there is no component left to retry on behalf of, and a
    // timer would outlive it, so the failure is reported straight away.
    if (this.disposed || this.consecutiveFailures >= MAX_SAVE_ATTEMPTS) {
      this.report(result);
      return;
    }

    this.schedule(SAVE_RETRY_BASE_MS * 2 ** (this.consecutiveFailures - 1));
  }

  private report(failure: FileSaveFailure): void {
    if (this.reportedFailure) return;
    this.reportedFailure = true;
    this.options.onError(failure);
  }
}
