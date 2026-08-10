# Provider architecture

The web app communicates with the server via WebSocket using a simple JSON-RPC-style protocol:

- **Request/Response**: `{ id, method, params }` → `{ id, result }` or `{ id, error }`
- **Push events**: typed envelopes with `channel`, `sequence` (monotonic per connection), and channel-specific `data`

Push channels: `server.welcome`, `server.configUpdated`, `terminal.event`, `orchestration.domainEvent`. Payloads are schema-validated at the transport boundary (`wsTransport.ts`). Decode failures produce structured `WsDecodeDiagnostic` with `code`, `reason`, and path info.

Methods mirror the `NativeApi` interface defined in `@aqqua/contracts`:

- `providers.startSession`, `providers.sendTurn`, `providers.interruptTurn`
- `providers.respondToRequest`, `providers.stopSession`
- `shell.openInEditor`, `server.getConfig`

Adapters live in `apps/server/src/provider/`: `CodexAdapter`, `ClaudeAdapter`, `CursorAdapter`,
`GrokAdapter`, `PiAdapter`, and `OpenCodeAdapter`, all behind the `ProviderAdapter` contract.
`ProviderDriverKind` is an open branded slug rather than a closed union, so an adapter can ship
without a contract change.

## Provider-native subagents

A provider harness may spawn nested agents that share the owner's real session. Those children have
no session of their own, so aqqua models them as display state rather than as a second control
plane.

A `ProviderRuntimeEvent` may carry an optional `providerSubagent` target (`childId`, optional
`parentChildId`, optional `title`). The event's `threadId` remains the aqqua **owner** thread — the
one holding the real session. `ProviderRuntimeIngestion` normalizes the target before projection:

1. Derive a deterministic child `ThreadId` from `ownerThreadId + provider + childId`
   (`providerSubagentChildThreadId` in `@aqqua/shared/providerSubagents`), so replay is idempotent
   and a deleted child is never resurrected by a later event reusing the same native id.
2. Materialize the child once, via a `thread.create` with a deterministic command id, inheriting the
   owner's project, model, modes, branch, and worktree. `parentThreadId` points at the owner, or at
   the deeper native child named by `parentChildId`.
3. Rewrite the event's `threadId` to the child and let it project normally.

The child carries a durable `ProviderSubagentBinding` (`ownerThreadId`, `provider`, `childId`,
`parentChildId`). That binding — not `parentThreadId` — is what distinguishes a native child from an
aqqua-managed sub-agent, which also has a parent but owns its session. Every read site, on the
server and in both clients, keys off `thread.providerSubagent`.

Command invariants reject session-authority commands aimed at a native child (`thread.turn.start`,
`thread.turn.interrupt`, message enqueue/submit/dequeue, `thread.session.stop`, runtime and
interaction mode changes, `thread.checkpoint.revert`) and model/branch/worktree fields on
`thread.meta.update`. Approval and user-input responses route in reverse to the owner's session and
stay allowed, as do rename, archive, snooze, settle, and delete. Client-side gating is additive
defence, not the enforcement point.

Codex and Claude report native children today. History predating observation is not imported. ACP is
not wired up: it awaits a released child-session contract.

## Client transport

`wsTransport.ts` manages connection state: `connecting` → `open` → `reconnecting` → `closed` → `disposed`. Outbound requests are queued while disconnected and flushed on reconnect. Inbound pushes are decoded and validated at the boundary, then cached per channel. Subscribers can opt into `replayLatest` to receive the last push on subscribe.

## Server-side orchestration layers

Provider runtime events flow through queue-based workers:

1. **ProviderRuntimeIngestion** — consumes provider runtime streams, emits orchestration commands
2. **ProviderCommandReactor** — reacts to orchestration intent events, dispatches provider calls
3. **CheckpointReactor** — captures git checkpoints on turn start/complete, publishes runtime receipts

All three use `DrainableWorker` internally and expose `drain()` for deterministic test synchronization.
