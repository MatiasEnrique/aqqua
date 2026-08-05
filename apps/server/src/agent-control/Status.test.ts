import { assert, it } from "@effect/vitest";
import type { OrchestrationSessionStatus } from "@aqqua/contracts";

import {
  agentRunStatusFromLatestTurn,
  agentRunStatusFromSessionStatus,
  agentRunStatusFromThread,
  isSettledAgentRunStatus,
} from "./Status.ts";

it("treats leaving the running session status as the turn-end signal", () => {
  const cases: ReadonlyArray<readonly [OrchestrationSessionStatus, string | null]> = [
    ["idle", "completed"],
    ["ready", "completed"],
    ["error", "failed"],
    ["interrupted", "interrupted"],
    ["stopped", "interrupted"],
    // Still in flight: awaiting must not resolve on either of these.
    ["starting", null],
    ["running", null],
  ];

  for (const [status, expected] of cases) {
    assert.equal(
      agentRunStatusFromSessionStatus(status),
      expected,
      `session status '${status}' mapped incorrectly`,
    );
  }
});

it("maps latest-turn state to a sub-agent status", () => {
  assert.equal(agentRunStatusFromLatestTurn({ state: "running" }), "running");
  assert.equal(agentRunStatusFromLatestTurn({ state: "completed" }), "completed");
  assert.equal(agentRunStatusFromLatestTurn({ state: "error" }), "failed");
  assert.equal(agentRunStatusFromLatestTurn({ state: "interrupted" }), "interrupted");
});

it("reports a sub-agent with no recorded turn as still working", () => {
  // A freshly spawned sub-agent has had its turn requested but the provider has
  // not produced a turn id yet. Reporting `completed` here would make an
  // orchestrator act on work that never happened.
  assert.equal(agentRunStatusFromLatestTurn(null), "running");
});

it("classifies only non-running statuses as settled", () => {
  assert.equal(isSettledAgentRunStatus("running"), false);
  assert.equal(isSettledAgentRunStatus("completed"), true);
  assert.equal(isSettledAgentRunStatus("failed"), true);
  assert.equal(isSettledAgentRunStatus("interrupted"), true);
});

it("reports a finished sub-agent as settled even before its turn row is re-linked", () => {
  // `projection_threads.latest_turn_id` is written from the session's
  // activeTurnId, so it is cleared the instant a session leaves `running`. The
  // settled turn row is only re-linked later by the checkpoint reactor. Reading
  // `latestTurn` alone in that window reports a finished sub-agent as `running`,
  // and an orchestrator would wait for a turn that already ended.
  assert.equal(
    agentRunStatusFromThread({
      hasPendingTurnStart: false,
      latestTurn: null,
      session: { status: "idle" },
    }),
    "completed",
  );
  assert.equal(
    agentRunStatusFromThread({
      hasPendingTurnStart: false,
      latestTurn: null,
      session: { status: "error" },
    }),
    "failed",
  );
  assert.equal(
    agentRunStatusFromThread({
      hasPendingTurnStart: false,
      latestTurn: null,
      session: { status: "stopped" },
    }),
    "interrupted",
  );
});

it("prefers a settled turn row over the session status", () => {
  // The turn row reflects checkpoint state, so it is the more precise signal
  // once it exists.
  assert.equal(
    agentRunStatusFromThread({
      hasPendingTurnStart: false,
      latestTurn: { state: "interrupted" },
      session: { status: "idle" },
    }),
    "interrupted",
  );
});

it("reports a running session as running when the latest turn is settled", () => {
  assert.equal(
    agentRunStatusFromThread({
      hasPendingTurnStart: false,
      latestTurn: { state: "completed" },
      session: { status: "running" },
    }),
    "running",
  );
});

it("reports a starting session as running when the latest turn is settled", () => {
  assert.equal(
    agentRunStatusFromThread({
      hasPendingTurnStart: false,
      latestTurn: { state: "completed" },
      session: { status: "starting" },
    }),
    "running",
  );
});

it("reports a pending turn start as running when the session is ready", () => {
  assert.equal(
    agentRunStatusFromThread({
      hasPendingTurnStart: true,
      latestTurn: null,
      session: { status: "ready" },
    }),
    "running",
  );
});

it("reports a sub-agent that has not started a session yet as running", () => {
  assert.equal(
    agentRunStatusFromThread({ hasPendingTurnStart: false, latestTurn: null, session: null }),
    "running",
  );
});

it("reports a live session as running", () => {
  assert.equal(
    agentRunStatusFromThread({
      hasPendingTurnStart: false,
      latestTurn: { state: "running" },
      session: { status: "running" },
    }),
    "running",
  );
  assert.equal(
    agentRunStatusFromThread({
      hasPendingTurnStart: false,
      latestTurn: null,
      session: { status: "starting" },
    }),
    "running",
  );
});
