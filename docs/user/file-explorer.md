# File explorer

Open **Files** from the right activity rail or the **Workspace tools** picker to browse and read files in the active workspace.
The Explorer uses one right-panel item. Selecting another file replaces the current file view
inside that item, and every selection brings Explorer to the front.

Folders linked to another directory inside the workspace show their contents under the linked
path too, including shared skills folders such as `.claude/skills`. Links outside the workspace
and links that would create a directory cycle remain visible but are not expanded.
The Explorer omits `.git`, `node_modules`, `.pnpm-store`, and `.turbo` so repository metadata and
generated caches do not exhaust the file-list limit before it reaches source files.

Use the folder-tree control in the file toolbar to show or hide the Explorer alongside the current
file. In narrow panels, the Explorer uses the full width; opening a file from the Explorer, chat,
or another entry point replaces it with the file preview. Use the folder-tree control to return to the Explorer. Wider panels show both
side by side. Closing the Explorer item also closes the current file view.

## Manage files and folders

Open the Explorer context menu to create an empty file or folder. New entries can be nested under
the selected folder. Names are workspace-relative: aqqua rejects paths that would leave the active
workspace.

Use **Rename** to rename an entry or move it to another workspace-relative path. When the source and
destination are on the same filesystem, aqqua uses an atomic filesystem rename. Cross-filesystem
moves use a guarded copy fallback and remove the source only after the destination is complete.

Use **Delete** to permanently remove a file or folder. Deletion does not move entries to the system
trash. Deleting a non-empty folder requires explicit confirmation and recursively removes everything
inside it, so review the displayed path before continuing.

## Preview and editing safety

Text files can be edited directly from their source preview. Rendered Markdown task checkboxes also
write changes back to the complete Markdown file.

Files larger than 1 MiB are limited to a preview of their first 1 MiB. A truncation notice shows the
full file size, and the preview is always read-only. This applies to Markdown too: truncated Markdown
is shown as source, cannot be edited, and exposes no writable task checkboxes.

All create, write, rename, move, and delete operations are confined to the active workspace. aqqua
checks both the requested path and its resolved filesystem location, including symbolic links, and
rejects an operation when it would resolve outside the workspace. Destination collisions are rejected
instead of intentionally replacing an existing entry.
