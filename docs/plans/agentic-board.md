# Agentic Board

Status: implemented (v1 landed 2026-07-30; user doc: `docs/user/agentic-board.md`)

## Problem

The middle of a software-delivery pipeline (plan → implement → review → fix → PR)
requires the user's _presence_ but not their _thinking_: the prompts are identical
every run, only the inputs (e.g. a ticket id) change. Letting an AI improvise the
workflow (`$orchestrate`) drifts as context grows — agents get biased and steps
vary between runs.

The Agentic Board inverts this: the **human designs the workflow once**, and agents
only execute inside its rails. It is a kanban board where each user-defined column
is an agentic step. Interactive phases (spec grilling, ticket writing) are
deliberately out of scope — they belong in normal conversations.

## Core model

### Board

- Belongs to a **project**. Definition and card state are both persisted through
  the standard event → projection pattern (new events in
  `packages/contracts/src/orchestration.ts` domain style, new migration in
  `apps/server/src/persistence/Migrations/`, new `Projection*` service/layer pair).
- Columns: built-in **To-Do** (backlog) and **Done**, with user-defined **steps**
  in between.
- A step = **prompt template** + **agent profile reference** (reuses the existing
  `agentProfiles` settings system for driver/model/reasoning — no new model-config
  schema) + **continuation mode**: `auto` (default) or `manual`.
  - `auto`: successful completion advances the card immediately.
  - `manual`: successful completion pauses the card in place (`paused` status) so
    the user can review/edit the step's artifact before explicitly continuing.

### Card

- One card = one unit of work = **one worktree + one branch**.
- **To-Do is a backlog.** Creating a card is cheap — no worktree exists yet. The
  user explicitly **releases** a card (Start button / drag to first step), which
  creates the worktree+branch and enters step 1.
- **Concurrency is unlimited.** The user throttles by choosing what to release.
- **Snapshot at release:** the card copies the board definition when released.
  Board edits only affect cards released afterward; in-flight cards are
  deterministic and reproducible.
- **AI-generated title** at creation from the card's parameter values (small
  model; fallback: raw parameter values).

### Position vs status (orthogonal)

A card's **position** (To-Do | step _i_ | Done) only changes on successful step
completion — strictly linear, left-to-right, one pass, no loops in v1.

A card's **status** is a badge layered on top; it never moves the card:

| Status        | Trigger                                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `running`     | Step thread's turn is in flight                                                                                            |
| `paused`      | Step with `manual` continuation completed successfully — waiting for the user to review/edit the artifact and hit Continue |
| `needs-input` | Turn completed without `board_complete`, `board_complete({outcome: "blocked"})`, or a pending permission approval surfaced |
| `failed`      | Turn errored                                                                                                               |
| `cancelled`   | User hit Cancel (interrupts the running turn)                                                                              |

Example: a card that needs input during Implementation stays in the
Implementation column showing a needs-input badge. Same for failed/cancelled.

### Step execution

- Entering a column spawns a **fresh top-level thread** in the card's worktree
  with the rendered prompt. Fresh context per step is the anti-bias mechanism.
- Step threads are ordinary 3T threads: they appear in the sidebar, can spawn
  sub-agents via the existing `3T agent spawn` / `AgentControl` machinery
  (`parentThreadId` nesting), and support normal chat.
- Auto-advance is driven by a new **reactor** alongside the existing
  `apps/server/src/orchestration/Layers/*Reactor.ts` files, listening to
  `thread.turn-*` events plus the board MCP signal.

### Parameters

- **Inferred from templates:** the union of `${placeholder}` names across all
  step prompts generates the card-creation form (one field per variable).
- Reserved names (excluded from the form): `${artifact}`, `${artifact:<step>}`,
  built-ins such as `${card_title}`.

### Artifacts

- Artifacts are **files on disk**, not message payloads:
  `<stateDir>/board-artifacts/<worktree-id>/<step-name>.md`.
- Each step's prompt gets its **artifact output path injected**; the agent writes
  the file itself.
