# Sidebar conversations and worktrees

On web and desktop, the sidebar is a registry of projects and worktrees. Each worktree appears as
one card; its conversations appear as tabs below the chat header. This is the only sidebar layout.
Settings routes use their dedicated section navigation sidebar.

Mobile uses its separate native thread list and device-local preferences.

## Projects and worktrees

- Use the project scope control to show all projects or narrow the registry to selected projects.
- Projects group their worktree cards and can be collapsed independently.
- Each worktree card shows its branch, checkout type, and highest-priority conversation state.
  Pending approvals or user input take priority over working, done, stale, and settled work.
- Terminal **Done** or **Failed** status remains visible until the relevant conversation is opened.
  Live **Working** and **Needs input** status remains until the underlying condition changes.
- Selecting a worktree opens its most relevant conversation or draft. For an empty worktree, the
  selection remains active so a new conversation can be created there.
- Worktrees start in creation order, oldest first. Drag a card by its grip to save a custom order;
  worktrees remain within their project while being rearranged.
- Right-click a project or worktree to create a conversation in that location. Project menus also
  offer **New worktree here**.
- Secondary worktrees have a delete button. Deleting archives their conversation history before
  removing the filesystem worktree; the project checkout itself cannot be deleted.
- A merged pull request is shown on its worktree card with its pull request number.

## Conversation tabs

The header tab strip contains the open conversations and drafts for the selected worktree.
Persisted conversation tabs have an **Archive** action; archiving a parent conversation archives
its sub-agent tree, while draft tabs cannot be archived.

An orchestrator and its open sub-agent conversations share one family tray. Use the numbered
sub-agent control to collapse or expand that tray. When an open sub-agent is inside a collapsed
family, the count control marks that the conversation being read is folded into it. Collapse state
belongs to the current window and is forgotten when the orchestrator leaves the tab strip.

Settled and snoozed conversations remain reachable through the header tabs and command palette.
New activity wakes or un-settles a conversation according to its lifecycle rules.
