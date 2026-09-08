# Sidebar conversations and worktrees

On web and desktop, the sidebar groups conversations by project and worktree. Use the navigation
rows at the top to start a thread, return to threads, or open Flows. Search threads and commands
from the search control at the top of the sidebar, or press **⌘K** (**Ctrl+K** on Windows/Linux).
The conversation bar contains open tabs. Individual icons at the top of the right activity
rail open the editor picker, run or add project actions, open Git actions, and start a new thread
in the project. Icons with multiple choices open a popover. Git actions always includes Pull;
when unavailable, it stays visible with a hover explanation. The interface uses IBM Plex Sans; code and terminals keep IBM Plex Mono.
A compact footer spans the desktop workspace below the rounded content area, with Usage and
Settings icons on the left. Narrow windows keep
Usage and Settings in the sidebar.
Settings routes use their dedicated section navigation sidebar.

Mobile uses its separate native thread list and device-local preferences.

## Projects and worktrees

- Use the project picker to show all projects or select several. Selection survives reload and app
  relaunch. Each open window can keep its own selection; reconnecting an environment restores its
  selected projects. While every selected project is unavailable, the picker keeps the filter and
  labels it **Selected projects unavailable** instead of exposing unrelated projects.
- Projects group their worktrees and can be collapsed independently. Worktree headings use branch
  names; conversation titles and activity appear beneath them. Opening a conversation expands its
  containing project.
- Expand or collapse a worktree with the chevron beside its heading. This preference survives
  reloads. Selecting the heading or opening a conversation does not change it.
- Each worktree shows its highest-priority conversation state.
  Pending approvals or user input take priority over working, done, stale, and settled work.
- Terminal **Done** or **Failed** status remains visible until the relevant conversation is opened.
  Live **Working** and **Needs input** status remains until the underlying condition changes.
- Selecting a worktree opens its first active conversation. When no active conversation exists, it
  resumes a draft if available. With neither an active conversation nor a draft, selecting the
  worktree creates a new conversation there, even when it has snoozed or settled history.
- Conversations show their branch and recent activity below the title. Hover or activate a parent
  conversation to open its subthreads in a popover. Subthreads do not add nested sidebar rows. On narrow screens, tapping a parent
  opens the picker with an **Open parent conversation** action. Snoozed conversations are labeled;
  recent settled conversations appear in the **Settled** shelf.
- Hover or focus a conversation card to reveal its **Settle conversation** button. The control is
  always visible on touch devices. Settled cards expose **Un-settle conversation** in the same place.
- Settling a conversation that spawned sub-agents archives those sub-agents with it, including ones
  still working. Bring one back from **Settings → Archive**; un-settling the parent does not.
  Native subagents are left alone — they belong to their owner's transcript, not the inbox.
  A conversation whose own session is live still cannot be settled.
- Worktrees start in creation order, oldest first. Drag a worktree by its grip to save a custom order;
  worktrees remain within their project while being rearranged.
- Right-click a project or worktree to create a conversation in that location. Project menus also
  offer **New worktree here**.
- The ellipsis beside a project opens an anchored popover for its name, icon, grouping rule,
  workspace path, and removal controls. **Worktree origin branch** sets the origin branch used by
  that project's new worktrees when **Start from origin** is enabled. Leave it empty to follow the
  repository's default branch. The base branch picker can still override it for one worktree.
- Secondary worktrees have a delete button. Deleting archives their conversation history before
  removing the filesystem worktree; the project checkout itself cannot be deleted.
- A merged pull request is shown beside its worktree with its pull request number.

In **Settings → General → Conversation grouping**, choose **By project**, **By worktree**, or **By status**.
By project is the default: conversations appear directly beneath each project in recent-activity
order, without worktree or repository subheadings. Branches remain visible in conversation metadata.
Status grouping collects conversations into groups such as Working, Needs input, Ready, Snoozed,
and Settled. All views respect the project picker and keep subthreads in popovers. The grouping
preference is saved across reloads.

## Conversation tabs

The conversation bar contains open conversations and drafts. In **Settings → General → Header
tabs**, choose whether it shows tabs from every worktree or only the selected worktree. The choice
survives reloads and app relaunches. Tabs hidden by the selected-worktree view stay open, so
switching back to all worktrees restores them in their original order. Use the filter icon between
Search and Collapse sidebar to switch the scope without opening Settings.
Persisted conversation tabs have an **Archive** action; archiving a parent conversation archives
its sub-agent tree, while draft tabs cannot be archived.
Closing the active draft opens the previous conversation tab, or the next tab when the draft was
first. Closing the only open draft returns to the thread list.
When the strip runs out of room, use the list button at its right edge to open any conversation.

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

Settled and snoozed conversations remain reachable through the sidebar, header tabs, and command palette.
New activity wakes or un-settles a conversation according to its lifecycle rules.

## Workspace tools

The activity rail at the right edge opens Files, Changes, History, Pull request, Terminal, and Browser.
Select a tool to show it; select the active tool again to hide the panel. Hiding the panel keeps its
open items, so reopening a tool resumes it. On narrow windows, use **Workspace tools** in the header, which also contains these project actions.

The panel shows open terminals, browsers, and other tools as tabs. Select a tab to switch tools;
use its close button, middle-click, or context menu to close it. Tabs scroll horizontally when
they overflow. Arrow keys, Home, and End move between focused tabs. Drag the panel's left edge to resize it, or use the maximize control
for more room. Panel width adapts to the space left by the conversation sidebar, reserving room
for chat. When both panes cannot fit, tools open in a sheet.
