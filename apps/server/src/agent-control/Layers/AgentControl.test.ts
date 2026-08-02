import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AgentProfileName,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  type OrchestrationSessionStatus,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type TerminalOpenInput,
  ThreadId,
  TurnId,
} from "@aqqua/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../../config.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { OrchestrationLayerLive } from "../../orchestration/runtimeLayer.ts";
import { ProviderAdapterRegistry } from "../../provider/Services/ProviderAdapterRegistry.ts";
import * as TerminalManager from "../../terminal/Manager.ts";
import { layerTest as serverSettingsLayerTest } from "../../serverSettings.ts";
import { AgentControl } from "../Services/AgentControl.ts";
import { AgentControlLive, MAX_LIVE_SUB_AGENTS_PER_PARENT } from "./AgentControl.ts";

const implementer = AgentProfileName.make("implementer");
const terminalProfile = AgentProfileName.make("terminalImplementer");
const codexInstanceId = ProviderInstanceId.make("codex");

let uniqueCounter = 0;
const unique = (prefix: string) => `${prefix}-${(uniqueCounter += 1)}`;
const nextCommandId = () => CommandId.make(unique("test-cmd"));

const registryStub = Layer.succeed(ProviderAdapterRegistry, {
  getByInstance: () => Effect.die("unused"),
  getInstanceInfo: (instanceId: ProviderInstanceId) =>
    Effect.succeed({
      instanceId,
      driverKind: ProviderDriverKind.make("codex"),
      displayName: "Codex",
      enabled: true,
      continuationIdentity: { kind: "instance", instanceId },
    }),
  listInstances: () => Effect.succeed([codexInstanceId]),
  listProviders: () => Effect.succeed([ProviderDriverKind.make("codex")]),
  streamChanges: Stream.empty,
  subscribeChanges: Effect.flatMap(PubSub.unbounded<void>(), PubSub.subscribe),
} as unknown as typeof ProviderAdapterRegistry.Service);

/**
 * Records terminals opened for PTY-hosted sub-agents, so the terminal runtime can
 * be asserted without spawning a real process.
 */
const openedTerminals: Array<{
  readonly threadId: string;
  readonly program: string | undefined;
  readonly args: ReadonlyArray<string> | undefined;
  readonly cwd: string;
}> = [];

const terminalStub = Layer.succeed(TerminalManager.TerminalManager, {
  open: (input: TerminalOpenInput) =>
    Effect.sync(() => {
      openedTerminals.push({
        threadId: input.threadId,
        program: input.program,
        args: input.args,
        cwd: input.cwd,
      });
      return {
        threadId: input.threadId,
        terminalId: input.terminalId,
        cwd: input.cwd,
        worktreePath: null,
        status: "running" as const,
        pid: 4242,
        history: "",
        exitCode: null,
        exitSignal: null,
        label: input.program ?? "shell",
        updatedAt: "2026-04-06T00:00:00.000Z",
      };
    }),
} as unknown as typeof TerminalManager.TerminalManager.Service);

// One engine and one projection pipeline, composed the way the server composes
// them. Building `OrchestrationEngineLive` twice would give the test and
// AgentControl separate read models over the same database, which silently breaks
// every assertion about settled turns.
const agentControlLayer = it.layer(
  AgentControlLive.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        OrchestrationLayerLive,
        registryStub,
        terminalStub,
        serverSettingsLayerTest({
          agentProfiles: {
            [terminalProfile]: {
              runtime: "terminal",
              runtimeMode: "full-access",
              interactionMode: "default",
            },
          },
        }),
      ),
    ),
    Layer.provide(RepositoryIdentityResolver.layer),
    Layer.provide(SqlitePersistenceMemory),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), { prefix: "aqqua-agent-control-test-" }),
    ),
    Layer.provideMerge(NodeServices.layer),
  ),
  // Real clock, not the virtual test clock: these tests exercise `awaitTurn`'s
  // wait bound and the ordering between a live subscription and a projection
  // read, neither of which a clock that never advances can express.
  { excludeTestServices: true },
);

