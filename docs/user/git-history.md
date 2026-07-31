# Git history

Open **History** from the workspace toolbar to inspect the current branch's commit graph. The
history includes commits reachable from the checked-out local branch and its matching
`origin/<branch>` ref, so local-only and fetched-but-unpulled commits remain visible together.
Other local and remote branches do not expand the graph.

Select a commit to inspect its metadata, changed files, and code diff. The first changed file is
shown automatically; select another file to switch the diff preview. Merge commits are compared
with their first parent, while root commits are compared with an empty tree. Very large file diffs
are capped, and History marks the preview as incomplete when that happens.

T3 Code reads refs already present in the repository and never fetches while loading history.
Use the refresh button after fetching or switching branches to read the latest local ref state.
Tags on commits in the visible graph remain available as labels.
