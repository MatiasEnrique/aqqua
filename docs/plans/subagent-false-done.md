# Sub-agents report Done while still working

## Symptom

`aqqua agent await <threadId>` returns `completed`, `aqqua agent list` shows the lane settled,
and the orchestrator integrates a lane that has not finished. The sub-agent keeps working
afterwards.

## Evidence

Live in `~/.aqqua/userdata/state.sqlite` during the failed orchestration run (2026-08-04):

| thread                                    | session.status | session.active_turn_id | thread.latest_turn_id | that turn's state     |
| ----------------------------------------- | -------------- | ---------------------- | --------------------- | --------------------- |
| `Implement /resume for exte…` (sub-agent) | `running`      | `019fcdde-3d1f…`       | `019fcdea-79b5…`      | `completed` @17:57:55 |

The thread's latest-turn pointer had regressed to an _older, already-settled_ turn while the
session was running a newer one. Every consumer that reads `latestTurn` first therefore reported
the lane as finished.

Secondary fingerprint, dozens of rows the same afternoon (`pi lane B: RPC client`,
`laneB: aqqua profile CLI`, `usage: log sources`, `pi lane A: contracts`): turn rows with
`requested_at == started_at == completed_at` to the millisecond. On lane B, turn
`019fcdf7-d86b` was stamped completed at 18:10:05.755 and then emitted its actual closing
message at 18:10:20.479 — settled 15 seconds before it finished.

Codex-profile lanes are hit hardest: that adapter opens a turn boundary per response, so there
are many checkpoint diff-completions in flight per task, and checkpoint capture is slow (git
checkpoint + diff + workspace-entry refresh), so a diff-completion routinely lands after the
next turn has already started.

## Defects

### D1 — the latest-turn pointer regresses (root cause)

`apps/server/src/orchestration/Layers/ProjectionPipeline.ts:944`

```ts
case "thread.turn-diff-completed": {
  ...
  yield* projectionThreadRepository.upsert({
    ...existingRow.value,
    latestTurnId: event.payload.turnId,   // unconditional
```

No guard at all. A diff-completion for turn _A_ arriving while the session runs turn _B_
repoints `latest_turn_id` at settled turn _A_. This is what produced the table above.

The turn-row writer two cases down (`:1451`) _does_ have a guard, so the two halves of the same
event disagree with each other.

### D2 — settled turn outranks a running session

`apps/server/src/agent-control/Status.ts:91`

```ts
const fromTurn = agentRunStatusFromLatestTurn(thread.latestTurn);
if (isSettledAgentRunStatus(fromTurn)) return fromTurn; // wins even if session is running
```

D1 is what corrupts the pointer; D2 is what makes the corruption fatal instead of cosmetic.
The web already resolves this the other way — `classifyThreadPresentation`
(`apps/web/src/components/sidebar-v2/threadPresentationState.ts:87`) checks
`session.status === "running"` _first_, and `isPresentationTurnSettled` (`:75`) explicitly
refuses to call a turn settled while the session runs. So the sidebar row shows Working while
the CLI says completed: server and web disagree today.

### D3 — the `turnStillRunning` guard is too narrow, and `completedAt` escapes it

`apps/server/src/orchestration/projector.ts:649` and
`apps/server/src/orchestration/Layers/ProjectionPipeline.ts:1457`

```ts
const turnStillRunning = session.status === "running" && session.activeTurnId === payload.turnId;
```

Only protects the _currently active_ turn. A superseded turn's diff-completion settles freely
mid-flight.

And when the guard does hold, `completedAt` is written anyway
(`ProjectionPipeline.ts:1483`, mirrored at `projector.ts:669`):

```ts
state: turnStillRunning ? existingTurn.value.state : nextState,
...
completedAt: event.payload.completedAt,   // written regardless
```

leaving `state='running'` rows that carry a `completed_at` — visible in the DB on
`pi lane D: adapter`, `C-server: merge change req`, `usage: client gauges`. Consequences:
`hasUnseenCompletion` (`threadPresentationState.ts:57`) lights the unread-Done affordance
mid-turn, and when no existing row is found the fallbacks at `:1495-1497` /
`projector.ts:661-668` stamp `requestedAt`/`startedAt` from `completedAt` — the zero-duration
rows.

### D4 — the birth window

`Status.ts` falls back to session status when `latestTurn` is null. A freshly spawned session
sits at `ready` for an instant before its first turn starts, and `ready` maps to `completed`
(`Status.ts:28-30`). So an `await` issued immediately after `spawn` can settle before the lane
has done anything.

This is already known elsewhere: `apps/server/src/relay/AgentAwarenessRelay.ts:437` defers
publishing a first-ever `completed` by 5s precisely because "sessions boot at `ready` before
their first turn, which projects as completed for an instant". The relay papered over the
symptom; the shared derivation was never fixed.

`ProviderCommandReactor.ts:532` and `ProviderRuntimeIngestion.ts:1416` hold a partial guard
(`pendingTurnStart` ⇒ report `starting` instead of `ready`), but ingestion's version requires
`thread.session?.status === "starting"` already (`:1315`), so it does not cover a session that
reaches `ready` from any other state.

### D5 — the orchestrator protocol

