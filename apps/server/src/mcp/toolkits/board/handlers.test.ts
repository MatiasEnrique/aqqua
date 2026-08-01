import {
  BoardId,
  BoardStepId,
  CardId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type BoardStep,
  type OrchestrationCard,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it, vi } from "@effect/vitest";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../../../orchestration/Services/OrchestrationEngine.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { boardComplete, boardCompleteReplyText, findCardForCurrentStepThread } from "./handlers.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const projectId = ProjectId.make("project-1");
const boardId = BoardId.make("board-1");
const cardId = CardId.make("card-1");
const stepThreadId = ThreadId.make("thread-step-1");
const subAgentThreadId = ThreadId.make("thread-subagent");
const otherThreadId = ThreadId.make("thread-other");

const STEPS: ReadonlyArray<BoardStep> = [
  {
    id: BoardStepId.make("step-1"),
    name: "Implement",
    promptTemplate: "Do work",
    profileName: "implementer" as BoardStep["profileName"],
    continuation: "auto",
  },
  {
    id: BoardStepId.make("step-2"),
    name: "Review",
    promptTemplate: "Review work",
    profileName: "implementer" as BoardStep["profileName"],
    continuation: "auto",
  },
];

function makeCard(overrides: Partial<OrchestrationCard> = {}): OrchestrationCard {
  return {
    id: cardId,
    boardId,
    projectId,
    title: "Fix flaky test",
    parameters: {},
    position: { kind: "step", stepIndex: 0 },
    status: "running",
    operation: null,
    lastError: null,
    snapshot: { name: "Delivery", steps: STEPS },
    branch: "board/fix-flaky-test-card1",
    worktreePath: "/tmp/wt",
    stepThreads: [{ stepIndex: 0, threadId: stepThreadId, spawnedAt: NOW }],
    createdAt: NOW,
    updatedAt: NOW,
    releasedAt: NOW,
    completedAt: null,
    settledAt: null,
    archivedAt: null,
    ...overrides,
  };
}

describe("findCardForCurrentStepThread", () => {
  it("matches only the current step thread", () => {
    const card = makeCard();
    expect(findCardForCurrentStepThread([card], stepThreadId)?.id).toBe(cardId);
    expect(findCardForCurrentStepThread([card], subAgentThreadId)).toBeNull();
    expect(findCardForCurrentStepThread([card], otherThreadId)).toBeNull();
  });

  it("ignores stale/retried-away threads for the same step", () => {
    const stale = ThreadId.make("thread-stale");
    const current = ThreadId.make("thread-current");
    const card = makeCard({
      stepThreads: [
        { stepIndex: 0, threadId: stale, spawnedAt: NOW },
        { stepIndex: 0, threadId: current, spawnedAt: "2026-01-01T01:00:00.000Z" },
      ],
    });
    expect(findCardForCurrentStepThread([card], current)?.id).toBe(cardId);
    expect(findCardForCurrentStepThread([card], stale)).toBeNull();
  });

  it("ignores archived cards and non-step positions", () => {
    expect(
      findCardForCurrentStepThread(
        [makeCard({ archivedAt: NOW }), makeCard({ position: { kind: "todo" } })],
        stepThreadId,
      ),
    ).toBeNull();
  });
});

describe("boardCompleteReplyText", () => {
  it("describes advance, done, blocked, and pause outcomes", () => {
    expect(
      boardCompleteReplyText({
        outcome: "success",
        stepIndex: 1,
        stepName: "Review",
        advances: true,
        completes: false,
      }),
    ).toBe("Recorded success for step 2 · Review — card advances.");
    expect(
      boardCompleteReplyText({
        outcome: "success",
        stepIndex: 1,
        stepName: "Review",
        advances: false,
        completes: true,
      }),
    ).toBe("Recorded success for step 2 · Review — card reaches Done.");
    expect(
      boardCompleteReplyText({
        outcome: "blocked",
        stepIndex: 0,
        stepName: "Implement",
        advances: false,
        completes: false,
      }),
    ).toBe("Recorded blocked for step 1 · Implement — card marked needs-input.");
  });
});

describe("board_complete handler", () => {
  it.effect("dispatches card.step.report for the current step thread", () =>
    Effect.gen(function* () {
      const dispatched: Array<Record<string, unknown>> = [];
      const card = makeCard();

      const engine: Pick<OrchestrationEngineShape, "dispatch"> = {
        dispatch: (command) =>
          Effect.sync(() => {
            dispatched.push(command as unknown as Record<string, unknown>);
            return { sequence: 1 };
          }),
      };

      const snapshots: Pick<ProjectionSnapshotQueryShape, "getShellSnapshot"> = {
        getShellSnapshot: () =>
          Effect.succeed({
            snapshotSequence: 1,
            projects: [],
            threads: [],
            boards: [],
            cards: [card],
            updatedAt: NOW,
          }),
      };

      const invocation = {
        environmentId: EnvironmentId.make("env-1"),
        threadId: stepThreadId,
        providerSessionId: "session-1",
        providerInstanceId: ProviderInstanceId.make("codex"),
        capabilities: new Set(["preview"] as const),
        issuedAt: 1,
      };

      const result = yield* boardComplete({ outcome: "success" }).pipe(
        Effect.provideService(
          OrchestrationEngineService,
          engine as unknown as typeof OrchestrationEngineService.Service,
        ),
        Effect.provideService(
          ProjectionSnapshotQuery,
          snapshots as unknown as typeof ProjectionSnapshotQuery.Service,
        ),
        Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
        Effect.provide(NodeServices.layer),
      );

      expect(result.accepted).toBe(true);
      expect(result.message).toContain("Recorded success for step 1 · Implement");
      expect(result.message).toContain("card advances");
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]).toMatchObject({
        type: "card.step.report",
        cardId,
        stepIndex: 0,
        threadId: stepThreadId,
        outcome: "success",
      });
    }),
  );

  it.effect("refuses sub-agent and unknown threads without dispatching", () =>
    Effect.gen(function* () {
      const dispatch = vi.fn(() => Effect.succeed({ sequence: 1 }));
      const card = makeCard();

      const engine = { dispatch };
      const snapshots = {
        getShellSnapshot: () =>
          Effect.succeed({
            snapshotSequence: 1,
            projects: [],
            threads: [],
            boards: [],
            cards: [card],
            updatedAt: NOW,
          }),
      };

      const runForThread = (threadId: ThreadId) => {
        const invocation = {
          environmentId: EnvironmentId.make("env-1"),
          threadId,
          providerSessionId: "session-1",
          providerInstanceId: ProviderInstanceId.make("codex"),
          capabilities: new Set(["preview"] as const),
          issuedAt: 1,
        };
        return boardComplete({ outcome: "success" }).pipe(
          Effect.provideService(
            OrchestrationEngineService,
            engine as unknown as typeof OrchestrationEngineService.Service,
          ),
          Effect.provideService(
            ProjectionSnapshotQuery,
            snapshots as unknown as typeof ProjectionSnapshotQuery.Service,
          ),
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.provide(NodeServices.layer),
        );
      };

      const subAgent = yield* runForThread(subAgentThreadId);
      expect(subAgent.accepted).toBe(false);
      expect(subAgent.message).toMatch(/not the current step thread/i);

      const unknown = yield* runForThread(otherThreadId);
      expect(unknown.accepted).toBe(false);
      expect(dispatch).not.toHaveBeenCalled();
    }),
  );
});
