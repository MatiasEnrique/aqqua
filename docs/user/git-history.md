# Git history

Open **History** from the workspace toolbar to inspect the current branch's commit graph. History
shows commits reachable from the checked-out local branch by default. Select **Include origin** to
also show commits reachable from the matching `origin/<branch>` ref, including fetched-but-unpulled
commits. Other local and remote branches do not expand the graph.

The commit graph stays on the right. Select a commit to open its multi-file diff on the left in the
regular Diff surface. History omits the separate metadata and changed-file summary so the selected
commit's patch remains the focus. Merge commits are compared with their first parent, while root
commits are compared with an empty tree. Very large commit diffs are capped, and History marks the
preview as incomplete when that happens.

aqqua reads refs already present in the repository and never fetches while loading history.
Use the refresh button after fetching or switching branches to read the latest local ref state.
Tags on commits in the visible graph remain available as labels.
