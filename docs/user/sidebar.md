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
- In a project's **Project settings**, **Worktree origin branch** sets the origin branch used by
  that project's new worktrees when **Start from origin** is enabled. Leave it empty to follow the
  repository's default branch. The base branch picker can still override it for one worktree.
- Secondary worktrees have a delete button. Deleting archives their conversation history before
  removing the filesystem worktree; the project checkout itself cannot be deleted.
- A merged pull request is shown on its worktree card with its pull request number.

## Conversation tabs

The header tab strip contains the open conversations and drafts for the selected worktree.
Persisted conversation tabs have an **Archive** action; archiving a parent conversation archives
its sub-agent tree, while draft tabs cannot be archived.

An orchestrator keeps its open sub-agent conversations behind one numbered control. The control
opens a bounded popover, so a large delegation tree does not expand the tab strip.
When one of those sub-agents is open, the count control marks which family owns the conversation
being read.

### Two kinds of sub-agent

The two kinds deliberately use different navigation because they have different ownership.

- **aqqua-managed sub-agents** are spawned by aqqua (`aqqua agent`, or a flow step). Each one runs
  its own provider session, so it behaves like any other conversation: you can write to it, change
  its model, switch runtime and interaction modes, interrupt it, and revert its checkpoints.
- **Provider-native subagents** are spawned by the provider's own harness inside the parent's real
  session. They do not enter the conversation tab family. The owner conversation instead shows a
  compact **Native agent activity** surface below its tabs; use it to inspect a child's transcript
  while the owner tab remains selected. Opening a child shows a direct back-to-parent action and a
  short explanation where the composer would be. Send follow-ups from the owner conversation.
  Background shell tasks such as installs, formatters, and waits remain activity on the owner; only
  tasks that the provider identifies as agents appear in the native-agent surface.

A native subagent is not inert. Approval requests and multiple-choice questions raised inside it
stay answerable on its own conversation, and it archives, snoozes, settles, deletes, and renames
like any other thread. What it does not offer is anything that would claim ownership of a session
it does not have: sending, queueing, steering, interrupting, model or provider selection, branch or
worktree changes, runtime and interaction modes, and checkpoint revert.
Provider-health warnings stay on the owner conversation, where another turn can be sent, rather
than covering a native child's transcript. Errors reported by the child itself still appear there.

Codex and Claude are the providers that report native subagents today. Only work observed after
the feature is running appears — existing harness children are not imported retroactively.
Mobile keeps its flat list rather than nesting: a native subagent row names its provider, and in
the archive it also names the conversation that owns it.

Settled and snoozed conversations remain reachable through the header tabs and command palette.
New activity wakes or un-settles a conversation according to its lifecycle rules.
