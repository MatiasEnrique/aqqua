# Agentic Board

The Agentic Board is a kanban board where each user-defined column is an agentic
step. You design the workflow once — steps with prompt templates, an agent
profile, and a continuation mode — and agents execute inside its rails. Open a
project's board from the board button on the project header in the sidebar, or
via **Open agentic board** in the command palette.

## Boards and steps

A board belongs to a project. Between the built-in **To-Do** and **Done**
columns you define steps; each step carries:

- a **prompt template** with `${placeholder}` parameters,
- an **agent profile** (the same profiles used for sub-agents in Settings →
  Agent profiles),
- a **continuation mode**: `auto` advances the card on success, `manual` pauses
  it so you can review the step's artifact before continuing.

Editing a board never changes cards that are already running: a card copies the
board definition when you start it.

## Cards

Creating a card is cheap — the creation form is generated from the union of
`${placeholders}` across all step templates, and the card lands in To-Do with
no worktree or git activity. A readable title is generated in the background
from the parameter values; until it arrives (or if it fails) the card keeps its
placeholder title.

Pressing **Start** releases the card: it gets its own worktree and branch, and
step 1 begins in a fresh top-level conversation you can open from the sidebar
like any other. Each step runs in a fresh conversation to keep context clean.

## Position and status

The board view is one table. A card's **position** (To-Do, a step, Done) is the
segment track on its row and only moves on successful step completion. Its
**status** is the badge beside the track and never moves the card:

| Badge       | Meaning                                                                              |
| ----------- | ------------------------------------------------------------------------------------ |
| Running     | The step's turn is in flight                                                         |
| Paused      | A `manual` step finished; review the artifact, then Continue                         |
| Needs input | The agent finished without reporting, reported blocked, or is waiting on an approval |
| Failed      | The turn errored                                                                     |
| Cancelled   | You cancelled the running step                                                       |

## Artifacts

Steps write their output to markdown files kept outside your repository (under
the server state directory), so pipelines never dirty the working tree. Later
steps receive earlier artifacts only where the template says so — `${artifact}`
for the previous step's file, `${artifact:Step name}` for any earlier one.
Opening a card shows everything it owns: each step's conversation, the
sub-agents it spawned, its diff, and its artifact, which you can edit in place.
Edits made while a card is paused are exactly what the next step reads.

## Recovering a stuck card

Every path stays inside the model:

- **Chat** into the flagged step's conversation; when the agent reports done,
  the card advances normally.
- **Continue** advances a paused card — and doubles as "mark step done" on a
  stuck one.
- **Retry** discards the step's conversation and starts a fresh one from the
  same prompt and inputs.
- **Cancel** interrupts the running turn and leaves the card in place.

## Done and Archive

Done keeps everything — worktree, branch, artifacts — so you can push
follow-ups from the step conversations. **Archive**, available only on Done
cards, deletes the card's worktree and artifact directory.
