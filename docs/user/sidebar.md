# Sidebar conversations and worktrees

The left sidebar can show conversations as a flat list or group them by worktree.

On web and desktop, the regular sidebar is the flat Sidebar V2 from the original T3 Code repo.
Enable **Settings → Beta → Worktree view** to use the worktree-aware sidebar described below
instead. The worktree view is opt-in in every build — nightly and local dev builds start on the
regular sidebar too, and only your own choice in Settings turns it on. Mobile keeps its separate,
device-local **Thread List v2** preference and is not changed by the web/desktop sidebar switch.

Both sidebars are the same implementation with different grouping: the regular sidebar is always
flat, while **Settings → Appearance → General → Group threads by worktree** shapes the worktree view
(and can flatten it without leaving the beta).

In worktree mode:

- Empty conversation groups use the selected base branch as their label.
- When **All projects** is selected, every repository gets its own collapsible section above its
  worktrees. Project sections remain visible when they have no conversations and when only one
  project currently has active work. Conversation cards inside these sections omit the repeated
  project folder label.
- Worktrees use summary cards with a branch name, checkout type, and a colored counter for every
  nonzero state: blue **Working**, violet **Needs input**, green **Done**, gray **Stale**, and yellow
  **Settled**. There is no separate total-conversation counter. Pending user input and pending
  approvals both count as Needs input, so one worktree can report several states without hiding
  any of them. Hover the colored state counters for the same breakdown with readable labels and
  descriptions. The rest of the worktree card does not open this detail. Settled-only cards have
  no expand affordance because their conversations already live in the shared Settled shelf.
- Active conversations use shorter, flat rows so they read as children of the worktree card.
  Each one-line row shows the conversation name, provider icon, recent activity, and a persistent
  **Working**, **Done**, or **Stale** state. Recent activity hides when the sidebar narrows so
  the name, provider, and state remain legible. Branch, worktree, and project-folder labels stay
  on their containing sections instead of repeating inside conversation rows. The check button
  settles that conversation without deleting its history.
- A subtle guide connects each project to its worktrees and each expanded worktree to its
  conversations. Worktree summaries stay transparent at rest and use a surface only for hover
  feedback.
- Right-click a project or an existing worktree and choose **New conversation here** to open a
  draft in that location. Project menus also offer **New worktree here**, which opens the standard
  new-worktree conversation dialog with that project preselected. The branch-plus button at the
  end of each project row opens that dialog directly.
- Each project row shows one compact status icon. It prioritizes **Needs input**, then
  **Working**, **Done**, and **Settled**; projects with only stale conversations (or no
  conversations) show **Idle**. The same icon language is used on worktrees and conversations.
  Draft worktrees that have not been created yet do not offer these actions.
- Repository and worktree sections can stay collapsed even when the open conversation is inside
  them. The same applies to sub-agent branches and the Snoozed and Settled shelves. Collapsing
  affects only the sidebar; it does not navigate away from the conversation or leave hidden rows
  in keyboard navigation and range selection.
- Settled conversations live in one shared **Settled** section below every worktree rather than
  inside individual worktree groups. These history rows omit the extra project/message glyph.

The worktree three-dot menu contains only **Settle all** and **Delete**. Snoozed conversations are
woken first; no conversations to settle, running conversations, or conversations waiting for
attention keep the batch action disabled. Settling preserves every conversation in the shared
**Settled** shelf.

Secondary worktrees can use **Delete** from the same menu. aqqua inspects the worktree and asks
for confirmation before permanently deleting both the filesystem worktree and its live, settled,
and archived conversations. Deleted conversation history does not appear in **Settled**. The
confirmation also offers an unchecked **Also delete local branch** option; selecting it removes
the exact inspected local branch after the worktree, while remote branches are always preserved.
The current project checkout shows the action disabled. If the directory was already removed
outside aqqua, retrying the action deletes its remaining conversation history, leaves any
unverified directory untouched, and cleans up the stale sidebar entry.

## The Settled shelf

Both sidebars share one Settled shelf, and it behaves identically in each — conversations and
sub-agents are supported the same way everywhere.

- Settled rows carry selection checkboxes, and **Delete N** appears in the Settled header once
  anything is selected. Deleting conversations cannot be undone.
- Settling an orchestrator settles its whole delegation: the sub-agents follow it out of the inbox
  and fold underneath it, represented by a count next to the row. Click the count to expand them.
  The **Settled** header count and **Show more** count orchestrators too, so a delegation that
  fanned out to ten sub-agents settles as `1`, not `11`. Un-settling the orchestrator brings the
  whole family back — nothing is settled on the server but the orchestrator itself.
- A sub-agent that is snoozed in its own right keeps its return date and stays on the **Snoozed**
  shelf. A snoozed orchestrator does not take its sub-agents with it; they stay in the inbox until
  it wakes.
- Opening a settled sub-agent (by deep link or search) expands its orchestrator and pulls the
  whole group onto the page, so the open conversation is never hidden behind **Show more**.