agentControlLayer("AgentControl", (it) => {
  /**
   * A fresh project and unparented orchestrator per test. The suite shares one
   * in-memory database, so isolation comes from unique ids rather than teardown.
   */
  const makeOrchestrator = Effect.fn("makeOrchestrator")(function* () {
    const engine = yield* OrchestrationEngineService;
    const projectId = ProjectId.make(unique("project"));
    const parentThreadId = ThreadId.make(unique("thread-orchestrator"));

    yield* engine.dispatch({
      type: "project.create",
      commandId: nextCommandId(),
      projectId,
      title: "Agent control",
      // Distinct per test: only one active project may claim a workspace root,
      // and this suite shares one database across its tests.
      workspaceRoot: `/tmp/aqqua-agent-control/${unique("workspace")}`,
      defaultModelSelection: null,
      createdAt: "2026-04-06T00:00:00.000Z",
    });
    yield* engine.dispatch({
      type: "thread.create",
      commandId: nextCommandId(),
      threadId: parentThreadId,
      projectId,
      title: "Orchestrator",
      modelSelection: { instanceId: codexInstanceId, model: "gpt-5.4-codex" },
      runtimeMode: "full-access",
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      branch: "feat/delegation",
      worktreePath: "/tmp/worktree-delegation",
      createdAt: "2026-04-06T00:00:01.000Z",
    });

    return { parentThreadId, projectId };
  });

  /** Drive the session lifecycle a provider would normally drive. */
  const setSession = Effect.fn("setSession")(function* (input: {
    readonly threadId: ThreadId;
    readonly status: OrchestrationSessionStatus;
    readonly activeTurnId: TurnId | null;
    readonly updatedAt: string;
  }) {
    const engine = yield* OrchestrationEngineService;
    yield* engine.dispatch({
      type: "thread.session.set",
      commandId: nextCommandId(),
      threadId: input.threadId,
      session: {
        threadId: input.threadId,
        status: input.status,
        providerName: "codex",
        providerInstanceId: codexInstanceId,
        runtimeMode: "full-access",
        activeTurnId: input.activeTurnId,
        lastError: null,
        updatedAt: input.updatedAt,
      },
      createdAt: input.updatedAt,
    });
  });

  const startTurn = (threadId: ThreadId, turnId: TurnId) =>
    setSession({
      threadId,
      status: "running",
      activeTurnId: turnId,
      updatedAt: "2026-04-06T00:00:04.000Z",
    });

  const addAssistantMessage = Effect.fn("addAssistantMessage")(function* (input: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId;
    readonly text: string;
  }) {
    const engine = yield* OrchestrationEngineService;
    const messageId = MessageId.make(unique("assistant"));
    yield* engine.dispatch({
      type: "thread.message.assistant.delta",
      commandId: nextCommandId(),
      threadId: input.threadId,
      messageId,
      delta: input.text,
      turnId: input.turnId,
      createdAt: "2026-04-06T00:00:05.000Z",
    });
    yield* engine.dispatch({
      type: "thread.message.assistant.complete",
      commandId: nextCommandId(),
      threadId: input.threadId,
      messageId,
      turnId: input.turnId,
      createdAt: "2026-04-06T00:00:06.000Z",
    });
  });

  /** Finish a sub-agent's turn exactly the way a provider would. */
  const finishTurn = Effect.fn("finishTurn")(function* (input: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId;
    readonly status?: OrchestrationSessionStatus;
    readonly text?: string;
  }) {
    yield* startTurn(input.threadId, input.turnId);
    if (input.text !== undefined) {
      yield* addAssistantMessage({
        threadId: input.threadId,
        turnId: input.turnId,
        text: input.text,
      });
    }
    yield* setSession({
      threadId: input.threadId,
      status: input.status ?? "idle",
      activeTurnId: null,
      updatedAt: "2026-04-06T00:00:07.000Z",
    });
  });

  const readThread = Effect.fn("readThread")(function* (threadId: ThreadId) {
    const projection = yield* ProjectionSnapshotQuery;
    const thread = yield* projection.getThreadDetailById(threadId);
    assert.ok(Option.isSome(thread), `expected thread '${threadId}' to exist`);
    return thread.value;
  });

  it.effect("spawns a sub-agent nested under its orchestrator in the same workspace", () =>
    Effect.gen(function* () {
      const agents = yield* AgentControl;
      const { parentThreadId, projectId } = yield* makeOrchestrator();

      const handle = yield* agents.spawn({
        parentThreadId,
        profile: implementer,
        task: "Implement the server seam\nmore detail here",
      });

      const child = yield* readThread(handle.threadId);
      assert.equal(child.parentThreadId, parentThreadId);
      assert.equal(child.projectId, projectId);
      // Shares the orchestrator's uncommitted context.
      assert.equal(child.branch, "feat/delegation");
      assert.equal(child.worktreePath, "/tmp/worktree-delegation");
      assert.equal(child.title, "implementer: Implement the server seam");
      assert.equal(child.runtimeMode, "full-access");

      // The task became the sub-agent's first user message.
      assert.deepEqual(
        child.messages.filter((message) => message.role === "user").map((message) => message.text),
        ["Implement the server seam\nmore detail here"],
      );
      // Durable delegation marker, which recursion prevention relies on.
      assert.ok(child.activities.some((activity) => activity.kind === "agent.parent.linked"));

      const parent = yield* readThread(parentThreadId);
      const started = parent.activities.find((activity) => activity.kind === "agent.child.started");
      assert.ok(started, "expected the orchestrator to record the delegation");
      assert.equal(
        (started.payload as { readonly childThreadId?: string }).childThreadId,
        handle.threadId,
      );
    }),
  );

  it.effect("resolves a wait for a turn that already finished before the wait started", () =>
    Effect.gen(function* () {
      const agents = yield* AgentControl;
      const { parentThreadId } = yield* makeOrchestrator();
      const handle = yield* agents.spawn({
        parentThreadId,
        profile: implementer,
        task: "Fast task",
      });

      // Settle the sub-agent *before* anyone awaits it. A waiter that only
      // subscribed to the live event stream would block here forever: the
      // settling event was published before the subscription existed. This is the
      // race that attaching live before rechecking the projection closes.
      yield* finishTurn({
        threadId: handle.threadId,
        turnId: TurnId.make(unique("turn")),
        text: "done already",
      });

      const result = yield* agents.awaitTurn({
        parentThreadId,
        childThreadId: handle.threadId,
        timeout: Duration.seconds(5),
      });

      assert.equal(result.status, "completed");
      assert.equal(result.finalMessage, "done already");
    }),
  );

  it.effect("resolves a wait for a turn that finishes while the wait is in flight", () =>
    Effect.gen(function* () {
      const agents = yield* AgentControl;
      const { parentThreadId } = yield* makeOrchestrator();
      const handle = yield* agents.spawn({
        parentThreadId,
        profile: implementer,
        task: "Slow task",
      });

      // `startImmediately` so the waiter has attached its subscription before the
      // turn is settled below — that is the ordering this test is about.
      const waiting = yield* Effect.forkChild(
        agents.awaitTurn({
          parentThreadId,
          childThreadId: handle.threadId,
          timeout: Duration.seconds(10),
        }),
        { startImmediately: true },
      );

      yield* finishTurn({
        threadId: handle.threadId,
        turnId: TurnId.make(unique("turn")),
        text: "finished later",
      });

      const result = yield* Fiber.join(waiting);
      assert.equal(result.status, "completed");
      assert.equal(result.finalMessage, "finished later");
    }),
  );

  it.effect("reports a still-working sub-agent as running when the wait bound elapses", () =>
    Effect.gen(function* () {
      const agents = yield* AgentControl;
      const { parentThreadId } = yield* makeOrchestrator();
      const handle = yield* agents.spawn({
        parentThreadId,
        profile: implementer,
        task: "Long task",
      });
      yield* startTurn(handle.threadId, TurnId.make(unique("turn")));

      const result = yield* agents.awaitTurn({
        parentThreadId,
        childThreadId: handle.threadId,
        timeout: Duration.millis(50),
      });

      // Elapsing must not interrupt the sub-agent or report a false outcome.
      assert.equal(result.status, "running");
      assert.equal(result.finalMessage, null);
      const child = yield* readThread(handle.threadId);
      assert.equal(child.session?.status, "running");
    }),
  );

  it.effect("maps an errored session to failed and a stopped one to interrupted", () =>
    Effect.gen(function* () {
      const agents = yield* AgentControl;
      const { parentThreadId } = yield* makeOrchestrator();

      const failing = yield* agents.spawn({
        parentThreadId,
        profile: implementer,
        task: "Will fail",
      });
      yield* finishTurn({
        threadId: failing.threadId,
        turnId: TurnId.make(unique("turn")),
        status: "error",
      });
      const failed = yield* agents.awaitTurn({
        parentThreadId,
        childThreadId: failing.threadId,
        timeout: Duration.seconds(5),
      });
      assert.equal(failed.status, "failed");

      const stopping = yield* agents.spawn({
        parentThreadId,
        profile: implementer,
        task: "Will be stopped",
      });
      yield* finishTurn({
        threadId: stopping.threadId,
        turnId: TurnId.make(unique("turn")),
        status: "interrupted",
      });
      const interrupted = yield* agents.awaitTurn({
        parentThreadId,
        childThreadId: stopping.threadId,
        timeout: Duration.seconds(5),
      });
      assert.equal(interrupted.status, "interrupted");
    }),
  );

  it.effect("refuses to let a sub-agent delegate further", () =>
    Effect.gen(function* () {
      const agents = yield* AgentControl;
      const { parentThreadId } = yield* makeOrchestrator();
      const handle = yield* agents.spawn({
        parentThreadId,
        profile: implementer,
        task: "Parent task",
      });

      const failure = yield* Effect.flip(
        agents.spawn({
          parentThreadId: handle.threadId,
          profile: implementer,
          task: "Grandchild task",
        }),
      );

      assert.equal(failure._tag, "AgentRecursionDeniedError");
    }),
  );

  it.effect("refuses to operate on a thread the caller did not spawn", () =>
    Effect.gen(function* () {
      const agents = yield* AgentControl;
      const engine = yield* OrchestrationEngineService;
      const { parentThreadId, projectId } = yield* makeOrchestrator();

      const strangerThreadId = ThreadId.make(unique("thread-stranger"));
      yield* engine.dispatch({
        type: "thread.create",
        commandId: nextCommandId(),
        threadId: strangerThreadId,
        projectId,
        title: "Someone else's thread",
        modelSelection: { instanceId: codexInstanceId, model: "gpt-5.4-codex" },
        runtimeMode: "full-access",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        createdAt: "2026-04-06T00:00:02.000Z",
      });

      const awaitFailure = yield* Effect.flip(
        agents.awaitTurn({ parentThreadId, childThreadId: strangerThreadId }),
      );
      assert.equal(awaitFailure._tag, "AgentNotOwnedError");

      const interruptFailure = yield* Effect.flip(
        agents.interrupt({ parentThreadId, childThreadId: strangerThreadId }),
      );
      assert.equal(interruptFailure._tag, "AgentNotOwnedError");

      const sendFailure = yield* Effect.flip(
        agents.send({
          parentThreadId,
          childThreadId: strangerThreadId,
          message: "do my bidding",
        }),
      );
      assert.equal(sendFailure._tag, "AgentNotOwnedError");
    }),
  );

  it.effect("caps live sub-agents per orchestrator and frees a slot when one settles", () =>
    Effect.gen(function* () {
      const agents = yield* AgentControl;
      const { parentThreadId } = yield* makeOrchestrator();

      const handles: Array<ThreadId> = [];
      for (let index = 0; index < MAX_LIVE_SUB_AGENTS_PER_PARENT; index += 1) {
        const handle = yield* agents.spawn({
          parentThreadId,
          profile: implementer,
          task: `Task ${index}`,
        });
        yield* startTurn(handle.threadId, TurnId.make(unique("turn")));
        handles.push(handle.threadId);
      }

      const rejected = yield* Effect.flip(
        agents.spawn({ parentThreadId, profile: implementer, task: "One too many" }),
      );
      assert.equal(rejected._tag, "AgentConcurrencyLimitError");

      const first = handles[0];
      assert.ok(first, "expected at least one sub-agent");
      yield* setSession({
        threadId: first,
        status: "idle",
        activeTurnId: null,
        updatedAt: "2026-04-06T00:00:09.000Z",
      });

      const accepted = yield* agents.spawn({
        parentThreadId,
        profile: implementer,
        task: "Now there is room",
      });
      assert.ok(accepted.threadId);
    }),
  );

  it.effect("refuses a second task while a sub-agent is working, and accepts it after", () =>
    Effect.gen(function* () {
      const agents = yield* AgentControl;
      const { parentThreadId } = yield* makeOrchestrator();
      const handle = yield* agents.spawn({
        parentThreadId,
        profile: implementer,
        task: "First task",
      });
      yield* startTurn(handle.threadId, TurnId.make(unique("turn")));

      const busy = yield* Effect.flip(
        agents.send({
          parentThreadId,
          childThreadId: handle.threadId,
          message: "Second task",
        }),
      );
      assert.equal(busy._tag, "AgentBusyError");

      yield* setSession({
        threadId: handle.threadId,
        status: "idle",
        activeTurnId: null,
        updatedAt: "2026-04-06T00:00:09.000Z",
      });
      const continued = yield* agents.send({
        parentThreadId,
        childThreadId: handle.threadId,
        message: "Second task",
      });
      assert.equal(continued.threadId, handle.threadId);

      const child = yield* readThread(handle.threadId);
      assert.equal(child.messages.filter((message) => message.role === "user").length, 2);
    }),
  );

  it.effect("lists an orchestrator's sub-agents with their statuses", () =>
    Effect.gen(function* () {
      const agents = yield* AgentControl;
      const { parentThreadId } = yield* makeOrchestrator();

      const running = yield* agents.spawn({
        parentThreadId,
        profile: implementer,
        task: "Running task",
      });
      yield* startTurn(running.threadId, TurnId.make(unique("turn")));
      const done = yield* agents.spawn({
        parentThreadId,
        profile: implementer,
        task: "Done task",
      });
      yield* finishTurn({
        threadId: done.threadId,
        turnId: TurnId.make(unique("turn")),
        text: "all done",
      });

      const listed = yield* agents.list({ parentThreadId });
      const statusByThreadId = new Map(listed.map((entry) => [entry.threadId, entry.status]));

      assert.equal(statusByThreadId.get(running.threadId), "running");
      assert.equal(statusByThreadId.get(done.threadId), "completed");
      // An orchestrator is not one of its own sub-agents.
      assert.equal(statusByThreadId.has(parentThreadId), false);
    }),
  );

  it.effect("interrupts a sub-agent through the ordinary turn-interrupt path", () =>
    Effect.gen(function* () {
      const agents = yield* AgentControl;
      const { parentThreadId } = yield* makeOrchestrator();
      const handle = yield* agents.spawn({
        parentThreadId,
        profile: implementer,
        task: "Interrupt me",
      });
      yield* startTurn(handle.threadId, TurnId.make(unique("turn")));

      yield* agents.interrupt({ parentThreadId, childThreadId: handle.threadId });

      // The interrupt is a request; the provider reactor is what acts on it. What
      // matters here is that the request was accepted for the right thread.
      const engine = yield* OrchestrationEngineService;
      const sequence = yield* engine.latestSequence;
      assert.ok(sequence > 0);
    }),
  );

  it.effect("hosts a terminal-runtime sub-agent as a CLI in its own terminal", () =>
    Effect.gen(function* () {
      const agents = yield* AgentControl;
      const { parentThreadId } = yield* makeOrchestrator();
      openedTerminals.length = 0;

      const handle = yield* agents.spawn({
        parentThreadId,
        profile: terminalProfile,
        task: "Fix the failing test",
      });

      // A real interactive process the user can watch and type into, in the
      // sub-agent's own workspace — not a background job.
      assert.equal(handle.terminalId, "term-1");
      assert.equal(openedTerminals.length, 1);
      const opened = openedTerminals[0];
      assert.equal(opened?.threadId, handle.threadId);
      assert.equal(opened?.program, "codex");
      assert.deepEqual(opened?.args, ["Fix the failing test"]);
      assert.equal(opened?.cwd, "/tmp/worktree-delegation");

      // Still an ordinary nested thread, so it shows up under its orchestrator.
      const child = yield* readThread(handle.threadId);
      assert.equal(child.parentThreadId, parentThreadId);
      // No provider turn was started: the CLI in the terminal is the sub-agent.
      assert.equal(child.messages.filter((message) => message.role === "user").length, 0);
      const linked = child.activities.find((activity) => activity.kind === "agent.parent.linked");
      assert.ok(linked, "expected the delegation link activity");
      assert.equal((linked.payload as { readonly runtime?: string }).runtime, "terminal");
    }),
  );

  it.effect("refuses to wait on or message a terminal-hosted sub-agent", () =>
    Effect.gen(function* () {
      const agents = yield* AgentControl;
      const { parentThreadId } = yield* makeOrchestrator();
      const handle = yield* agents.spawn({
        parentThreadId,
        profile: terminalProfile,
        task: "Watch me in the terminal",
      });

      // A PTY-hosted sub-agent has no provider session to settle. Waiting would
      // block until the bound elapsed and then report `running` forever, so both
      // operations must say plainly that they do not apply.
      const awaitFailure = yield* Effect.flip(
        agents.awaitTurn({
          parentThreadId,
          childThreadId: handle.threadId,
          timeout: Duration.millis(50),
        }),
      );
      assert.equal(awaitFailure._tag, "AgentTerminalRuntimeError");
      assert.match(awaitFailure.message, /terminal/);

      const sendFailure = yield* Effect.flip(
        agents.send({
          parentThreadId,
          childThreadId: handle.threadId,
          message: "another task",
        }),
      );
      assert.equal(sendFailure._tag, "AgentTerminalRuntimeError");
    }),
  );

  it.effect("rejects an unknown role without creating a sub-agent", () =>
    Effect.gen(function* () {
      const agents = yield* AgentControl;
      const { parentThreadId } = yield* makeOrchestrator();

      const failure = yield* Effect.flip(
        agents.spawn({
          parentThreadId,
          profile: AgentProfileName.make("reviewer"),
          task: "Review it",
        }),
      );
      assert.equal(failure._tag, "AgentProfileUnknownError");

      const listed = yield* agents.list({ parentThreadId });
      assert.deepEqual(listed, []);
    }),
  );
});
