# Flows — UI prototypes (throwaway)

Status: exploration, 2026-07-30. Three divergent Paper mocks of the board surface
(feature spec: `agentic-board.md`). Paper file "3T Code":
https://app.paper.design/file/01KYSJ1ATPD1QRHJNGPSXPPG0P/1-0

Question being answered: what layout best expresses "position = pipeline column,
status = badge in place", and where does card detail live (drawer vs inline
expansion vs permanent pane)?

All three are dark mode using the app's real `@variant dark` tokens from
`apps/web/src/index.css`: bg `neutral-950`, card `#111` (bg 97% + white),
popover `#191919`, borders `white/6%`, muted surfaces `white/4%`,
muted-foreground `#828282`, primary `oklch(0.588 0.217 264)`, and the badge
recipe `{semantic}/16%` fill + `{semantic}-400` text (info/warning/error/
success). Type: DM Sans + JetBrains Mono; buttons 32px h / 10px radius /
font-medium.

## V1 — Kanban rail + inspector drawer

Classic columns (To-Do backlog dashed, numbered steps with agent-profile chips,
Done). Status badges rendered on cards in place; detail is a right overlay
drawer: step timeline → sub-agent tree → agent ask + reply → artifact viewer →
actions. Closest to familiar kanban; drawer hides the Done column at 1440px.

## V2 — Run table

(Replaces the first "pipeline ledger" attempt, which was too noisy: three
280px-wide lane boxes per row, mostly empty dashed placeholders, and an inline
expansion that broke the column grid.)

Now a real table. Two adjacent columns make the orthogonality literal:
**position** = a 3-segment track (emerald done / status-colored current /
white-8% not reached), **status** = a single badge next to it. Then elapsed·cost
and one action per row. To-Do and Done are the same table under their own
section headers — To-Do rows have an empty track and a Start button, Done rows
a full emerald track and Archive. Densest of the three, perfect vertical lanes.

## V3 — Mission control split

Triage-first master/detail: left rail grouped by NEEDS YOU / ACTIVE / TO-DO /
DONE with mini step-meters; right pane is permanent card detail — horizontal
step nodes with artifact chips flowing between them, flagged-step thread with
reply box, tabbed artifact viewer. Best for "what needs me now"; weakest at
showing the whole board's column distribution.

## V2 iterations — threads, artifacts, and human intervention

V2 won the board layout. These three explore what's _behind_ a row. They are
complementary, not exclusive — A is the page, B is the overlay, C is the file.

- **V2-A · Drill-down.** Card detail reuses the table grammar one level down:
  one row per step (step, thread title, agent profile, artifact chip, status,
  time·cost), sub-agent threads as indented child rows with disclosure
  triangles. Artifacts are chips in their own column. Intervention is an inline
  block pinned under the waiting step: the question, a composer that continues
  that thread, and `Send & resume` / `Retry step fresh` / `Mark step done,
advance` / `Cancel card`.
- **V2-B · Peek overlay.** `esc`-dismissable panel over the board (Linear peek),
  `↑`/`↓` moves between cards without closing. Step tabs across the top, the
  step thread transcript below (rendered prompt → agent turns → sub-agent tree
  inline), artifact chip top-right. Shown on a _running_ step to cover
  unsolicited intervention: the composer says `Interrupt & send`, plus
  `Pause after this step`. This is how you barge in when nothing asked you to.
- **V2-C · Artifact view.** Artifacts as documents, not attachments. Left rail
  lists them by producing step; the doc gets a provenance bar — _written by
  2 · Implement → read by 3 · Review as `${artifact}`_ — making the handoff
  contract visible. Because artifacts are files on disk and the step is paused,
  the human intervention here is `Edit artifact` then `Resume step 3`: fix the
  handoff instead of arguing with the agent.

