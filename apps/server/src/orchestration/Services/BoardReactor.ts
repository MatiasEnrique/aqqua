/**
 * BoardReactor - Board card pipeline reaction service interface.
 *
 * Owns background workers that react to card release and step-advance domain
 * events and drive worktree creation + step thread spawning.
 *
 * @module BoardReactor
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

/**
 * BoardReactorShape - Service API for board reactor lifecycle.
 */
export interface BoardReactorShape {
  /**
   * Start the board reactor.
   *
   * The returned effect must be run in a scope so all worker fibers can be
   * finalized on shutdown.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  /**
   * Resolves when the internal processing queue is empty and idle.
   * Intended for test use to replace timing-sensitive sleeps.
   */
  readonly drain: Effect.Effect<void>;
}

/**
 * BoardReactor - Service tag for board reactor workers.
 */
export class BoardReactor extends Context.Service<BoardReactor, BoardReactorShape>()(
  "aqqua/orchestration/Services/BoardReactor",
) {}
