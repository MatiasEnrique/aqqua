# Flows

Flows is a kanban-style workspace where each user-defined column is an agentic
step. You design a workflow once — steps with prompt templates, an agent
profile, and a continuation mode — and agents execute inside its rails. Use the
regular threads and Flows. The switch uses the selected project,
the current conversation's project, or the first visible project. Switching back
after entering Flows from a conversation or draft returns directly to it. You can
also open Flows via **Open Flows** in the command palette.

## Flows and steps

A flow belongs to a project. Between the built-in **To-Do** and **Done**
columns you define steps; each step carries:

- a **prompt template** with `${placeholder}` parameters,
- an **agent profile** (the same profiles used for sub-agents in Settings →
  Agent profiles),
- a **continuation mode**: `auto` advances the card on success, `manual` pauses
  it so you can review the step's artifact before continuing.

Editing a flow never changes cards that are already running: a card copies the
flow definition when you start it.

## Managing flows from the CLI

Use `aqqua flow` to create and manage flows without opening the web UI. The
command resolves the project that contains your current directory.

```sh
aqqua flow list
aqqua flow show "Ship a feature"
aqqua flow create --file flow.json
aqqua flow update "Ship a feature" --file flow.json
aqqua flow delete "Ship a feature"
aqqua flow schema
```

`show`, `update`, and `delete` accept either a flow id or an exact, unique flow
name. `update` replaces the flow's name and steps together; it does not patch
individual fields. `delete` marks the flow as deleted, so it disappears from
the active list.

Flow definition files are JSON. Run `aqqua flow schema` for the complete shape,
placeholder grammar, validation rules, and a canonical example:

```json
{
  "name": "Ship a feature",
  "steps": [
    {
      "name": "Plan",
      "profileName": "Planning",
      "promptTemplate": "Plan ${card_title}: ${request}"
    },
    {
      "name": "Implement",
      "profileName": "implementer",
      "promptTemplate": "Implement the plan:\n${artifact}",
      "continuation": "manual"
    }
  ]
}
```

Before saving, `create` and `update` require 1–20 steps, artifact-safe step
names that are unique ignoring case, and existing [agent profiles](./agent-profiles.md).
The first step cannot use `${artifact}`, and `${artifact:Step name}` must name
an earlier step exactly. Unknown profiles fail validation unless you pass
`--allow-unknown-profiles`, which saves the flow with a warning instead.

After a successful create or update, the command prints the parameters cards
on the flow will require. Add `--json` to any subcommand for machine-readable
output; `show --json` includes step ids and can be used as the starting point
for an update file.

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

In Flows the sidebar lists the selected flow's cards, grouped by urgency: **Needs
you** (paused, needs input, or failed), **Active** (running), **To-Do** (the
backlog, with Start inline), **Done**, and **Settled** at the bottom.
When active cards exist, opening a flow lands on the most urgent one. If the
flow contains only settled cards, its landing stays empty until you choose
**Settled** history. A card's
**position** (To-Do, a step, Done) is the segment track on its row and only
moves on successful step completion. Its **status** colors the dot and the
current segment and never moves the card:

| Badge       | Meaning                                                                              |
| ----------- | ------------------------------------------------------------------------------------ |
| Running     | The step's turn is in flight                                                         |
| Paused      | A `manual` step finished; review the artifact, then Continue                         |
| Needs input | The agent finished without reporting, reported blocked, or is waiting on an approval |
| Failed      | The turn errored, or the card's last operation failed                                |
| Cancelled   | You stopped the current step conversation; reply, retry, reset, or mark it done      |

Cancelling a card uses the same conversation interrupt as the regular chat view.
The card stays at its current step so you can reply to resume, retry it fresh,
reset the card, or mark the step done.

### Operations

Start, Continue, Retry, Reset, Archive, and Delete are **operations**: the server records
that it has taken the request, then does the work. While one is in flight the
card's badge says what is happening — Starting, Advancing, Retrying, Resetting,
or Deleting — and the card's own actions are unavailable, in the sidebar and in
the card's composer alike. The buttons close on click and reopen when the
operation lands, so one click is one operation.

If an operation fails, the card comes back with the reason printed under its
row and in the composer, and the action is available again.

## Artifacts

Steps write their output to markdown files kept outside your repository (under
the server state directory), so pipelines never dirty the working tree. Later
steps receive earlier artifacts only where the template says so — `${artifact}`
for the previous step's file, `${artifact:Step name}` for any earlier one.
Opening a card shows everything it owns: each step's conversation, the
sub-agents it spawned, its diff, and, after the step succeeds, its artifact.
Artifacts are not shown as drafts while the agent is still working. You can
edit a finished artifact in place; edits made while a card is paused are exactly
what the next step reads.

## Recovering a stuck card

Every path stays inside the model:

- **Chat** into the flagged step's conversation; when the agent reports done,
  the card advances normally.
- **Continue** advances a paused card — and doubles as "mark step done" on a
  stuck one.
- **Retry** discards the step's conversation and starts a fresh one from the
  same prompt and inputs.
- **Reset card** stops the current run, archives its step conversations, clears
  its artifacts, and returns the card to To-Do. Starting it again captures the
  latest flow configuration while keeping the card's worktree changes.

## Done, Settled, Archive, and Delete

Done keeps everything — worktree, branch, artifacts — so you can push
follow-ups from the step conversations. Settle a Done card to move it out of
the active flow and into reversible history; un-settling returns it to Done
without changing its worktree, threads, or artifacts. **Delete card** removes a
stable card from the flow and deletes its conversations, worktree, and artifact
directory. Running cards must be reset first, and a starting card must finish
starting before it can be reset, so cleanup cannot race an active agent. Commits
on the card's branch remain in the repository.

**Archive** is available after a Done card is settled. It removes the card's
conversations, worktree, and artifact directory before the card becomes finally
archived. The branch and its commits remain in the repository. Cleanup progress
is saved, so a failure stays visible as a cleanup receipt with its reason and
can be retried without repeating stages that already finished.

Delete also waits for cleanup. While it runs, the card remains as a **Deleting**
receipt/retry row instead of disappearing from every visible section. If cleanup
fails, the row shows the reason and Delete is available again; retry continues
the saved operation rather than starting destructive work over.
