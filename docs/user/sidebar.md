# Sidebar conversations and worktrees

The left sidebar can show conversations as a flat list or group them by worktree.

In worktree mode:

- Empty conversation groups use the selected base branch as their label.
- A collapsed worktree shows its total conversation count and, when applicable, the number of
  ongoing conversations.
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
