# Sidebar conversations and worktrees

The left sidebar can show conversations as a flat list or group them by worktree.

On web and desktop, the regular sidebar is the worktree-aware view described below. Enable
**Settings → Beta → Sidebar v2** to use T3 Code's original flat Sidebar V2 instead. Mobile keeps
its separate, device-local **Thread List v2** preference and is not changed by the web/desktop
sidebar switch.

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

Secondary worktrees can use **Delete** from the same menu. T3 Code inspects the worktree and asks
for confirmation before permanently deleting both the filesystem worktree and its live, settled,
and archived conversations. Deleted conversation history does not appear in **Settled**. The
current project checkout shows the action disabled. If the directory was already removed outside
T3 Code, retrying the action deletes its remaining conversation history and cleans up the stale
sidebar entry.

Settled rows include selection checkboxes. Select multiple rows and use **Delete N** in the
Settled header to permanently delete those conversation histories. Deleting conversations cannot
be undone.
