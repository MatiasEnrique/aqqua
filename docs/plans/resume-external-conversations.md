# Resume external Claude Code / Codex conversations

You own this task end to end. The analysis below is done and verified against the
codebase; the three product decisions are already settled by the maintainer. Build it.

Branch: `resume-conversations`. Do not open a PR unless the maintainer asks.

## What we are building

A `/resume` composer command that adopts a conversation started in the **Claude Code
TUI** or the **Codex TUI** into a new aqqua thread, so the next turn continues that
conversation with its full context.

Explicitly out of scope: listing conversations from other GUIs (Conductor, Cursor
Glass, aqqua itself) or from unrelated directories. The picker shows CLI-originated
conversations rooted in the active project only.

## Decisions already made (do not relitigate)

1. **History display** — reference + lazy transcript. One marker activity on the
   thread; the client fetches the transcript on demand and renders it through the
   ordinary message rows, so a resumed thread reads as one conversation. No bulk
   transcript over the websocket, no synthetic turns in the event log.
2. **Scope** — sessions whose cwd is the active project's workspace root or one of its
   aqqua-managed worktrees.
3. **Entry point** — draft (not-yet-created) threads only. An existing thread with a
   provider session is never re-pointed at a foreign session.

Assumption to carry unless told otherwise: the picker lists sessions for the
composer's currently selected provider instance, so provider/model selection stays
coherent and it is one RPC per open.

## Why this is small: the seam already exists

`ProviderService.startSession` reads `resumeCursor` **and** `cwd` from the persisted
`provider_session_runtime` binding whenever the caller does not pass one:

