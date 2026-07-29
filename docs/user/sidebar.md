# Sidebar conversations and worktrees

The left sidebar can show conversations as a flat list or group them by worktree.

In worktree mode:

- Empty conversation groups use the selected base branch as their label.
- When **All projects** is selected and more than one repository has conversations, each
  repository gets its own collapsible section above its worktrees. Conversation cards inside
  these sections omit the repeated project folder label.
- Worktrees use summary cards with a branch name, conversation total, checkout type, and state:
  **Working** while a conversation is running, **Done** when conversations are idle but still
  active, and **Stale** when only drafts or settled history remain.
- Active conversations use shorter, flat rows so they read as children of the worktree card.
  Each one-line row shows the conversation name, provider icon, recent activity, and a persistent
  **Working**, **Done**, or **Stale** state. Recent activity hides when the sidebar narrows so
  the name, provider, and state remain legible. Branch, worktree, and project-folder labels stay
  on their containing sections instead of repeating inside conversation rows.
- A subtle guide connects each project to its worktrees and each expanded worktree to its
  conversations. Worktree summaries stay transparent at rest and use a surface only for hover
  feedback.
- Right-click a project or an existing worktree and choose **New conversation here** to open a
  draft in that location. Draft worktrees that have not been created yet do not offer this action.
- Repository and worktree sections can stay collapsed even when the open conversation is inside
  them. The same applies to sub-agent branches and the Snoozed and Settled shelves. Collapsing
  affects only the sidebar; it does not navigate away from the conversation or leave hidden rows
  in keyboard navigation and range selection.
- Settled conversations live in one shared **Settled** section below every worktree rather than
  inside individual worktree groups.

Secondary worktrees have a delete action in their header. T3 Code inspects the worktree and asks
for confirmation before making changes. Conversations that can be settled are unsnoozed when
needed and settled before the worktree is force-removed. Archived conversations are restored and
settled as part of the same cleanup so they cannot retain a deleted worktree path. If a
conversation is still running, waiting for attention, or cannot be settled by the connected
server, the worktree is kept.
The current project checkout cannot be deleted from this action. After removal, settled history
stays in the shared **Settled** shelf while the deleted worktree disappears from the hierarchy.
If the directory was already removed outside T3 Code, retrying the action cleans up the stale
sidebar entry.

Settled rows include selection checkboxes. Select multiple rows and use **Delete N** in the
Settled header to permanently delete those conversation histories. Deleting conversations cannot
be undone; deleting a worktree by its header keeps the conversations as settled history.