Intervention taxonomy these cover: **agent asks** (A's inline block), **human
barges into a running turn** (B's interrupt), **human edits the handoff**
(C's artifact edit). Plus the existing board-level `Retry step` / `Cancel`.

## V3 iterations — keep the rail, redo the main pane

The V3 left rail (NEEDS YOU / ACTIVE / TO-DO / DONE with mini step-meters) is
the keeper; the original main pane — horizontal step-node strip, half-empty
thread box, co-equal artifact box — is not. Three replacements, same rail, same
fixture card, structurally different primary objects:

- **V3-i1 · Thread desk.** The step thread transcript is the hero, full height.
  Steps collapse into a 248px vertical sub-rail (status dot, agent · model,
  time · cost, artifact chip, sub-agents indented, `Done` terminal). Artifacts
  appear inline in the transcript — the rendered prompt shows its
  `${artifact}` placeholders and the chips they resolved to; the written
  `review.md` is a chip in the turn that produced it. Composer pinned bottom:
  `Send & resume` plus retry / edit-artifact / mark-done / cancel.
- **V3-i2 · Step ledger + dock.** V2's run-table idiom one level down: one row
  per step, sub-agent threads as indented child rows, fixed lanes for agent
  profile, artifact, status, time · cost. A `3 steps` progress line states the
  orthogonality outright ("position: step 3 of 3 · status: needs input · the
  card has not moved"). A 320px bottom dock previews the selected row —
  Thread / Artifact / Rendered prompt tabs, transcript tail, composer, and an
  "other ways in" column for the non-chat interventions.
- **V3-i3 · Artifact desk.** `review.md` rendered as a document with a
  provenance bar (written by 3 · Review, reading 2 · Implement as
  `${artifact}`), findings split into "needs your call" and "minor", and an
  on-disk footnote explaining why it lives outside the repo. The thread
  collapses to a 320px right rail: artifact trail, sub-agent digest, the
  pending question, reply box. Bottom bar: edit the artifact, then resume.

## V3-i1 iteration — the middle rail is a card tree, the right pane is one slot

V3-i1 won. The middle column stops being a read-only step summary and becomes a
selectable tree of everything the card owns; the right pane is a single detail
slot that renders whatever is selected, using the thread patterns 3T already
has. Three states, same layout:

- **V3-i1a · step thread selected** — rendered prompt (with the `${artifact}`
  placeholders and the chips they resolved to), agent turns, sub-agent tree
  inline, the pending question, composer = `Send & resume`.
- **V3-i1b · sub-agent thread selected** — the sub-agent's own thread: the
  spawn prompt from the parent (tagged `parentThreadId`), its tool reads, its
  findings, and a `returned to 3 · Review` turn. Composer is deliberately
  weaker — `Send`, plus "this thread has already returned; new turns won't move
  the card" and `Re-run sub-agent`. Position only ever changes at the step.
- **V3-i1c · artifact selected** — same conversation shape as the thread states:
  entries down the pane, composer at the bottom. The entries are `3 · Review
wrote this file · 6m ago` (with the `implement.md as ${artifact}` chip), the
  document itself as a live-editable card (`editable — type anywhere` / `Saved`
  in its bar, caret in the text), then `you · just now — added a note…`. The
  composer asks the agent for a change (`drop the two flagged findings, keep the
minors`); typing in the document does the same thing without spending a turn.
  `Resume step 3` sits beside the hint. No edit mode, no save button.

Card actions live in the composer's primary-action slot, reusing the pattern
`ComposerPrimaryActions` already has (send → stop → the `Implement ⌄` split
button). On a waiting step the slot becomes a `Resume ⌄` split button; its menu
holds `Resume step`, `Retry step fresh`, `Mark done, go to Done`, and a
destructive `Cancel card`. Typing turns the primary into `Send & resume`; while
a turn is in flight it is the existing red stop button, which is also how you
cancel a running step. Sub-agent threads keep the plain send arrow — they can't
move the card, only the step can.

Chrome is the app's, unchanged: the 52px top bar (`t3code / <card title>`,
Setup Worktree / Open / Commit & push split buttons, the five panel toggles) and
nothing else — no board-specific header, no per-selection sub-header. The rail
already says what's selected and what its status is.

The detail pane is the app's existing chat surface, unchanged: right-aligned
user bubble (`bg-accent`, 18px radius, 12px padding, 80% max width), bare
left-aligned assistant text at `text-foreground/80`, 12px work rows with a 20px
icon slot and a trailing check, 768px centred column. The step prompt is the
user message; sub-agent spawns and file writes are work rows. Selecting an
artifact renders its markdown in the same message column — nothing else, no
card, no chrome.

The composer is the app's real `ChatComposer`, not a bespoke one: 22px glass
shell (`#101010` at 80% over neutral-950, 1px `rgba(255,255,255,0.05)` inset
border, no focus ring), 70px min-height editor, placeholder _"Ask anything,
@tag files/folders, $use skills, or / for commands"_, toolbar with the model
picker and runtime-mode control (28px, 10px radius, transparent until hover),
and the 32px circular `bg-primary/90` send button with its inline up-arrow. It
is identical in all three states — including over an artifact, where sending
asks the agent to rewrite the file. Step actions (`Retry step`, `Resume step 3`)
live in the detail header, not around the composer.

Icons come from the app's own map
(`apps/web/src/components/sidebar-v2/SidebarStatusPresentations.tsx`):
`CircleCheckIcon` done, `CircleAlertIcon` needs-input, `CircleDashedIcon`
working, `ClockIcon` idle/not-reached. Colors stay on the board's badge recipe
(amber for needs-input) rather than the sidebar's violet. Steps carry a
chevron and collapse — step 1 is shown collapsed so the affordance is visible.

Tree grammar: steps are top-level rows (status dot, name, elapsed · cost);
children are leaves at one indent — sub-agent threads (small status dot, elapsed),
the step's diff (`14 files changed · +214 −31`), and its artifact (file icon,
mono name, size or `draft`). Threads and artifacts are the same kind of thing to
the tree, which is what makes one detail slot work. The leaf set is the
extension point: permission requests, per-step rendered prompt, and the PR could
all be leaves later without touching the layout.

## Verdict

Decided 2026-07-30. **Board surface: V2 Run table** (position = segment track,
status = badge beside it; To-Do and Done as sections of the same table — this
doc's description is the spec, the exploration artboards were cleaned up).
**Card detail: V3-i1 as refined above** — card tree + single detail slot on the
app's existing chat surface; the three dark artboards on the canvas
(V3-i1a/b/c: step thread / sub-agent thread / artifact selected) are the design
source and all ship as selection states. Implementation is broken down in
`agentic-board-tickets.md`; keep this file and the three artboards until the
UI lands.