- `apps/server/src/provider/Layers/ProviderService.ts:562-572` — the fallback.
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:504-516` — a fresh
  thread calls `startProviderSession()` with no cursor, so the persisted one wins.

**Therefore: seed a binding row before the first turn and the thread resumes.** No
changes to the reactor, the decider, ingestion, or the projector.

Provider cursor shapes (built inside the adapter — never construct these client-side):

- Claude: `{ resume: sessionId, resumeSessionAt, turnCount }` —
  `apps/server/src/provider/Layers/ClaudeAdapter.ts:558-590`
- Codex: `{ threadId }` — `apps/server/src/provider/Layers/CodexSessionRuntime.ts:259-261`

The binding table has no FK (`apps/server/src/persistence/Migrations/004_ProviderSessionRuntime.ts`),
so a row can be seeded at thread-create time. Seed it with `status: "stopped"` —
`ProviderSessionReaper.ts:42` skips stopped bindings, while `startSession` still reads
the cursor off it.

## Discovery: filtering to "the CLI, in this directory"

Both providers can be filtered precisely. This is the core of the feature — get the
filters right and the rest is plumbing.

|        | source                                                                              | CLI-only filter                                                            | cwd filter                      |
| ------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------- |
| Codex  | `thread/list` over app-server (backed by `~/.codex/state_5.sqlite`, so it is cheap) | `sourceKinds: ["cli"]` — the enum separates `cli` / `vscode` / `appServer` | native `cwd` param              |
| Claude | `~/.claude/projects/<slugified-cwd>/<uuid>.jsonl`                                   | `entrypoint` field on user/assistant records                               | the directory name _is_ the cwd |

Verified on a real store: Claude sessions carry `entrypoint: "cli"` (TUI) vs
`"sdk-ts"` (aqqua, Conductor, Cursor, any SDK app). A survey of 40 project dirs found
59 `sdk-ts` and 15 `cli`. Record kinds present in a session file: `user`, `assistant`,
`attachment`, `system`, `queue-operation`, `last-prompt`. Relevant fields on `user`:
`parentUuid, isSidechain, promptId, type, message, uuid, timestamp, permissionMode,
promptSource, userType, entrypoint, cwd, sessionId, version, gitBranch`.

Codex `thread/list` params (see
`packages/effect-codex-app-server/src/_generated/schema.gen.ts:11552`):
`archived, cursor, cwd, limit, modelProviders, searchTerm, sortDirection, sortKey,
sourceKinds, useStateDbOnly`. `ClientRequest__ThreadSourceKind` is at line 1359.

Additional exclusions:

- Drop `isSidechain: true` (Claude subagent transcripts).
- Drop any session id already present in `ProviderSessionDirectory.listBindings()` —
  belt and braces so an aqqua-owned session never shows up as "external".

**Hard constraint:** a session can only be resumed in the cwd it was recorded under.
This is what makes the scoping requirement fall out for free rather than needing a
blocklist. If the target thread's cwd differs from the session's cwd, either set the
thread's `worktreePath` to the session cwd or refuse — do not silently resume elsewhere.

## Step 0 — smoke check before writing any feature code

The whole plan rests on this. Budget ~30 minutes.

1. Confirm the Claude Agent SDK's `resume` accepts a session id the **CLI** wrote
   (same `~/.claude/projects` store, same binary — expected to work, since
   `ClaudeAdapter` passes `resume` straight through to the SDK query options at
   `ClaudeAdapter.ts:3572`).
2. Confirm `thread/resume` works against a `sourceKind: "cli"` Codex thread.

If either fails, that provider drops to read-only in the picker (listed, not
resumable, with a clear reason). Report the result before continuing.

## Step 1 — Contracts (`packages/contracts`)

Schema only, no runtime logic.

`src/server.ts`, next to the existing `ProviderListSkills*` block (line ~585, which is
the template to copy including the doc comment style and the tagged error):

```text
ProviderExternalSession   { sessionId, title, cwd, updatedAt, messageCount, gitBranch? }
ProviderListSessionsInput { instanceId, cwds }        // array: root + worktrees
ProviderListSessionsResult { sessions, supported }
ProviderListSessionsError                              // tagged, like ProviderListSkillsError
ProviderReadSessionInput / ProviderReadSessionResult   // lazy transcript
```

`src/orchestration.ts`: add `resumeSession: { instanceId, sessionId }` to
`ThreadTurnStartBootstrap` (line ~753), as a sibling of `prepareWorktree`.

`src/rpc.ts`: two `Rpc.make` entries + `WS_METHODS` keys, mirroring
`WsProviderListSkillsRpc` at line 341 and `providerListSkills` at line 279.

## Step 2 — Server discovery (`apps/server/src/provider`)

- **New** `Drivers/ClaudeSessions.ts`. Model it directly on `Drivers/ClaudeSkills.ts`:
  best-effort filesystem scan, unreadable roots and malformed entries skipped, never
  degrades the caller. Reuse `resolveClaudeConfigDirPath`'s precedence logic
  (instance `homePath` → ambient `CLAUDE_CONFIG_DIR` → `~/.claude`) — extract it if
  that is cleaner than duplicating. Slugify each cwd, read the dir, parse each JSONL's
  head and tail, keep `entrypoint === "cli" && !isSidechain`. Title from the first user
  message; `updatedAt` from mtime so you do not read whole files to sort.
- **New** `listCodexSessions` in `Layers/CodexProvider.ts` — a clone of `listCodexSkills`
  (line 441): short-lived app-server client via `withCodexAppServerClient`, then
  `thread/list` with `{ cwd, sourceKinds: ["cli"], useStateDbOnly: true, limit }`.
  Map failures to the declared wire error; an empty success list must never stand in
  for a broken binary or auth (same rule the skills path documents).
- `ProviderDriver.ts:87` — add `listSessions` and `readSession` to `ProviderInstance`,
  alongside `listSkills`. **Make a per-driver decision, even if it is "no":**
  Claude and Codex implement; Cursor, Grok and OpenCode return empty with
  `supported: false` so the picker can say "not supported here" rather than
  "none found".
- Cursor construction belongs on the instance (`makeResumeCursor(sessionId)`), so the
  Claude-vs-Codex cursor shape never leaks past the adapter boundary. Complexity at the
  adapter boundary; orchestration stays pure.
- `apps/server/src/ws.ts` — two handlers next to `providerListSkills` (line 1532), which
  is the exact template: resolve the instance from `providerInstanceRegistry`, fail with
  the tagged error when it is missing.

## Step 3 — Server adoption (`apps/server/src/ws.ts`)

In `dispatchBootstrapTurnStart` (line 1052), after the `thread.create` dispatch and
before the final turn-start dispatch, handle `bootstrap.resumeSession`:

1. `providerSessionDirectory.upsert({ threadId, providerInstanceId, status: "stopped",
resumeCursor: instance.makeResumeCursor(sessionId), runtimePayload: { cwd: sessionCwd } })`
2. Dispatch one `thread.activity.append` (an existing internal command — see
   `packages/contracts/src/orchestration.ts:972`) with `tone: "info"`,
   `kind: "session.resumed"`, payload `{ provider, sessionId, messageCount, boundaryUuid }`.

The existing `cleanupCreatedThread()` rollback at line 1113 already covers failure.
**No new event type, no new reactor, no synthetic turns.**

## Step 4 — Web (`apps/web/src`)

- `components/chat/ChatComposer.tsx:1105` — add `/resume` to `builtInSlashCommandItems`,
  gated on the thread being a local draft. Dedupe against provider slash commands of the
  same name; built-ins win.
- `components/chat/ChatComposer.tsx:1753` — `/resume` follows the `/model` branch
  exactly: clear the trigger text, then open a picker
  (`setIsComposerResumePickerOpen(true)` mirroring `setIsComposerModelPickerOpen`).
- **New** `components/chat/ComposerResumePicker.tsx` — model on `ModelPickerContent.tsx`.
  Grouped by provider, searchable, relative timestamps, cwd badge when it is not the
  project root.
- Selection lands in `composerDraftStore` beside the model selection, surfaced as a
  removable chip in `ComposerBannerStack`. Reverse states matter: if you added a way in,
  add the way out and the way to see it.
- `components/ChatView.tsx:5104` — thread `bootstrap.resumeSession` through alongside
  `createThread` / `prepareWorktree`.
- `components/chat/MessagesTimeline.tsx` — render the `session.resumed` activity as a
  collapsed **"Earlier conversation (N messages)"** block; expanding calls
  `provider.readSession`. Nothing large crosses the websocket unless the user asks.
  `boundaryUuid` splits pre-aqqua from aqqua turns, since Claude keeps appending to the
  same JSONL after resume.

## Step 5 — Mobile (`apps/mobile/src/features/threads`)

`ThreadComposer.tsx:392` mirrors the web item list one-for-one today; add the same entry
plus a picker screen in the new-task flow (`NewTaskDraftScreen.tsx`). Put the shared
query in `packages/client-runtime/src/state/providerSessions.ts`, copied from
`providerSkills.ts`'s `createEnvironmentRpcQueryAtomFamily` usage, so web and mobile
share fetching and caching.

## Step 6 — Tests

Backend behavior changes ship with focused tests. Wait on receipts and worker drains,
never on sleeps or polling.

- `ClaudeSessions.test.ts` — fixture store covering `cli` vs `sdk-ts` vs sidechain vs
  malformed JSONL vs a session id already owned by an aqqua binding.
- `CodexDriver` — assert the `thread/list` params. The `sourceKinds` / `cwd` filter
  **is** the feature; a test that does not pin it is not testing anything.
- ws integration — bootstrap with `resumeSession` seeds the binding, appends the marker,
  rolls back cleanly on failure; a following turn starts with the right cursor.
- `ChatComposer` — `/resume` offered only for drafts; accepting opens the picker.

Run only the tests you touched plus targeted lint/typecheck for the scope you changed.
**Do not run repo-wide checks** (`vp check`, `vp run -r test`, `vp run -r typecheck`) —
CI owns the full suite.

## Step 7 — Docs

- `docs/reference/encyclopedia.md` — new vocabulary: _adopted session_.
- `docs/user/` — a short page on resuming CLI conversations.
- `docs/providers/claude.md` and `docs/providers/codex.md` — discovery locations and the
  filter rules, so the next person does not have to rediscover `entrypoint`.

## Sequencing

0 → 1 → 2 → 3 (backend resumes end to end, provable by test) → 4 → 5 → 6/7.
Steps 2 and 4 parallelize once contracts land.

## Risks to handle, not discover

- **`entrypoint` is undocumented** and could change shape in a Claude Code release. The
  scan must degrade to "no sessions found", never to an error or a defect.
- **`thread/list` on a large `state.sqlite`** must stay paged (`limit`) and off any
  render path. `useStateDbOnly: true` avoids a JSONL rescan.
- **`/resume` name collision** with a provider-supplied slash command of the same name.
- **cwd mismatch** between the session and the target thread — refuse or retarget
  explicitly; never resume into the wrong directory.

## Repo rules that will bite you

- Read `.repos/effect-smol/LLMS.md` and `docs/operations/effect-fn-checklist.md` before
  writing Effect code in `apps/server`.
- Never `pkill -f` / `pgrep | kill`. Kill only a PID you captured at spawn.
- `~/.aqqua/userdata` is the maintainer's live database, in use right now. Read-only
  inspection only. Seed this worktree's `.aqqua` from `~/.aqqua/dev` if you need data.
- Do not launch browsers or computer use without explicit permission.
- Hit every surface: entry points, clients (web/desktop/mobile), providers, contracts,
  reverse states, connection modes, docs. Say which applied when you report back.
