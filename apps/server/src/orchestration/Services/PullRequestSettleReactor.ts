/**
 * PullRequestSettleReactor - Change-request settlement reactor service interface.
 *
 * @module PullRequestSettleReactor
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface PullRequestSettleReactorShape {
  /**
   * Start observing remote VCS status changes.
   *
   * The returned effect must be run in a scope so the subscription fiber is
   * finalized on shutdown.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  /**
   * Resolves when the internal processing queue is empty and idle.
   * Intended for deterministic tests.
   */
  readonly drain: Effect.Effect<void>;
}

export class PullRequestSettleReactor extends Context.Service<
  PullRequestSettleReactor,
  PullRequestSettleReactorShape
>()("aqqua/orchestration/Services/PullRequestSettleReactor") {}
