/**
 * AgentControl - orchestrator → sub-agent delegation.
 *
 * One interface behind which the whole delegation mechanism lives: profile
 * resolution, child thread creation, workspace binding, fresh-versus-continued
 * context, orchestration command dispatch, completion waiting, final-message
 * extraction, cancellation, the per-parent concurrency cap, recursion
 * prevention, and lifecycle activity emission.
 *
 * Callers see thread ids, role names, statuses, and messages. They never see
 * provider instance ids, MCP credentials, worktree paths, terminal pids, or
 * orchestration command shapes — front-ends (the `aqqua agent` CLI, and optionally
 * an MCP toolkit) hand these values to a model, so the interface is also the
 * disclosure boundary.
 *
 * Delegated operations receive `parentThreadId` from the authenticated caller,
 * never from the model, so an orchestrator cannot impersonate another parent.
 * Standalone CLI spawn is separately authenticated and creates an unparented
 * thread from an explicit working directory.
 *
 * @module agent-control/Services/AgentControl
 */
import type { AgentProfileName, ThreadId } from "@aqqua/contracts";
import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import type * as Effect from "effect/Effect";

import type { AgentControlError } from "../Errors.ts";

/**
 * Outcome of a sub-agent's turn.
 *
 * `running` is not a failure: it is what `await` reports when its bound elapses
 * with the sub-agent still working, so a caller resumes by awaiting again rather
 * than losing the sub-agent.
 */
export type AgentRunStatus = "completed" | "failed" | "interrupted" | "running";

export interface AgentHandle {
  readonly threadId: ThreadId;
  readonly profile: AgentProfileName;
  /** Terminal bound to the sub-agent's workspace, when one was opened. */
  readonly terminalId: string | null;
}

export interface AgentRunResult {
  readonly threadId: ThreadId;
  readonly status: AgentRunStatus;
  /**
   * The sub-agent's closing message for this turn, never its full transcript.
   * `null` when the turn produced no assistant message (a crash, or an
   * interrupt before the first token).
   */
  readonly finalMessage: string | null;
  /** Orchestration sequence the result was observed at, for cursor resumption. */
  readonly sequence: number;
}

export interface AgentSummary {
  readonly threadId: ThreadId;
  readonly profile: AgentProfileName | null;
  readonly title: string;
  readonly status: AgentRunStatus;
  readonly updatedAt: string;
}

/**
 * A role name an orchestrator may spawn, with what it resolves to today.
 *
 * Resolution is reported rather than just the stored definition: a profile that
 * omits `model` inherits the project default, so the configured shape and the
 * model a spawn would actually use are different questions.
 */
export interface AgentProfileSummary {
  readonly name: AgentProfileName;
  readonly runtime: "session" | "terminal";
  readonly driver: string | null;
  readonly model: string | null;
  readonly pinsModel: boolean;
  readonly titlePrefix: string | null;
  /** `null` when the profile is ready to spawn; otherwise why it is not. */
  readonly unavailable: string | null;
}

export interface AgentControlShape {
  /**
   * Create a sub-agent thread under `parentThreadId` and start its first turn.
   *
   * Returns as soon as the sub-agent exists and its turn is requested — the
   * caller is not blocked while it works, and the sub-agent is already visible
   * and interactive in the sidebar.
   */
  readonly spawn: (input: {
    readonly parentThreadId: ThreadId;
    readonly profile: AgentProfileName;
    readonly task: string;
    readonly title?: string;
  }) => Effect.Effect<AgentHandle, AgentControlError>;

  /** Start an unparented agent in the project or worktree containing `cwd`. */
  readonly spawnStandalone: (input: {
    readonly cwd: string;
    readonly profile: AgentProfileName;
    readonly task: string;
    readonly title?: string;
  }) => Effect.Effect<AgentHandle, AgentControlError>;

  /** Continue a sub-agent this parent owns, preserving its context. */
  readonly send: (input: {
    readonly parentThreadId: ThreadId;
    readonly childThreadId: ThreadId;
    readonly message: string;
  }) => Effect.Effect<AgentHandle, AgentControlError>;

  /**
   * Block until the sub-agent's in-flight turn settles, or until `timeout`.
   *
   * Interruptible, and interrupting it leaves the sub-agent running.
   */
  readonly awaitTurn: (input: {
    readonly parentThreadId: ThreadId;
    readonly childThreadId: ThreadId;
    readonly timeout?: Duration.Duration;
  }) => Effect.Effect<AgentRunResult, AgentControlError>;

  readonly interrupt: (input: {
    readonly parentThreadId: ThreadId;
    readonly childThreadId: ThreadId;
  }) => Effect.Effect<void, AgentControlError>;

  readonly list: (input: {
    readonly parentThreadId: ThreadId;
  }) => Effect.Effect<ReadonlyArray<AgentSummary>, AgentControlError>;

  /**
   * Role names this parent may spawn, resolved against its own project.
   *
   * Exists so discovering the profiles is not done by spawning a wrong one and
   * reading the error: the names live in machine-local settings the orchestrator
   * cannot see.
   */
  readonly profiles: (input: {
    readonly parentThreadId: ThreadId;
  }) => Effect.Effect<ReadonlyArray<AgentProfileSummary>, AgentControlError>;
}

export class AgentControl extends Context.Service<AgentControl, AgentControlShape>()(
  "aqqua/agent-control/Services/AgentControl",
) {}
