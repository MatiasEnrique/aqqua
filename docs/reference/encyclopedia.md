# Encyclopedia

This is a living glossary for aqqua. It explains what common terms mean in this codebase.

## Table of contents

- [Project and workspace](#project-and-workspace)
- [Thread timeline](#thread-timeline)
- [Orchestration](#orchestration)
- [Provider runtime](#provider-runtime)
- [Usage tracking](#usage-tracking)
- [Checkpointing](#checkpointing)

## Concepts

### Project and workspace

#### Project

The top-level workspace record in the app. In [the orchestration contracts][1], a project has a `workspaceRoot`, a title, and one or more threads. See [workspace-layout.md][2].

#### Workspace root

The root filesystem path for a project. In [the orchestration model][1], it is the base directory for branches and optional worktrees. See [workspace-layout.md][2].

#### Worktree

A Git worktree used as an isolated workspace for a thread. If a thread has a `worktreePath` in [the contracts][1], it runs there instead of in the main working tree. Git operations live in [GitCore.ts][3].

### Thread timeline

#### Thread

The main durable unit of conversation and workspace history. In [the orchestration contracts][1], a thread holds messages, activities, checkpoints, and session-related state. See [projector.ts][4].

#### Turn

A single user-to-assistant work cycle inside a thread. It starts with user input and ends when follow-up work like checkpointing settles. See [the contracts][1], [ProviderRuntimeIngestion.ts][5], and [CheckpointReactor.ts][6].

#### Activity

A user-visible log item attached to a thread. In [the contracts][1], activities cover important non-message events like approvals, tool actions, and failures. They are projected into thread state in [projector.ts][4].

### Orchestration

Orchestration is the server-side domain layer that turns runtime activity into stable app state. The main entry point is [OrchestrationEngine.ts][7], with core logic in [decider.ts][8] and [projector.ts][4].

#### Aggregate

The domain object a command or event belongs to. In [the contracts][1], that is usually `project` or `thread`. See [decider.ts][8].

#### Command

A typed request to change domain state. In [the contracts][1], commands are validated in [commandInvariants.ts][9] and turned into events by [decider.ts][8].
Examples include `thread.create`, `thread.turn.start`, and `thread.checkpoint.revert`.

#### Domain Event

A persisted fact that something already happened. In [the contracts][1], events are the source of truth, and [projector.ts][4] shows how they are applied.
Examples include `thread.created`, `thread.message-sent`, and `thread.turn-diff-completed`.

#### Decider

The pure orchestration logic that turns commands plus current state into events. The core implementation is in [decider.ts][8], with preconditions in [commandInvariants.ts][9].

#### Projection

A read-optimized view derived from events. See [projector.ts][4], [ProjectionPipeline.ts][11], and [ProjectionSnapshotQuery.ts][10].

#### Projector

The logic that applies domain events to the read model or projection tables. See [projector.ts][4] and [ProjectionPipeline.ts][11].

#### Read model

The current materialized view of orchestration state. In [the contracts][1], it holds projects, threads, messages, activities, checkpoints, and session state. See [ProjectionSnapshotQuery.ts][10] and [OrchestrationEngine.ts][7].

#### Reactor

A side-effecting service that handles follow-up work after events or runtime signals. Examples include [CheckpointReactor.ts][6], [ProviderCommandReactor.ts][12], and [ProviderRuntimeIngestion.ts][5].

#### Auto-settle

The optional behavior that settles a worktree thread after its pull request or merge request is
reported as merged. [PullRequestSettleReactor.ts][33] consumes subscription-gated remote status
updates, respects the server setting, and remembers which change request settled the thread so a
manual un-settle is not reversed for the same change request.

#### Receipt

A lightweight typed runtime signal emitted when an async milestone completes. See [RuntimeReceiptBus.ts][13].
Examples include `checkpoint.baseline.captured`, `checkpoint.diff.finalized`, and `turn.processing.quiesced`, which are emitted by flows such as [CheckpointReactor.ts][6].

#### Quiesced

"Quiesced" means a turn has gone quiet and stable. In [the receipt schema][13], it means the follow-up work has settled, including work in [CheckpointReactor.ts][6].

### Provider runtime

The live backend agent implementation and its event stream. The main service is [ProviderService.ts][14], the adapter contract is [ProviderAdapter.ts][15], and the overview is in [provider-architecture.md][16].

#### Provider

The backend agent runtime that actually performs work. See [ProviderService.ts][14], [ProviderAdapter.ts][15], and [CodexAdapter.ts][17].

#### Session

The live provider-backed runtime attached to a thread. Session shape is in [the orchestration contracts][1], and lifecycle is managed in [ProviderService.ts][14].

#### Adopted session

A Claude Code or Codex conversation that began in the provider's terminal UI and is attached to a new aqqua thread before its first turn. aqqua seeds the provider runtime binding with the external session's resume cursor and original cwd, then records one `session.resumed` activity. Earlier messages remain in the provider's transcript and are fetched lazily instead of being copied into aqqua's event log.

#### Runtime mode

The safety/access mode for a thread or session. In [the contracts][1], the main values are `approval-required` and `full-access`. See [runtime-modes.md][18].

#### Interaction mode

The agent interaction style for a thread. In [the contracts][1], the main values are `default` and `plan`. See [runtime-modes.md][18].

#### Agent model

One provider-instance/model pair an orchestrator can spawn on. Identity is the pair, not the slug: two instances advertising the same slug are separate rows. The catalog in [ModelCatalog.ts][36] is pure and snapshot-driven — it reads the same [`ServerProvider`][37] snapshots the UI renders, so it cannot go stale and adds no refresh, poll, or subscription. Rows that cannot be spawned right now are listed anyway, carrying the provider's own reason. See [agent-models.md][38].

#### Agent selection

What one spawn or one flow step asks for: an exact `instanceId + model`, plus an optional semantic `reasoning` level. The instance and model travel together, so half a selection is unrepresentable. With no model named, resolution falls back to the project's default selection (validated like any other), then to the first spawnable snapshot's own default model; with nothing spawnable it fails. `reasoning` is looked up against the chosen model's advertised reasoning descriptor and written onto that provider's native option id; omitting it leaves the provider's default in place. Resolution always launches a `session`. Defined in [ModelCatalog.ts][36], carried on a flow step by `BoardStepAgent` in [the board contracts][25].

#### Agent profile

A machine-local named preset of the provider target, model, runtime, runtime mode, interaction mode, and provider options used to start an agent. Superseded as the primary seam by the agent model catalog and kept as a **compatibility surface**: saved presets, flow steps persisted with `profileName`, and un-migrated `--profile` callers all still resolve through [Profiles.ts][39], and a `terminal`-runtime agent is reachable only here. Unlike an agent selection, a profile may target a _driver_ rather than an exact instance, and its model is not checked against what the instance advertises. Nothing is removed. Managed in Settings or with [`aqqua profile`][34]; see [agent-profiles.md][40].

#### Assistant delivery mode

Controls how assistant text reaches the thread timeline. In [the contracts][1], `streaming` updates incrementally and `buffered` delivers a completed result. See [ProviderService.ts][14].

#### Snapshot

A point-in-time view of state. The word is used in multiple layers, including orchestration, provider, and checkpointing. See [ProjectionSnapshotQuery.ts][10], [ProviderAdapter.ts][15], and [CheckpointStore.ts][19].

### Usage tracking

#### Usage ledger

The host-local SQLite read model built from Claude and Codex log files. Unlike an orchestration projection, its source of truth is external provider logs, so it has its own [repository][28], [migration][29], and rebuild lifecycle in [UsageScanner.ts][30]. It stores daily aggregates and per-file byte offsets; clearing it leaves the source logs untouched.

#### Rate-limit window

One provider-reported account quota period, such as five-hour or weekly, with a percentage used and optional reset time and duration. The normalized shape is defined in [the usage contracts][31]. [AccountRateLimits.ts][32] keeps the latest windows per provider instance in memory and streams semantic changes without adding them to thread activities.

### Checkpointing

Checkpointing captures workspace state over time so the app can diff turns and restore earlier points. The main pieces are [CheckpointStore.ts][19], [CheckpointDiffQuery.ts][20], and [CheckpointReactor.ts][6].

#### Checkpoint

A saved snapshot of a thread workspace at a particular turn. In practice it is a hidden Git ref in [CheckpointStore.ts][19] plus a projected summary from [ProjectionCheckpoints.ts][21]. Capture and lifecycle work happen in [CheckpointReactor.ts][6].

#### Checkpoint ref

The durable identifier for a filesystem checkpoint, stored as a Git ref. It is typed in [the contracts][1], constructed in [Utils.ts][22], and used by [CheckpointStore.ts][19].

#### Checkpoint baseline

The starting checkpoint for diffing a thread timeline. This flow is surfaced through [RuntimeReceiptBus.ts][13], coordinated in [CheckpointReactor.ts][6], and supported by [Utils.ts][22].

#### Checkpoint diff

The patch difference between two checkpoints. Query logic lives in [CheckpointDiffQuery.ts][20], diff parsing lives in [Diffs.ts][23], and finalization is coordinated by [CheckpointReactor.ts][6].

#### Turn diff

The file patch and changed-file summary for one turn. It is usually computed in [CheckpointDiffQuery.ts][20], represented in [the contracts][1], and recorded into thread state by [projector.ts][4].

### Flows

#### Flow

A per-project kanban definition whose user-defined columns are agentic steps between the built-in To-Do and Done. Each step is a prompt template, an agent selector, and a continuation mode (`auto` or `manual`). A step names its agent exactly one way: canonically through `agent` (an agent selection), or — for flows persisted before model-first orchestration — through the legacy `profileName`; both at once, or neither, is rejected by the schema. Canonical steps are validated against the running environment's catalog at step entry, not when the flow is saved, because a flow can be authored on one machine and run on another. Flows are represented internally by [the board contracts][25], executed by [BoardReactor.ts][26], and managed in the app or with [`aqqua flow`][35].

#### Card

One unit of flow work: one worktree plus one branch. Creating a card is cheap (no git activity); **releasing** it creates the worktree/branch and copies the flow definition as its **snapshot**, making in-flight cards immune to flow edits. Its **position** (To-Do, step, Done) moves only on successful step completion; its **status** (`running`, `paused`, `needs-input`, `failed`, `cancelled`) is an orthogonal badge that never moves the card.

#### Flow artifact

A step's output file on disk under the server state directory (`board-artifacts/<cardId>/<step>.md`), never inside the repository. Later steps receive earlier artifact paths only through explicit `${artifact}` / `${artifact:step}` placeholders. Path logic lives in [boardArtifacts.ts][27].

#### board_complete

The MCP completion signal a step's agent must call (`success` or `blocked`), hosted on the server's MCP toolkit next to preview. A turn that ends without it flags the card `needs-input`.

## Practical Shortcuts

- If you see `requested`, think "intent recorded".
- If you see `completed`, think "result applied".
- If you see `receipt`, think "async milestone signal".
- If you see `checkpoint`, think "workspace snapshot for diff/restore".
- If you see `quiesced`, think "all relevant follow-up work has gone idle".

## Related Docs

- [architecture.md][24]
- [provider-architecture.md][16]
- [runtime-modes.md][18]
- [workspace-layout.md][2]

[1]: ../packages/contracts/src/orchestration.ts
[2]: ./workspace-layout.md
[3]: ../apps/server/src/git/Layers/GitCore.ts
[4]: ../apps/server/src/orchestration/projector.ts
[5]: ../apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts
[6]: ../apps/server/src/orchestration/Layers/CheckpointReactor.ts
[7]: ../apps/server/src/orchestration/Layers/OrchestrationEngine.ts
[8]: ../apps/server/src/orchestration/decider.ts
[9]: ../apps/server/src/orchestration/commandInvariants.ts
[10]: ../apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts
[11]: ../apps/server/src/orchestration/Layers/ProjectionPipeline.ts
[12]: ../apps/server/src/orchestration/Layers/ProviderCommandReactor.ts
[13]: ../apps/server/src/orchestration/Services/RuntimeReceiptBus.ts
[14]: ../apps/server/src/provider/Layers/ProviderService.ts
[15]: ../apps/server/src/provider/Services/ProviderAdapter.ts
[16]: ./provider-architecture.md
[17]: ../apps/server/src/provider/Layers/CodexAdapter.ts
[18]: ./runtime-modes.md
[19]: ../apps/server/src/checkpointing/CheckpointStore.ts
[20]: ../apps/server/src/checkpointing/CheckpointDiffQuery.ts
[21]: ../apps/server/src/persistence/Services/ProjectionCheckpoints.ts
[22]: ../apps/server/src/checkpointing/Utils.ts
[23]: ../apps/server/src/checkpointing/Diffs.ts
[24]: ./architecture.md
[25]: ../packages/contracts/src/board.ts
[26]: ../apps/server/src/orchestration/Layers/BoardReactor.ts
[27]: ../apps/server/src/boardArtifacts.ts
[28]: ../../apps/server/src/persistence/Layers/UsageLedger.ts
[29]: ../../apps/server/src/persistence/Migrations/039_UsageLedger.ts
[30]: ../../apps/server/src/usage/UsageScanner.ts
[31]: ../../packages/contracts/src/usage.ts
[32]: ../../apps/server/src/usage/AccountRateLimits.ts
[33]: ../../apps/server/src/orchestration/Layers/PullRequestSettleReactor.ts
[34]: ../user/agent-profiles.md
[35]: ../user/agentic-board.md#managing-flows-from-the-cli
[36]: ../../apps/server/src/agent-control/ModelCatalog.ts
[37]: ../../packages/contracts/src/server.ts
[38]: ../user/agent-models.md
[39]: ../../apps/server/src/agent-control/Profiles.ts
[40]: ../user/agent-profiles.md
