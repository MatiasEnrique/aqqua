import type {
  ContextMenuItem as TreeContextMenuItem,
  ContextMenuOpenContext as TreeContextMenuOpenContext,
} from "@pierre/trees";
import type { EnvironmentId, ProjectEntry } from "@aqqua/contracts";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { squashAtomCommandFailure } from "@aqqua/client-runtime/state/runtime";
import { serializeComposerFileLink } from "@aqqua/shared/composerTrigger";
import { Files, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { PanelSurfaceHeader } from "~/components/PanelSurfaceHeader";
import { toastManager } from "~/components/ui/toast";
import { useComposerHandleContext } from "~/composerHandleContext";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { AQQUA_PIERRE_ICONS } from "~/pierre-icons";
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";

import { createFileTreeDragMentionController } from "./fileTreeDragMention";
import { useProjectEntriesQuery } from "./projectFilesQueryState";

interface FileBrowserPanelProps {
  environmentId: EnvironmentId;
  cwd: string;
  projectName: string;
  onOpenFile: (relativePath: string) => void;
}

interface ExplorerWorkspaceState {
  expandedPaths: readonly string[];
  searchQuery: string | null;
}

const explorerStateByWorkspace = new Map<string, ExplorerWorkspaceState>();

const TREE_UNSAFE_CSS = `
  :host {
    --trees-bg-override: transparent;
    --trees-selected-bg-override: color-mix(in srgb, currentColor 12%, transparent);
    --trees-hover-bg-override: color-mix(in srgb, currentColor 7%, transparent);
    --trees-border-color-override: color-mix(in srgb, currentColor 14%, transparent);
    --trees-font-family-override: var(--font-sans);
    --trees-font-size-override: 12px;
  }
  button[data-type='item'] { border-radius: 5px; }
`;

function treePath(entry: ProjectEntry): string {
  return entry.kind === "directory" ? `${entry.path}/` : entry.path;
}

function withoutDirectorySuffix(path: string): string {
  return path.replace(/\/$/, "");
}

function parentPath(path: string): string {
  const separatorIndex = withoutDirectorySuffix(path).lastIndexOf("/");
  return separatorIndex < 0 ? "" : path.slice(0, separatorIndex);
}

function joinRelativePath(parent: string, name: string): string {
  return parent.length === 0 ? name : `${parent}/${name}`;
}

function mutationErrorDescription(result: Parameters<typeof squashAtomCommandFailure>[0]): string {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "An error occurred.";
}

interface PendingDelete {
  readonly kind: ProjectEntry["kind"];
  readonly path: string;
}

export default function FileBrowserPanel({
  environmentId,
  cwd,
  projectName,
  onOpenFile,
}: FileBrowserPanelProps) {
  const { resolvedTheme } = useTheme();
  const composerRef = useComposerHandleContext();
  const explorerWorkspaceKey = `${environmentId}:${cwd}`;
  const restoredExplorerState = explorerStateByWorkspace.get(explorerWorkspaceKey);
  const entriesQuery = useProjectEntriesQuery(environmentId, cwd);
  const createEntry = useAtomCommand(projectEnvironment.createEntry, { reportFailure: false });
  const moveEntry = useAtomCommand(projectEnvironment.moveEntry, { reportFailure: false });
  const deleteEntry = useAtomCommand(projectEnvironment.deleteEntry, { reportFailure: false });
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const entries = entriesQuery.data?.entries ?? [];
  const entryKinds = useMemo(
    () => new Map(entries.map((entry) => [entry.path, entry.kind] as const)),
    [entries],
  );
  const entryKindsRef = useRef<ReadonlyMap<string, ProjectEntry["kind"]>>(entryKinds);
  const treePaths = useMemo(() => entries.map(treePath), [entries]);
  // The explorer lists gitignored files rather than hiding them, so they need to
  // read as de-emphasised instead of ordinary. The tree's own git lane already
  // renders "ignored" that way, and propagates it from an ignored directory to
  // everything beneath it, so marking each entry the server flagged is enough.
  const treeGitStatus = useMemo(
    () =>
      entries
        .filter((entry) => entry.ignored === true)
        .map((entry) => ({ path: treePath(entry), status: "ignored" as const })),
    [entries],
  );
  const previousTreePathsRef = useRef<readonly string[]>([]);
  const treeModelRef = useRef<ReturnType<typeof useFileTree>["model"] | null>(null);
  const pendingCreationsRef = useRef(new Map<string, ProjectEntry["kind"]>());

  const reportMutationFailure = (
    title: string,
    result: Parameters<typeof mutationErrorDescription>[0],
  ) => {
    toastManager.add({
      type: "error",
      title,
      description: mutationErrorDescription(result),
    });
  };

  const nextPlaceholderPath = (parent: string, kind: ProjectEntry["kind"]): string => {
    const model = treeModelRef.current;
    const baseName = kind === "directory" ? "New Folder" : "New File";
    let suffix = 1;
    while (true) {
      const name = suffix === 1 ? baseName : `${baseName} ${suffix}`;
      const relativePath = joinRelativePath(parent, name);
      const candidate = kind === "directory" ? `${relativePath}/` : relativePath;
      if (model?.getItem(candidate) === null) return candidate;
      suffix += 1;
    }
  };

  const beginCreate = (item: TreeContextMenuItem, kind: ProjectEntry["kind"]): void => {
    const model = treeModelRef.current;
    if (!model) return;
    const targetParent =
      item.kind === "directory" ? withoutDirectorySuffix(item.path) : parentPath(item.path);
    const placeholderPath = nextPlaceholderPath(targetParent, kind);
    pendingCreationsRef.current.set(placeholderPath, kind);
    model.add(placeholderPath);
    if (!model.startRenaming(placeholderPath, { removeIfCanceled: true })) {
      pendingCreationsRef.current.delete(placeholderPath);
      model.remove(placeholderPath, kind === "directory" ? { recursive: true } : undefined);
    }
  };

  const handleRename = (event: {
    readonly destinationPath: string;
    readonly isFolder: boolean;
    readonly sourcePath: string;
  }): void => {
    const sourcePath = withoutDirectorySuffix(event.sourcePath);
    const destinationPath = withoutDirectorySuffix(event.destinationPath);
    const sourceTreePath = event.isFolder ? `${sourcePath}/` : sourcePath;
    const destinationTreePath = event.isFolder ? `${destinationPath}/` : destinationPath;
    const pendingKind = pendingCreationsRef.current.get(sourceTreePath);
    pendingCreationsRef.current.delete(sourceTreePath);

    void (async () => {
      if (pendingKind !== undefined) {
        const result = await createEntry({
          environmentId,
          input: { cwd, relativePath: destinationPath, kind: pendingKind },
        });
        if (result._tag === "Success") {
          entryKindsRef.current = new Map(entryKindsRef.current).set(destinationPath, pendingKind);
          entriesQuery.refresh();
          return;
        }
        treeModelRef.current?.remove(
          destinationTreePath,
          pendingKind === "directory" ? { recursive: true } : undefined,
        );
        reportMutationFailure(`Failed to create ${pendingKind}`, result);
        return;
      }

      const result = await moveEntry({
        environmentId,
        input: { cwd, sourcePath, destinationPath },
      });
      if (result._tag === "Success") {
        const nextKinds = new Map(entryKindsRef.current);
        const kind = nextKinds.get(sourcePath);
        nextKinds.delete(sourcePath);
        if (kind !== undefined) nextKinds.set(destinationPath, kind);
        entryKindsRef.current = nextKinds;
        entriesQuery.refresh();
        return;
      }
      try {
        treeModelRef.current?.move(destinationTreePath, sourceTreePath, { collision: "error" });
      } catch {
        entriesQuery.refresh();
      }
      reportMutationFailure("Failed to rename entry", result);
    })();
  };

  // The tree renders rows in shadow DOM and its anchor rect is unreliable, so
  // capture the right-click position ourselves; contextmenu is a composed
  // event, so a capture-phase listener sees it with viewport coordinates.
  const contextMenuPointerRef = useRef<{ x: number; y: number; at: number } | null>(null);
  useEffect(() => {
    const capturePointer = (event: MouseEvent) => {
      contextMenuPointerRef.current = { x: event.clientX, y: event.clientY, at: event.timeStamp };
    };
    document.addEventListener("contextmenu", capturePointer, true);
    return () => document.removeEventListener("contextmenu", capturePointer, true);
  }, []);

  const showEntryContextMenu = async (
    item: TreeContextMenuItem,
    context: TreeContextMenuOpenContext,
  ) => {
    const api = readLocalApi();
    if (!api) {
      context.close();
      return;
    }
    const relativePath = item.path.replace(/\/$/, "");
    const mention = serializeComposerFileLink(relativePath);
    const pointer = contextMenuPointerRef.current;
    const pointerIsFresh = pointer !== null && performance.now() - pointer.at < 1000;
    const anchorRect = context.anchorElement.getBoundingClientRect();
    const position = pointerIsFresh
      ? { x: pointer.x, y: pointer.y }
      : { x: anchorRect.left, y: anchorRect.bottom };
    let focusTransferred = false;
    try {
      const clicked = await api.contextMenu.show(
        [
          { id: "new-file", label: "New File" },
          { id: "new-folder", label: "New Folder" },
          { id: "rename", label: "Rename" },
          { id: "delete", label: "Delete", destructive: true },
          { id: "copy-mention", label: "Copy mention" },
          { id: "add-to-chat", label: "Add to chat" },
        ],
        position,
      );
      if (clicked === "new-file" || clicked === "new-folder" || clicked === "rename") {
        focusTransferred = true;
        context.close({ restoreFocus: false });
        if (clicked === "rename") {
          treeModelRef.current?.startRenaming(item.path);
        } else {
          beginCreate(item, clicked === "new-file" ? "file" : "directory");
        }
        return;
      }
      if (clicked === "delete") {
        focusTransferred = true;
        context.close({ restoreFocus: false });
        setPendingDelete({ path: relativePath, kind: item.kind });
        return;
      }
      if (clicked === "copy-mention") {
        try {
          await writeTextToClipboard(mention);
          toastManager.add({ type: "success", title: "Mention copied", description: relativePath });
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Failed to copy mention",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
        return;
      }
      if (clicked === "add-to-chat") {
        const composer = composerRef?.current;
        if (!composer) {
          toastManager.add({
            type: "error",
            title: "Unable to add to chat",
            description: "Open a chat for this project and try again.",
          });
          return;
        }
        const inserted = composer.insertTextAtEnd(`${mention} `, { ensureLeadingBoundary: true });
        if (!inserted) {
          toastManager.add({
            type: "error",
            title: "Unable to add to chat",
            description: "The chat isn't ready to accept input right now.",
          });
        }
      }
    } finally {
      if (!focusTransferred) context.close();
    }
  };
  const showEntryContextMenuRef = useRef(showEntryContextMenu);
  useEffect(() => {
    showEntryContextMenuRef.current = showEntryContextMenu;
  });

  const dragMention = useMemo(
    () =>
      createFileTreeDragMentionController({
        deselect: (path) => treeModelRef.current?.getItem(path)?.deselect(),
      }),
    [],
  );
  const handleRenameRef = useRef(handleRename);
  useEffect(() => {
    handleRenameRef.current = handleRename;
  });
  const { model } = useFileTree({
    composition: {
      contextMenu: {
        triggerMode: "right-click",
        onOpen: (item, context) => {
          void showEntryContextMenuRef.current(item, context);
        },
      },
    },
    // Rows only need to be draggable so entries can be dropped into the chat
    // composer; rearranging files inside the tree stays off.
    dragAndDrop: { canDrop: () => false },
    density: "compact",
    fileTreeSearchMode: "hide-non-matches",
    flattenEmptyDirectories: true,
    initialExpansion: restoredExplorerState ? "closed" : 1,
    ...(restoredExplorerState?.expandedPaths
      ? { initialExpandedPaths: restoredExplorerState.expandedPaths }
      : {}),
    ...(restoredExplorerState?.searchQuery
      ? { initialSearchQuery: restoredExplorerState.searchQuery }
      : {}),
    icons: AQQUA_PIERRE_ICONS,
    renaming: {
      canRename: () => true,
      onError: (error) => {
        toastManager.add({ type: "error", title: "Unable to rename entry", description: error });
      },
      onRename: (event) => handleRenameRef.current(event),
    },
    onSelectionChange: (selectedPaths) => {
      dragMention.handleSelectionChange(selectedPaths);
      // Starting a drag selects the dragged row; that selection is a side
      // effect of the gesture, not a request to open the file.
      if (dragMention.isDragInProgress()) {
        return;
      }
      const selectedPath = selectedPaths.at(-1)?.replace(/\/$/, "");
      if (selectedPath && entryKindsRef.current.get(selectedPath) === "file") {
        onOpenFile(selectedPath);
      }
    },
    onSearchChange: (searchQuery) => {
      const current = explorerStateByWorkspace.get(explorerWorkspaceKey);
      explorerStateByWorkspace.set(explorerWorkspaceKey, {
        expandedPaths: current?.expandedPaths ?? [],
        searchQuery,
      });
    },
    paths: [],
    search: true,
    unsafeCSS: TREE_UNSAFE_CSS,
  });

  useEffect(() => {
    if (previousTreePathsRef.current === treePaths) return;
    entryKindsRef.current = entryKinds;
    previousTreePathsRef.current = treePaths;
    model.resetPaths(treePaths);
  }, [entryKinds, model, treePaths]);

  // `useFileTree` captures its options once, so the ignored set has to be pushed
  // imperatively — at construction time the query has not resolved and there are
  // no entries to mark.
  useEffect(() => {
    model.setGitStatus(treeGitStatus);
  }, [model, treeGitStatus]);

  useEffect(
    () =>
      model.subscribe(() => {
        const expandedPaths = treePaths.filter((path) => {
          const item = model.getItem(path);
          return item?.isDirectory() === true && "isExpanded" in item && item.isExpanded();
        });
        explorerStateByWorkspace.set(explorerWorkspaceKey, {
          expandedPaths,
          searchQuery: model.getSearchValue() || null,
        });
      }),
    [explorerWorkspaceKey, model, treePaths],
  );

  const fileCount = useMemo(
    () => entries.reduce((count, entry) => count + (entry.kind === "file" ? 1 : 0), 0),
    [entries],
  );

  const confirmDelete = (): void => {
    const target = pendingDelete;
    if (!target) return;
    setPendingDelete(null);
    void (async () => {
      const result = await deleteEntry({
        environmentId,
        input: {
          cwd,
          relativePath: target.path,
          recursive: target.kind === "directory",
        },
      });
      if (result._tag !== "Success") {
        reportMutationFailure("Failed to delete entry", result);
        return;
      }
      const targetTreePath = target.kind === "directory" ? `${target.path}/` : target.path;
      treeModelRef.current?.remove(
        targetTreePath,
        target.kind === "directory" ? { recursive: true } : undefined,
      );
      const nextKinds = new Map(entryKindsRef.current);
      nextKinds.delete(target.path);
      entryKindsRef.current = nextKinds;
      entriesQuery.refresh();
    })();
  };

  // Tag tree drags with the composer mention payload. The row is read from
  // the composed event path (the tree's shadow root is open), so this does
  // not depend on running after the tree's own dragstart handler; the drag
  // data store is writable for every dragstart listener in the dispatch.
  // The capture phase runs before the tree's own dragstart handler selects
  // the dragged row, so the drag flag is up before that selection emits.
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    treeModelRef.current = model;
  }, [model]);
  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) {
      return;
    }
    const handleDragStart = (event: DragEvent) => dragMention.handleDragStart(event);
    const handleDragEnd = () => dragMention.handleDragEnd();
    panel.addEventListener("dragstart", handleDragStart, true);
    panel.addEventListener("dragend", handleDragEnd);
    return () => {
      panel.removeEventListener("dragstart", handleDragStart, true);
      panel.removeEventListener("dragend", handleDragEnd);
    };
  }, [dragMention]);

  return (
    <>
      <div
        ref={panelRef}
        className="flex min-h-0 flex-1 flex-col bg-background"
        data-file-browser-panel={`${environmentId}:${cwd}`}
      >
        <PanelSurfaceHeader
          icon={Files}
          title={projectName}
          meta={
            <>
              {entriesQuery.isPending && entriesQuery.data === null
                ? "Indexing…"
                : `${fileCount.toLocaleString()} files`}
              {entriesQuery.data?.truncated ? " · partial" : ""}
            </>
          }
          actions={
            <>
              <button
                type="button"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Search workspace files"
                onClick={() => model.openSearch()}
              >
                <Search className="size-3.5" />
              </button>
              <button
                type="button"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Refresh workspace files"
                disabled={entriesQuery.isPending}
                onClick={() => {
                  void entriesQuery.refresh().catch((error: unknown) => {
                    toastManager.add({
                      type: "error",
                      title: "Could not refresh workspace files",
                      description:
                        error instanceof Error ? error.message : "Workspace refresh failed.",
                    });
                  });
                }}
              >
                <RefreshCw className={cn("size-3.5", entriesQuery.isPending && "animate-spin")} />
              </button>
            </>
          }
        />
        {entriesQuery.error && entriesQuery.data === null ? (
          <div className="p-4 text-xs leading-relaxed text-destructive">{entriesQuery.error}</div>
        ) : (
          <FileTree
            model={model}
            aria-label={`${projectName} files`}
            className="min-h-0 flex-1 overflow-hidden"
            style={{
              colorScheme: resolvedTheme,
              ["--trees-fg-override" as string]: "var(--foreground)",
            }}
          />
        )}
      </div>
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Permanently delete “{pendingDelete?.path ?? "this entry"}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.kind === "directory"
                ? "This permanently deletes the folder and all of its contents from disk. This cannot be undone."
                : "This permanently deletes the file from disk. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button variant="destructive" onClick={confirmDelete}>
              Permanently delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
