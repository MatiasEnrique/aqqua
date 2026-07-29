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
- Repository and worktree sections can stay collapsed even when the open conversation is inside
  them. Collapsing affects only the sidebar; it does not navigate away from the conversation.
- Settled conversations live in one shared **Settled** section below every worktree rather than
  inside individual worktree groups.

Secondary worktrees have a delete action in their header. T3 Code inspects the worktree and asks
for confirmation before making changes. Conversations that can be settled are unsnoozed when
needed and settled before the worktree is force-removed. If a conversation is still running,
waiting for attention, or cannot be settled by the connected server, the worktree is kept.
The current project checkout cannot be deleted from this action.

Settled rows include selection checkboxes. Select multiple rows and use **Delete N** in the
Settled header to permanently delete those conversation histories. Deleting conversations cannot
be undone; deleting a worktree by its header keeps the conversations as settled history.
