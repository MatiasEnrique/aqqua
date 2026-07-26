/**
 * AgentControl implementation.
 *
 * @module agent-control/Layers/AgentControl
 */
import {
  type AgentProfileName,
  CommandId,
  EventId,
  type IsoDateTime,
  MessageId,
  type OrchestrationEvent,
  type OrchestrationThread,
  type ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderAdapterRegistry } from "../../provider/Services/ProviderAdapterRegistry.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import * as TerminalManager from "../../terminal/Manager.ts";
import {
  AgentBusyError,
  AgentConcurrencyLimitError,
  type AgentControlError,
  AgentDispatchError,
  AgentLaunchFailedError,
  AgentNotOwnedError,
  AgentParentNotFoundError,
  AgentRecursionDeniedError,
  AgentTerminalRuntimeError,
} from "../Errors.ts";
import { type AgentInstanceCandidate, resolveAgentProfile } from "../Profiles.ts";
import {
  AgentControl,
  type AgentControlShape,
  type AgentHandle,
  type AgentRunResult,
  type AgentRunStatus,
  type AgentSummary,
} from "../Services/AgentControl.ts";
import {
  agentRunStatusFromSessionStatus,
  agentRunStatusFromThread,
  isSettledAgentRunStatus,
} from "../Status.ts";

/**
 * Live sub-agents allowed per orchestrator.
 *
 * Sub-agents share their orchestrator's worktree in this milestone, so this cap
 * is the primary defence against parallel writers clobbering each other. No
 * orchestration invariant enforces it, so it is enforced here before creation.
 */
export const MAX_LIVE_SUB_AGENTS_PER_PARENT = 3;

/**
 * Default bound on a single `awaitTurn` call.
 *
 * Deliberately below the 30-minute MCP credential idle timeout in
 * `McpSessionRegistry`: a blocking front-end that waited past it would find its
 * credential pruned on the next call. Elapsing returns `running`, so a longer
 * task is resumed by awaiting again rather than lost.
 */
export const DEFAULT_AWAIT_TURN_TIMEOUT = Duration.minutes(15);

/** Longest single wait a caller may request. */
export const MAX_AWAIT_TURN_TIMEOUT = Duration.minutes(25);

const MAX_FINAL_MESSAGE_CHARS = 16_000;

/**
 * Terminal a PTY-hosted sub-agent runs in.
 *
 * The thread's first terminal, so opening the sub-agent's thread in the desktop
 * app shows the running CLI without the user hunting for a tab.
 */
const DEFAULT_AGENT_TERMINAL_ID = "term-1";

const truncateFinalMessage = (text: string): string =>
  text.length <= MAX_FINAL_MESSAGE_CHARS
    ? text
    : `${text.slice(0, MAX_FINAL_MESSAGE_CHARS)}\n\n[truncated: the sub-agent's full transcript is in its thread]`;