Independent of the server bugs: the orchestrator ended its turn while lanes were mid-flight,
relying on a background watcher to re-invoke it. The watcher died silently and nothing resumed
the integration. D1–D4 made this worse by teaching the orchestrator the lanes were done.

## Fix plan

### Step 1 — stop the pointer regressing (D1)

`ProjectionPipeline.ts:944`. Only move `latest_turn_id` forward:

- if the session is `running` and `activeTurnId` is set, `latest_turn_id` belongs to the active
  turn — leave it alone;
- otherwise write `payload.turnId` as today.

Emit `Effect.logWarning` when a write is suppressed, with `threadId`, `payload.turnId`,
`activeTurnId`. That log line is the regression detector for the next incident.

### Step 2 — a running session means running (D2)

`Status.ts:91`, `agentRunStatusFromThread`. New precedence:

1. `session.status` is `running` or `starting` ⇒ `running`, whatever `latestTurn` says.
2. otherwise a settled `latestTurn` wins (keeps the documented re-link window working).
3. otherwise session-derived, then `running`.

Checked against `Status.test.ts`: every existing case still passes — the "prefers a settled turn
row" test at `:73` uses an `idle` session, and `:89` already asserts running+running. This also
makes the server agree with the web classifier; note that alignment in the module docstring.

### Step 3 — one honest settle predicate (D3)

- Widen `turnStillRunning` in both `projector.ts:649` and `ProjectionPipeline.ts:1457`: a turn
  is not settleable by a diff-completion while its thread's session is `running`, regardless of
  which turn the payload names. Record the checkpoint; do not settle.
- Stop writing `completedAt` when the guard holds (`ProjectionPipeline.ts:1483`,
  `projector.ts:669`) so `state='running'` rows never carry a completion timestamp.
- Keep the existing `requestedAt`/`startedAt` fallbacks, but only on the insert path where the
  turn is genuinely settled — so a zero-duration row means "settled turn we never saw start",
  not "turn we settled early".

The real settle still arrives: the session leaves `running`, and `Status.ts` step 2 falls
through to the session status, which is the authoritative turn-end signal.

### Step 4 — close the birth window (D4)

In `agentRunStatusFromThread`'s callers (`AgentControl.awaitTurn`, `listSubAgents`, and the
`spawn` concurrency check at `AgentControl.ts:494`), treat a thread with a pending turn start as
`running`. `projectionTurnRepository.getPendingTurnStartByThreadId` already exists and is
already used by ingestion — reuse it rather than inventing a watermark.

Threaded through `agentRunStatusFromThread` as an extra field on the input record keeps the
function pure and testable.

Once this lands, `AgentAwarenessRelay.ts:437`'s 5s deferral for a first-ever `completed` is
redundant. Leave it in this change; delete it in a follow-up once the invariant test has run for
a while.

### Step 5 — the orchestrator protocol (D5)

`~/.claude/skills/orchestrate/SKILL.md`, §3 "Watch them work":

- Never end the turn while a lane is in flight. Poll `aqqua agent await` in the foreground.
- A background watcher is not a wake-up mechanism; if one is used at all it is a supplement to
  a foreground loop, never a replacement.
- Before integrating a lane that reported `completed`, confirm its session is not still running
  (`aqqua agent list --json`). Keep this belt-and-braces step until steps 1–4 have shipped and
  the invariant test has been green for a full orchestration run.

## Tests

- `Status.test.ts` — running session + settled `latestTurn` ⇒ `running`; pending turn start +
  `ready` session ⇒ `running`; existing cases unchanged.
- `ProjectionPipeline.test.ts` — a `thread.turn-diff-completed` for turn A, dispatched while the
  session is running turn B, leaves `latest_turn_id` on B and leaves A's row unsettled.
- `projector.test.ts` — same scenario against the in-memory projector, so the two projections
  cannot drift apart again.
- `AgentControl.test.ts` — `awaitTurn` does not return `completed` for a thread whose session is
  running but whose latest turn is a stale settled row; and does not settle between spawn and
  first turn.
- Invariant assertion for the integration suite: no thread may have `session.status = 'running'`
  and a `latest_turn_id` that is not the session's `active_turn_id`.

## Data

No migration. `latest_turn_id` is rewritten by the next `thread.session-set` or diff-completion,
so poisoned rows heal on their own once the writes are fixed. Confirm on the live DB after the
fix with the query that found the bug:

```sql
select t.thread_id, s.status, s.active_turn_id, t.latest_turn_id, tu.state
from projection_threads t
join projection_thread_sessions s on s.thread_id = t.thread_id
left join projection_turns tu on tu.thread_id = t.thread_id and tu.turn_id = t.latest_turn_id
where s.status = 'running'
  and t.latest_turn_id is not null
  and t.latest_turn_id <> coalesce(s.active_turn_id, '');
```

Expected after the fix: no row where the session is running and the latest turn is settled.

## Sequencing

Steps 1–3 touch the same two projection files and must land together — they are one lane. Step 4
touches `Status.ts` + `AgentControl.ts` and depends on step 2's signature change. Step 5 is
documentation and can go first, since it is the only mitigation available until the rest ships.

## Verification

`vp test run` over the four test files above, plus targeted typecheck and lint on `apps/server`.
Then one real orchestration run of 3 codex lanes with `aqqua agent events --follow` recording,
checking that no lane reports `completed` before its final assistant message.
