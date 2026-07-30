# Git history

Open **History** from the workspace toolbar to inspect the current branch's commit graph. The
history includes commits reachable from the checked-out local branch and its matching
`origin/<branch>` ref, so local-only and fetched-but-unpulled commits remain visible together.
Other local and remote branches do not expand the graph.

T3 Code reads refs already present in the repository and never fetches while loading history.
Use the refresh button after fetching or switching branches to read the latest local ref state.
Tags on commits in the visible graph remain available as labels.