- Downstream steps receive artifacts **only via explicit placeholders** —
  `${artifact}` (previous step) or `${artifact:step-name}` (any earlier step) —
  which resolve to **paths**. The template is the complete, visible truth of what
  the agent sees; nothing is injected implicitly.
- Repo stays pristine (nothing to gitignore; the commit/PR step cannot
  accidentally commit a brief). Lifecycle owned by 3T.

### Completion signal

- New `board` toolkit on 3T's hosted MCP server (`apps/server/src/mcp/toolkits/`,
  next to `preview`): `board_complete({outcome: "success" | "blocked"})`.
- The step prompt template gets an injected instruction requiring the call.
- `success` on an `auto` step → advance to the next column (or Done). `success`
  on a `manual` step → `paused`; a user **Continue** action performs the advance.
  Anything else → status badge per the table above; the card does not move.
- While `paused`, the user can edit the artifact file (inline in the artifact
  viewer or in their editor); the next step reads whatever is on disk at
  continue time. A `manual` gate on the last step pauses before Done — same
  semantics, no special case.
- Known risk: agents occasionally won't call the tool. The needs-input fallback
  catches the miss; expect to tune the injected boilerplate early.

### Recovery

- **Chat into the thread:** open the flagged step's thread and talk to the agent
  ("the test failure is unrelated, proceed"). Its eventual `board_complete`
  resumes the flow normally.
- **Continue:** on a `paused` card, advances to the next step (after any manual
  artifact edits). Retry is also available while paused — e.g. the artifact is
  bad enough that re-running the step beats hand-editing.
- **Retry step:** discard that thread, spawn a fresh one from the same template
  and inputs.
- **Cancel:** interrupt a running step's turn → `cancelled`, card stays in place;
  recover via either path above.

### Done & cleanup

- Done = finished pipeline, not finished work. Worktree, branch, and artifacts
  are **kept** so PR follow-ups can be pushed from the step threads.
- Explicit **Archive** action deletes the worktree (existing
  `WorktreeDeletion` machinery) and the artifact directory.

## v1 scope

Core loop (define board → create card → release → steps run → artifacts flow →
Done) plus:

- Sub-agent tree in card detail (step threads + their spawned sub-agents, via
  existing `parentThreadId` nesting).
- Inline artifact viewer (render the markdown files from the state dir), with
  editing enabled at minimum for `paused` cards (the manual-continuation flow
  depends on it).
- Per-step continuation mode (`auto`/`manual`) in the board editor.
- AI-generated card titles.
- Buttons only for card actions (Start, Continue, Cancel, Retry, Archive) —
  auto-advance does the moving.

Deferred:

- Conditional routing / review↔fix loops (linear only in v1; add routing later
  without schema pain).
- Per-board concurrency caps and queued release.
- Auto-retry on transient failure (later: opt-in per-step setting).
- Board export/import / cross-project reuse (v1: duplicate board).
- Auto-archive on PR merge (via existing GitHub source-control integration).
- Drag-and-drop polish (`@dnd-kit` is already a dependency).
- Mobile/desktop parity (web first).

## Implementation touchpoints

- **Contracts:** new board/card types + events + commands in
  `packages/contracts/src/` (own module, orchestration-style); new WS RPCs in
  `packages/contracts/src/rpc.ts`.
- **Server:** migration `036_*` + `ProjectionBoard*` service/layer pair in
  `apps/server/src/persistence/`; decider/projector extensions; a board reactor
  in `apps/server/src/orchestration/Layers/`; `board` MCP toolkit in
  `apps/server/src/mcp/toolkits/`; artifact dir management under the state dir
  (`apps/server/src/config.ts` siblings: `attachments/`, `logs/`).
- **Client runtime:** board subscription/reducer in
  `packages/client-runtime/src/state/` (pattern: `shellReducer.ts`).
- **Web:** new TanStack route (board view per project), card detail panel,
  board/step editor with placeholder-aware template editing
  (`composer-logic.ts` trigger parsing is adjacent prior art), profile picker
  reusing `AgentProfileDialog` patterns.