/** First line of the task, used to title the sub-agent's thread. */
const deriveTitle = (titlePrefix: string, task: string): string => {
  const firstLine = task
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const summary = (firstLine ?? "task").replace(/^#+\s*/, "").slice(0, 60);
  return `${titlePrefix}: ${summary}`;
};

const isThreadSessionEvent = (
  event: OrchestrationEvent,
  threadId: ThreadId,
): event is Extract<OrchestrationEvent, { type: "thread.session-set" }> =>
  event.type === "thread.session-set" && event.aggregateId === threadId;

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const projection = yield* ProjectionSnapshotQuery;
  const registry = yield* ProviderAdapterRegistry;
  const settings = yield* ServerSettingsService;
  const terminals = yield* TerminalManager.TerminalManager;
  const crypto = yield* Crypto.Crypto;

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const uuid = crypto.randomUUIDv4.pipe(Effect.orDie);
  const commandId = (tag: string) =>
    uuid.pipe(Effect.map((value) => CommandId.make(`agent:${tag}:${value}`)));

  const dispatchFailure = (operation: string) => (cause: Cause.Cause<unknown>) =>
    Effect.fail(
      new AgentDispatchError({
        operation,
        detail: Cause.hasInterrupts(cause) ? "the operation was interrupted." : Cause.pretty(cause),
      }),
    );

  const dispatch = (
    operation: string,
    command: Parameters<typeof engine.dispatch>[0],
  ): Effect.Effect<{ readonly sequence: number }, AgentDispatchError> =>
    engine.dispatch(command).pipe(Effect.catchCause(dispatchFailure(operation)));

  const readThread = (
    operation: string,
    threadId: ThreadId,
  ): Effect.Effect<OrchestrationThread | null, AgentDispatchError> =>
    projection
      .getThreadDetailById(threadId)
      .pipe(Effect.map(Option.getOrNull), Effect.catchCause(dispatchFailure(operation)));

  /**
   * Resolve the orchestrator and refuse a sub-agent's attempt to delegate.
   *
   * Recursion is denied from the persisted `parentThreadId`, not from in-memory
   * state, so the rule still holds after a T3 restart.
   */
  const requireOrchestrator = Effect.fn("AgentControl.requireOrchestrator")(function* (
    parentThreadId: ThreadId,
  ) {
    const parent = yield* readThread("spawn", parentThreadId);
    if (!parent || parent.deletedAt !== null || parent.archivedAt !== null) {
      return yield* new AgentParentNotFoundError({ parentThreadId });
    }
    if ((parent.parentThreadId ?? null) !== null) {
      return yield* new AgentRecursionDeniedError({ parentThreadId });
    }
    return parent;
  });

  const requireOwnedSubAgent = Effect.fn("AgentControl.requireOwnedSubAgent")(function* (input: {
    readonly operation: string;
    readonly parentThreadId: ThreadId;
    readonly childThreadId: ThreadId;
  }) {
    const child = yield* readThread(input.operation, input.childThreadId);
    if (
      !child ||
      child.deletedAt !== null ||
      (child.parentThreadId ?? null) !== input.parentThreadId
    ) {
      return yield* new AgentNotOwnedError({
        parentThreadId: input.parentThreadId,
        childThreadId: input.childThreadId,
      });
    }
    return child;
  });

  /**
   * How a sub-agent is hosted, read from the durable link activity written at
   * spawn time.
   *
   * A PTY-hosted sub-agent has no provider session, so operations that wait on one
   * must refuse rather than wait forever.
   */
  const subAgentRuntime = (thread: OrchestrationThread): "session" | "terminal" => {
    const linked = thread.activities.find((activity) => activity.kind === "agent.parent.linked");
    const payload =
      typeof linked?.payload === "object" && linked.payload !== null
        ? (linked.payload as Record<string, unknown>)
        : {};
    return payload.runtime === "terminal" ? "terminal" : "session";
  };

  const listSubAgentShells = (operation: string, parentThreadId: ThreadId) =>
    projection.getShellSnapshot().pipe(
      Effect.map((snapshot) =>
        snapshot.threads.filter((thread) => (thread.parentThreadId ?? null) === parentThreadId),
      ),
      Effect.catchCause(dispatchFailure(operation)),
    );

  const appendActivity = (input: {
    readonly operation: string;
    readonly threadId: ThreadId;
    readonly kind: string;
    readonly summary: string;
    readonly tone: "info" | "tool" | "error";
    readonly payload: Record<string, unknown>;
    readonly createdAt: IsoDateTime;
  }) =>
    Effect.all({ id: commandId(input.kind), activityId: uuid }).pipe(
      Effect.flatMap(({ activityId, id }) =>
        dispatch(input.operation, {
          type: "thread.activity.append",
          commandId: id,
          threadId: input.threadId,
          activity: {
            id: EventId.make(activityId),
            tone: input.tone,
            kind: input.kind,
            summary: input.summary,
            payload: input.payload,
            turnId: null,
            createdAt: input.createdAt,
          },
          createdAt: input.createdAt,
        }),
      ),
    );

  const instanceCandidates = Effect.gen(function* () {
    const ids = yield* registry.listInstances();
    const candidates: AgentInstanceCandidate[] = [];
    for (const instanceId of ids) {
      const info = yield* registry.getInstanceInfo(instanceId).pipe(Effect.option);
      if (Option.isNone(info)) continue;
      candidates.push({
        instanceId: info.value.instanceId,
        driverKind: info.value.driverKind,
        enabled: info.value.enabled,
      });
    }
    return candidates;
  });

  /**
   * Owning project, for its default model and its workspace root.
   *
   * The root is the fallback cwd for a sub-agent whose orchestrator is not on a
   * worktree, matching `resolveThreadWorkspaceCwd`.
   */
  const readProject = (operation: string, projectId: ProjectId) =>
    projection
      .getProjectShellById(projectId)
      .pipe(Effect.map(Option.getOrNull), Effect.catchCause(dispatchFailure(operation)));

  const startTurn = (input: {
    readonly operation: string;
    readonly threadId: ThreadId;
    readonly text: string;
    readonly runtimeMode: OrchestrationThread["runtimeMode"];
    readonly interactionMode: OrchestrationThread["interactionMode"];
    readonly createdAt: IsoDateTime;
  }) =>
    Effect.all({ id: commandId("turn-start"), messageId: uuid }).pipe(
      Effect.flatMap(({ id, messageId }) =>
        dispatch(input.operation, {
          type: "thread.turn.start",
          commandId: id,
          threadId: input.threadId,
          message: {
            messageId: MessageId.make(messageId),
            role: "user",
            text: input.text,
            attachments: [],
          },
          runtimeMode: input.runtimeMode,
          interactionMode: input.interactionMode,
          createdAt: input.createdAt,
        }),
      ),
    );

  /**
   * Binary that hosts a driver's interactive CLI.
   *
   * Falls back to the driver slug, which is what the settings default already is
   * (`codex`, `claude`), so an unconfigured machine still resolves something on
   * PATH rather than failing.
   */
  const driverBinaryPath = (
    providers: Record<string, { readonly binaryPath?: string | undefined } | undefined>,
    driverKind: string,
  ): string => providers[driverKind]?.binaryPath?.trim() || driverKind;

  /**
   * Host the driver's own CLI in a terminal bound to the sub-agent's thread.
   *
   * The terminal is what the goal calls a spawned terminal: a real interactive
   * process the user can watch and type into, in the sub-agent's own workspace.
   * It is not a background task — closing the thread's terminal stops it.
   */
  const openAgentTerminal = Effect.fn("AgentControl.openAgentTerminal")(function* (input: {
    readonly childThreadId: ThreadId;
    readonly cwd: string;
    readonly program: string;
    readonly task: string;
  }) {
    const snapshot = yield* terminals
      .open({
        threadId: input.childThreadId,
        terminalId: DEFAULT_AGENT_TERMINAL_ID,
        cwd: input.cwd,
        program: input.program,
        // The task is the CLI's initial prompt. Both `codex` and `claude` accept a
        // positional prompt and stay interactive afterwards.
        args: [input.task],
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new AgentLaunchFailedError({
              profile: "terminal",
              detail: `could not start '${input.program}' in a terminal: ${cause.message}`,
            }),
        ),
      );
    return snapshot.terminalId;
  });

  const spawn: AgentControlShape["spawn"] = Effect.fn("AgentControl.spawn")(function* (input) {
    const parent = yield* requireOrchestrator(input.parentThreadId);

    const existing = yield* listSubAgentShells("spawn", input.parentThreadId);
    const live = existing.filter((thread) => agentRunStatusFromThread(thread) === "running");
    if (live.length >= MAX_LIVE_SUB_AGENTS_PER_PARENT) {
      return yield* new AgentConcurrencyLimitError({
        parentThreadId: input.parentThreadId,
        limit: MAX_LIVE_SUB_AGENTS_PER_PARENT,
      });
    }

    const serverSettings = yield* settings.getSettings.pipe(
      Effect.catchCause(dispatchFailure("spawn")),
    );
    const project = yield* readProject("spawn", parent.projectId);
    const resolved = yield* Result.match(
      resolveAgentProfile({
        profile: input.profile,
        profiles: serverSettings.agentProfiles,
        instances: yield* instanceCandidates,
        projectDefaultModelSelection: project?.defaultModelSelection ?? null,
      }),
      {
        onSuccess: (value) => Effect.succeed(value),
        onFailure: (error) => Effect.fail(error),
      },
    );

    const childThreadId = ThreadId.make(yield* uuid);
    const createdAt = yield* nowIso;
    const title = input.title ?? deriveTitle(resolved.titlePrefix, input.task);

    yield* dispatch("spawn", {
      type: "thread.create",
      commandId: yield* commandId("thread-create"),
      threadId: childThreadId,
      projectId: parent.projectId,
      parentThreadId: input.parentThreadId,
      title,
      modelSelection: resolved.modelSelection,
      runtimeMode: resolved.runtimeMode,
      interactionMode: resolved.interactionMode,
      // Share the orchestrator's workspace so uncommitted context is visible to
      // the sub-agent. This is why the concurrency cap above matters.
      branch: parent.branch,
      worktreePath: parent.worktreePath,
      createdAt,
    });

    // Everything after creation is compensated: a sub-agent thread that exists
    // but never got a turn is a dead row in the sidebar.
    const launch = Effect.gen(function* () {
      // Durable delegation marker. Recursion prevention and any future
      // capability gating read this, so it must land before the sub-agent's
      // provider session can start.
      yield* appendActivity({
        operation: "spawn",
        threadId: childThreadId,
        kind: "agent.parent.linked",
        summary: "Started by an orchestrator",
        tone: "info",
        payload: {
          parentThreadId: input.parentThreadId,
          profile: input.profile,
          runtime: resolved.runtime,
        },
        createdAt,
      });
      yield* appendActivity({
        operation: "spawn",
        threadId: input.parentThreadId,
        kind: "agent.child.started",
        summary: `Delegated to ${resolved.titlePrefix}`,
        tone: "tool",
        payload: {
          childThreadId,
          profile: input.profile,
          runtime: resolved.runtime,
          title,
        },
        createdAt,
      });
      if (resolved.runtime === "terminal") {
        return yield* openAgentTerminal({
          childThreadId,
          cwd: parent.worktreePath ?? project?.workspaceRoot ?? process.cwd(),
          program: driverBinaryPath(
            serverSettings.providers as Record<
              string,
              { readonly binaryPath?: string | undefined } | undefined
            >,
            resolved.driverKind,
          ),
          task: input.task,
        });
      }
      yield* startTurn({
        operation: "spawn",
        threadId: childThreadId,
        text: input.task,
        runtimeMode: resolved.runtimeMode,
        interactionMode: resolved.interactionMode,
        createdAt,
      });
      return null;
    });

    const terminalId = yield* launch.pipe(
      Effect.catchCause((cause) =>
        commandId("thread-delete").pipe(
          Effect.flatMap((id) =>
            engine.dispatch({ type: "thread.delete", commandId: id, threadId: childThreadId }),
          ),
          Effect.ignoreCause({ log: true }),
          Effect.andThen(
            Effect.fail(
              new AgentLaunchFailedError({
                profile: input.profile,
                detail: Cause.hasInterrupts(cause)
                  ? "the request was interrupted before the sub-agent could start."
                  : Cause.pretty(cause),
              }),
            ),
          ),
        ),
      ),
    );

    return {
      threadId: childThreadId,
      profile: input.profile,
      // Set for a PTY-hosted sub-agent. A `session` sub-agent gets its terminal
      // from the UI on demand, like any other thread.
      terminalId,
    } satisfies AgentHandle;
  });

  const send: AgentControlShape["send"] = Effect.fn("AgentControl.send")(function* (input) {
    yield* requireOrchestrator(input.parentThreadId);
    const child = yield* requireOwnedSubAgent({
      operation: "send",
      parentThreadId: input.parentThreadId,
      childThreadId: input.childThreadId,
    });

    if (subAgentRuntime(child) === "terminal") {
      return yield* new AgentTerminalRuntimeError({
        childThreadId: input.childThreadId,
        operation: "send",
      });
    }

    // Starting a second turn while one is in flight races the provider; make the
    // caller wait instead of silently interleaving two tasks.
    if (agentRunStatusFromThread(child) === "running") {
      return yield* new AgentBusyError({ childThreadId: input.childThreadId });
    }

    const createdAt = yield* nowIso;
    yield* startTurn({
      operation: "send",
      threadId: input.childThreadId,
      text: input.message,
      runtimeMode: child.runtimeMode,
      interactionMode: child.interactionMode,
      createdAt,
    });

    return {
      threadId: input.childThreadId,
      // The role is not persisted on the thread; the title prefix written at
      // spawn time is the cheap stand-in. `list` documents the same limitation.
      profile: (child.title.split(":")[0] ?? "").trim() as AgentProfileName,
      terminalId: null,
    } satisfies AgentHandle;
  });

  const extractFinalMessage = (thread: OrchestrationThread): string | null => {
    const assistantMessageId = thread.latestTurn?.assistantMessageId ?? null;
    const byId =
      assistantMessageId === null
        ? undefined
        : thread.messages.find((message) => message.id === assistantMessageId);
    // The turn's closing message. `findLast` rather than `find`: a turn can emit
    // several assistant messages and the last completed one is the conclusion.
    const fallback = thread.messages.findLast(
      (message) =>
        message.role === "assistant" &&
        !message.streaming &&
        (thread.latestTurn === null || message.turnId === thread.latestTurn.turnId),
    );
    const text = (byId ?? fallback)?.text?.trim();
    return text ? truncateFinalMessage(text) : null;
  };

  const settledResult = (input: {
    readonly thread: OrchestrationThread;
    readonly status: AgentRunStatus;
    readonly sequence: number;
  }): AgentRunResult => ({
    threadId: input.thread.id,
    status: input.status,
    finalMessage: extractFinalMessage(input.thread),
    sequence: input.sequence,
  });

  const awaitTurn: AgentControlShape["awaitTurn"] = Effect.fn("AgentControl.awaitTurn")(
    function* (input) {
      const subAgent = yield* requireOwnedSubAgent({
        operation: "await",
        parentThreadId: input.parentThreadId,
        childThreadId: input.childThreadId,
      });
      if (subAgentRuntime(subAgent) === "terminal") {
        return yield* new AgentTerminalRuntimeError({
          childThreadId: input.childThreadId,
          operation: "await",
        });
      }

      const timeout = Duration.min(
        input.timeout ?? DEFAULT_AWAIT_TURN_TIMEOUT,
        MAX_AWAIT_TURN_TIMEOUT,
      );

      const wait = Effect.scoped(
        Effect.gen(function* () {
          // Ordering is what makes this race-free. The orchestration engine
          // updates the projection inside the same transaction that appends the
          // event, and publishes to the PubSub only after that transaction
          // commits. So:
          //
          //   - a settle committed before the recheck below is already visible in
          //     the projection, and
          //   - a settle committed after it is published to a subscription that
          //     is, by then, already attached.
          //
          // Attaching live *first* and rechecking the projection *second* leaves
          // no window in which a settle is neither observed nor delivered. A
          // replay cursor is unnecessary here (unlike `subscribeThread`, which
          // resumes from a client's older cursor).
          const liveEvents =
            yield* Queue.unbounded<Extract<OrchestrationEvent, { type: "thread.session-set" }>>();
          yield* Effect.forkScoped(
            engine.streamDomainEvents.pipe(
              Stream.filter((event) => isThreadSessionEvent(event, input.childThreadId)),
              Stream.runForEach((event) => Queue.offer(liveEvents, event)),
            ),
          );

          const current = yield* requireOwnedSubAgent({
            operation: "await",
            parentThreadId: input.parentThreadId,
            childThreadId: input.childThreadId,
          });
          const currentStatus = agentRunStatusFromThread(current);
          if (isSettledAgentRunStatus(currentStatus)) {
            return settledResult({
              thread: current,
              status: currentStatus,
              sequence: yield* engine.latestSequence,
            });
          }

          while (true) {
            const event = yield* Queue.take(liveEvents);
            const status = agentRunStatusFromSessionStatus(event.payload.session.status);
            if (status === null) {
              continue;
            }
            // Re-read the projection rather than trusting the event alone: the
            // assistant message id and final turn state are projector-derived.
            const settled = yield* readThread("await", input.childThreadId);
            // The event's status is authoritative for *whether* the turn ended.
            // The projection refines *how* it ended once its turn row settles, so
            // prefer the projection only when it has actually settled.
            const projected = settled === null ? null : agentRunStatusFromThread(settled);
            return settledResult({
              thread: settled ?? current,
              status: projected !== null && isSettledAgentRunStatus(projected) ? projected : status,
              sequence: event.sequence,
            });
          }
        }),
      );

      return yield* wait.pipe(
        Effect.timeoutOrElse({
          duration: timeout,
          // Elapsing is not a failure and must not disturb the sub-agent: report
          // that it is still working so the caller can await again.
          orElse: () =>
            engine.latestSequence.pipe(
              Effect.map(
                (sequence): AgentRunResult => ({
                  threadId: input.childThreadId,
                  status: "running",
                  finalMessage: null,
                  sequence,
                }),
              ),
            ),
        }),
      );
    },
  );

  const interrupt: AgentControlShape["interrupt"] = Effect.fn("AgentControl.interrupt")(
    function* (input) {
      yield* requireOwnedSubAgent({
        operation: "interrupt",
        parentThreadId: input.parentThreadId,
        childThreadId: input.childThreadId,
      });
      yield* dispatch("interrupt", {
        type: "thread.turn.interrupt",
        commandId: yield* commandId("turn-interrupt"),
        threadId: input.childThreadId,
        createdAt: yield* nowIso,
      });
    },
  );

  const list: AgentControlShape["list"] = Effect.fn("AgentControl.list")(function* (input) {
    const shells = yield* listSubAgentShells("list", input.parentThreadId);
    return shells.map(
      (thread): AgentSummary => ({
        threadId: thread.id,
        // The role name lives in the sub-agent's `agent.parent.linked` activity,
        // which the shell snapshot does not carry. Callers that need it read the
        // sub-agent's thread; the title prefix is the cheap approximation.
        profile: null,
        title: thread.title,
        status: agentRunStatusFromThread(thread),
        updatedAt: thread.updatedAt,
      }),
    );
  });

  return {
    spawn,
    send,
    awaitTurn,
    interrupt,
    list,
  } satisfies AgentControlShape;
});

export const AgentControlLive = Layer.effect(AgentControl, make);

export type { AgentControlError };
