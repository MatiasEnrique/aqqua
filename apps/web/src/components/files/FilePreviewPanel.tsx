import type {
  EditorId,
  EnvironmentId,
  ResolvedKeybindingsConfig,
  ScopedThreadRef,
} from "@aqqua/contracts";
import { isWorkspaceImagePreviewPath } from "@aqqua/shared/filePreview";
import { type DiffLineAnnotation, type FileContents, type SelectedLineRange } from "@pierre/diffs";
import { Editor } from "@pierre/diffs/editor";
import { EditProvider, File, type FileOptions, Virtualizer } from "@pierre/diffs/react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@aqqua/client-runtime/state/runtime";
import { ChevronRight, Code2, Eye, FolderTree, Globe2, LoaderCircle } from "lucide-react";
import * as Schema from "effect/Schema";
import { useCallback, useEffect, useInsertionEffect, useMemo, useRef, useState } from "react";

import { isBrowserPreviewFile, openFileInPreview } from "~/browser/openFileInPreview";
import { OpenInPicker } from "~/components/chat/OpenInPicker";
import { useClientSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { getLocalStorageItem, setLocalStorageItem, useLocalStorage } from "~/hooks/useLocalStorage";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { cn } from "~/lib/utils";
import { isFileSaveShortcut } from "~/keybindings";
import { isPreviewSupportedInRuntime } from "~/previewStateStore";
import { resolvePathLinkTarget } from "~/terminal-links";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Toggle } from "~/components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { buildFileReviewComment } from "~/reviewCommentContext";
import { assetEnvironment } from "~/state/assets";
import { useEnvironmentHttpBaseUrl, usePrimaryEnvironmentId } from "~/state/environments";
import { previewEnvironment } from "~/state/preview";
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";

import FileBrowserPanel from "./FileBrowserPanel";
import {
  type FileCommentAnnotationEntry,
  type FileCommentAnnotationGroup,
  type FileCommentLineAnnotation,
  formatFileCommentRange,
  nextFileCommentId,
  normalizeFileCommentRange,
  remapFileCommentAnnotations,
} from "./fileCommentAnnotations";
import { installFileEditorDismissal } from "./fileEditorDismissal";
import { LocalCommentAnnotation } from "./LocalCommentAnnotation";
import {
  areFileCommentAnnotationsEqual,
  beginFileEditingSession,
  projectFileCacheKey,
  resolveFileEditingSession,
} from "./fileContentRevision";
import { fileBreadcrumbs } from "./filePath";
import { FilePreviewImageSurface } from "./FilePreviewImageSurface";
import {
  FILE_LINK_REVEAL_UNSAFE_CSS,
  type FilePostRender,
  useFileLineReveal,
} from "./FilePreviewLineReveal";
import { FilePreviewReadOnlySurface } from "./FilePreviewReadOnlySurface";
import {
  isMarkdownPreviewFile,
  resolveFilePreviewMode,
  setMarkdownTaskChecked,
} from "./filePreviewMode";
import { FileSaveCoordinator, type FileSaveFailure } from "./fileSaveCoordinator";
import {
  confirmProjectFileQueryData,
  getOptimisticProjectFileQueryData,
  setProjectFileQueryData,
  useProjectFileQuery,
} from "./projectFilesQueryState";
import { RenderedMarkdownPreview } from "./RenderedMarkdownPreview";

interface FilePreviewPanelProps {
  environmentId: EnvironmentId;
  cwd: string;
  projectName: string;
  relativePath: string | null;
  threadRef: ScopedThreadRef;
  composerDraftTarget: ScopedThreadRef | DraftId;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  revealLine: number | null;
  revealRequestId: number;
  onOpenFile: (relativePath: string) => void;
  onPendingChange: (relativePath: string, pending: boolean) => void;
}

const FILE_EXPLORER_STORAGE_KEY = "aqqua.fileExplorerOpen";
const RENDER_MARKDOWN_STORAGE_KEY = "aqqua.renderMarkdown";
const FILE_SAVE_DEBOUNCE_MS = 500;

/**
 * A callback with a permanently stable identity that always calls the latest
 * closure.
 *
 * `<File>` compares its `options` with `!==` per key, so a callback that is
 * rebuilt whenever some unrelated piece of state changes marks the whole option
 * set as different, which forces a full document rebuild. Everything we hand to
 * `<File>` therefore either stays stable forever or changes only when the file
 * genuinely has to be re-rendered.
 *
 * Insertion effects commit before any layout effect, including the one inside
 * `useFileInstance` that drives `File.render`, so the ref is never stale by the
 * time the library calls back into us.
 */
function useStableHandler<A extends unknown[], R>(handler: (...args: A) => R): (...args: A) => R {
  const handlerRef = useRef(handler);
  useInsertionEffect(() => {
    handlerRef.current = handler;
  });
  return useCallback((...args: A) => handlerRef.current(...args), []);
}

interface EditableFileSurfaceProps {
  environmentId: EnvironmentId;
  cwd: string;
  relativePath: string;
  composerDraftTarget: ScopedThreadRef | DraftId;
  contents: string;
  resolvedTheme: "light" | "dark";
  revealRequestId: number;
  wordWrap: boolean;
  keybindings: ResolvedKeybindingsConfig;
  onPostRender: FilePostRender;
  onPendingChange: (relativePath: string, pending: boolean) => void;
}

interface FileSelectionOverride {
  revealRequestId: number;
  range: SelectedLineRange | null;
}

function useFileSaveCoordinator({
  environmentId,
  cwd,
  relativePath,
  onPendingChange,
}: Pick<
  EditableFileSurfaceProps,
  "environmentId" | "cwd" | "relativePath" | "onPendingChange"
>): FileSaveCoordinator {
  const writeFile = useAtomCommand(projectEnvironment.writeFile);
  // Only the identity of what is being saved belongs in the dependencies. The
  // callbacks go through stable wrappers so an unstable `onPendingChange` from
  // the parent cannot replace the coordinator mid-edit and throw away a
  // debounced write that has not fired yet.
  const notifyPendingChange = useStableHandler((pending: boolean) => {
    onPendingChange(relativePath, pending);
  });
  const persistContents = useStableHandler((nextContents: string) =>
    writeFile({
      environmentId,
      input: { cwd, relativePath, contents: nextContents },
    }),
  );
  // Without this the file just stays dirty forever: the pending dot never
  // clears, no toast appears, and the edit looks saved when it is not.
  const reportSaveFailure = useStableHandler((failure: FileSaveFailure) => {
    const error = squashAtomCommandFailure(failure);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: `Unable to save ${relativePath}`,
        description:
          error instanceof Error
            ? error.message
            : "The file is still unsaved. Editing it again retries the write.",
      }),
    );
  });
  const coordinator = useMemo(
    () =>
      new FileSaveCoordinator({
        debounceMs: FILE_SAVE_DEBOUNCE_MS,
        onPendingChange: notifyPendingChange,
        persist: persistContents,
        onConfirmed: (confirmedContents) => {
          confirmProjectFileQueryData(environmentId, cwd, relativePath, confirmedContents);
        },
        onError: reportSaveFailure,
      }),
    [cwd, environmentId, notifyPendingChange, persistContents, relativePath, reportSaveFailure],
  );

  useEffect(() => () => coordinator.dispose(), [coordinator]);
  return coordinator;
}

/**
 * Holds the document the editor was seeded with for the lifetime of an editing
 * session.
 *
 * The optimistic store still receives every keystroke — it is the save buffer,
 * and the rendered-markdown view and the dirty indicator read from it — but its
 * value is no longer pushed back into `<File>`. React only re-seeds when the
 * contents disagree with what the editor itself last produced, which is exactly
 * the "someone else changed this file" case.
 */
function useFileEditingSession(cwd: string, relativePath: string, contents: string) {
  const [session, setSession] = useState(() =>
    beginFileEditingSession({ cwd, relativePath, contents }),
  );
  // A ref, not state: the optimistic atom can re-render this component before a
  // queued state update lands, and reading a stale "last typed" value there
  // would look like an external write and re-seed the editor mid-keystroke.
  const editorContentsRef = useRef(session.document.contents);

  const resolved = resolveFileEditingSession(session, {
    cwd,
    relativePath,
    contents,
    editorContents: editorContentsRef.current,
  });
  if (resolved !== session) {
    editorContentsRef.current = resolved.document.contents;
    setSession(resolved);
  }

  const recordEditorContents = useCallback((nextContents: string) => {
    editorContentsRef.current = nextContents;
  }, []);

  return { document: resolved.document, recordEditorContents };
}

function EditableFileSurface({
  environmentId,
  cwd,
  relativePath,
  composerDraftTarget,
  contents,
  resolvedTheme,
  revealRequestId,
  wordWrap,
  keybindings,
  onPostRender,
  onPendingChange,
}: EditableFileSurfaceProps) {
  const addReviewComment = useComposerDraftStore((store) => store.addReviewComment);
  const removeReviewComment = useComposerDraftStore((store) => store.removeReviewComment);
  const [lineAnnotations, setLineAnnotations] = useState<FileCommentLineAnnotation[]>([]);
  const [selectionOverride, setSelectionOverride] = useState<FileSelectionOverride | null>(null);
  const selectedRange =
    selectionOverride?.revealRequestId === revealRequestId ? selectionOverride.range : null;
  const setSelectedRange = useStableHandler((range: SelectedLineRange | null) => {
    setSelectionOverride({ revealRequestId, range });
  });
  const surfaceRef = useRef<HTMLDivElement>(null);
  const selectionFrameRef = useRef<number | null>(null);
  const saveCoordinator = useFileSaveCoordinator({
    environmentId,
    cwd,
    relativePath,
    onPendingChange,
  });
  const { document: editableDocument, recordEditorContents } = useFileEditingSession(
    cwd,
    relativePath,
    contents,
  );
  const handleEditorChange = useStableHandler(
    (
      file: FileContents,
      nextLineAnnotations: DiffLineAnnotation<FileCommentAnnotationGroup>[] | undefined,
    ) => {
      // Read once: `contents` is a getter that re-serializes the whole document.
      const nextContents = file.contents;
      // Recorded before the store write so the re-render this triggers can tell
      // the echo of our own keystroke from an external write.
      recordEditorContents(nextContents);
      setProjectFileQueryData(environmentId, cwd, relativePath, nextContents);
      saveCoordinator.change(nextContents);
      if (!nextLineAnnotations) return;
      const remapped = remapFileCommentAnnotations(
        nextLineAnnotations as FileCommentLineAnnotation[],
      );
      setLineAnnotations((current) =>
        areFileCommentAnnotationsEqual(current, remapped) ? current : remapped,
      );
      for (const annotation of remapped) {
        for (const entry of annotation.metadata.entries) {
          if (entry.kind !== "comment") continue;
          addReviewComment(
            composerDraftTarget,
            buildFileReviewComment({
              id: entry.id,
              filePath: relativePath,
              startLine: entry.startLine,
              endLine: entry.endLine,
              text: entry.text,
              contents: nextContents,
            }),
          );
        }
      }
    },
  );
  // One editor per mounted surface. `useFileInstance` only re-runs its attach
  // effect when the editor instance changes, so recreating it here would
  // detach the live editor from the DOM it is driving.
  const editor = useMemo(
    () => new Editor<FileCommentAnnotationGroup>({ onChange: handleEditorChange }),
    [handleEditorChange],
  );

  useEffect(
    () => () => {
      editor.cleanUp();
    },
    [editor],
  );

  const removeAnnotationEntry = useCallback(
    (entryId: string) => {
      setSelectedRange(null);
      removeReviewComment(composerDraftTarget, entryId);
      setLineAnnotations((current) => {
        return current.flatMap((annotation) => {
          const entries = annotation.metadata.entries.filter((entry) => entry.id !== entryId);
          return entries.length > 0 ? [{ ...annotation, metadata: { entries } }] : [];
        });
      });
    },
    [composerDraftTarget, removeReviewComment, setSelectedRange],
  );

  const submitAnnotationEntry = useCallback(
    (entryId: string, text: string) => {
      setSelectedRange(null);
      const entry = lineAnnotations
        .flatMap((annotation) => annotation.metadata.entries)
        .find((candidate) => candidate.id === entryId);
      if (entry) {
        addReviewComment(
          composerDraftTarget,
          buildFileReviewComment({
            id: entry.id,
            filePath: relativePath,
            startLine: entry.startLine,
            endLine: entry.endLine,
            text,
            contents,
          }),
        );
      }
      setLineAnnotations((current) =>
        current.map((annotation) => ({
          ...annotation,
          metadata: {
            entries: annotation.metadata.entries.map((annotationEntry) =>
              annotationEntry.id === entryId
                ? { ...annotationEntry, kind: "comment", text }
                : annotationEntry,
            ),
          },
        })),
      );
    },
    [
      addReviewComment,
      composerDraftTarget,
      contents,
      lineAnnotations,
      relativePath,
      setSelectedRange,
    ],
  );

  const beginComment = useCallback((range: SelectedLineRange) => {
    const { startLine, endLine } = normalizeFileCommentRange(range);
    const draftEntry: FileCommentAnnotationEntry = {
      id: nextFileCommentId(),
      kind: "draft",
      startLine,
      endLine,
      text: "",
    };
    setLineAnnotations((current) => {
      const withoutDraft = current.flatMap((annotation) => {
        const entries = annotation.metadata.entries.filter((entry) => entry.kind !== "draft");
        return entries.length > 0 ? [{ ...annotation, metadata: { entries } }] : [];
      });
      const existingIndex = withoutDraft.findIndex(
        (annotation) => annotation.lineNumber === endLine,
      );
      if (existingIndex < 0) {
        return [
          ...withoutDraft,
          {
            lineNumber: endLine,
            metadata: { entries: [draftEntry] },
          },
        ];
      }
      return withoutDraft.map((annotation, index) =>
        index === existingIndex
          ? {
              ...annotation,
              metadata: { entries: [...annotation.metadata.entries, draftEntry] },
            }
          : annotation,
      );
    });
  }, []);
  const hasOpenCommentForm = lineAnnotations.some((annotation) =>
    annotation.metadata.entries.some((entry) => entry.kind === "draft"),
  );
  useEffect(() => {
    const root = surfaceRef.current;
    if (!root) return;
    return installFileEditorDismissal({
      root,
      editor,
      isBlocked: () => hasOpenCommentForm,
      onDismiss: () => setSelectedRange(null),
    });
  }, [editor, hasOpenCommentForm, setSelectedRange]);
  // Capture phase so the browser's own "Save Page As" never gets the chance.
  // The event having travelled through this surface is a stronger claim than
  // `document.activeElement`, so the context flag is asserted rather than
  // re-derived — that also covers focus sitting in the editor's search panel.
  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      const root = surfaceRef.current;
      if (event.defaultPrevented || !root || !event.composedPath().includes(root)) return;
      if (!isFileSaveShortcut(event, keybindings, { context: { fileEditorFocus: true } })) return;
      event.preventDefault();
      event.stopPropagation();
      saveCoordinator.flush();
    };

    document.addEventListener("keydown", handleSaveShortcut, true);
    return () => document.removeEventListener("keydown", handleSaveShortcut, true);
  }, [keybindings, saveCoordinator]);
  const handleLineSelectionEnd = useCallback(
    (range: SelectedLineRange | null) => {
      setSelectedRange(range);
      if (range) {
        beginComment(range);
      }
    },
    [beginComment, setSelectedRange],
  );

  // Stable, so a changed line selection no longer perturbs the option set.
  const applySelectionAfterRender = useStableHandler((...args: Parameters<FilePostRender>) => {
    const [fileContainer, instance, phase] = args;
    if (selectionFrameRef.current !== null) {
      cancelAnimationFrame(selectionFrameRef.current);
      selectionFrameRef.current = null;
    }
    if (phase === "unmount") return;

    selectionFrameRef.current = requestAnimationFrame(() => {
      selectionFrameRef.current = null;
      if (!fileContainer.isConnected) return;
      instance.setSelectedLines(selectedRange, { notify: false });
    });
  });
  // Identity tracks `onPostRender` alone, which the panel rebuilds exactly when
  // a line reveal is requested — that is what makes the reveal re-render happen
  // while typing leaves the option set untouched.
  const handlePostRender = useCallback<FilePostRender>(
    (fileContainer, instance, phase) => {
      onPostRender(fileContainer, instance, phase);
      applySelectionAfterRender(fileContainer, instance, phase);
    },
    [applySelectionAfterRender, onPostRender],
  );

  const fileOptions = useMemo<FileOptions<FileCommentAnnotationGroup>>(
    () => ({
      disableFileHeader: true,
      enableGutterUtility: !hasOpenCommentForm,
      enableLineSelection: !hasOpenCommentForm,
      onGutterUtilityClick: setSelectedRange,
      onLineSelectionChange: setSelectedRange,
      onLineSelectionEnd: handleLineSelectionEnd,
      overflow: wordWrap ? "wrap" : "scroll",
      theme: resolveDiffThemeName(resolvedTheme),
      themeType: resolvedTheme,
      unsafeCSS: FILE_LINK_REVEAL_UNSAFE_CSS,
      onPostRender: handlePostRender,
    }),
    [
      handleLineSelectionEnd,
      handlePostRender,
      hasOpenCommentForm,
      resolvedTheme,
      setSelectedRange,
      wordWrap,
    ],
  );

  return (
    <EditProvider editor={editor}>
      <div ref={surfaceRef} className="flex min-h-0 flex-1">
        <Virtualizer
          className="file-preview-virtualizer min-h-0 flex-1 overflow-auto"
          config={{
            overscrollSize: 600,
            intersectionObserverMargin: 1200,
          }}
        >
          <File<FileCommentAnnotationGroup>
            file={editableDocument}
            options={fileOptions}
            selectedLines={selectedRange}
            lineAnnotations={lineAnnotations}
            renderAnnotation={(annotation) => (
              <div className="py-1">
                {annotation.metadata.entries.map((entry) => (
                  <LocalCommentAnnotation
                    key={entry.id}
                    kind={entry.kind}
                    rangeLabel={formatFileCommentRange(entry.startLine, entry.endLine)}
                    text={entry.text}
                    onCancel={() => removeAnnotationEntry(entry.id)}
                    onComment={(text) => submitAnnotationEntry(entry.id, text)}
                    onDelete={() => removeAnnotationEntry(entry.id)}
                  />
                ))}
              </div>
            )}
            className="min-h-full"
            contentEditable
          />
        </Virtualizer>
      </div>
    </EditProvider>
  );
}

function RenderedMarkdownSurface({
  environmentId,
  cwd,
  relativePath,
  contents,
  threadRef,
  onPendingChange,
}: Omit<
  EditableFileSurfaceProps,
  | "resolvedTheme"
  | "composerDraftTarget"
  | "revealLine"
  | "revealRequestId"
  | "wordWrap"
  | "keybindings"
  | "onPostRender"
> & {
  threadRef: ScopedThreadRef;
}) {
  const saveCoordinator = useFileSaveCoordinator({
    environmentId,
    cwd,
    relativePath,
    onPendingChange,
  });

  return (
    <RenderedMarkdownPreview
      contents={contents}
      cwd={cwd}
      threadRef={threadRef}
      onTaskListChange={({ markerOffset, checked }) => {
        const currentContents =
          getOptimisticProjectFileQueryData(environmentId, cwd, relativePath)?.contents ?? contents;
        const nextContents = setMarkdownTaskChecked(currentContents, markerOffset, checked);
        if (nextContents === currentContents) return;
        setProjectFileQueryData(environmentId, cwd, relativePath, nextContents);
        saveCoordinator.change(nextContents);
      }}
    />
  );
}

function initialExplorerOpen(): boolean {
  try {
    return getLocalStorageItem(FILE_EXPLORER_STORAGE_KEY, Schema.Boolean) ?? true;
  } catch (error) {
    console.error(error);
    return true;
  }
}

export default function FilePreviewPanel({
  environmentId,
  cwd,
  projectName,
  relativePath,
  threadRef,
  composerDraftTarget,
  keybindings,
  availableEditors,
  revealLine,
  revealRequestId,
  onOpenFile,
  onPendingChange,
}: FilePreviewPanelProps) {
  const { resolvedTheme } = useTheme();
  const wordWrap = useClientSettings((settings) => settings.wordWrap);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environmentHttpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const createAssetUrl = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
  });
  const openPreview = useAtomCommand(previewEnvironment.open, {
    reportFailure: false,
  });
  const isImage = relativePath !== null && isWorkspaceImagePreviewPath(relativePath);
  const file = useProjectFileQuery(environmentId, cwd, relativePath, !isImage);
  const [explorerOpen, setExplorerOpen] = useState(initialExplorerOpen);
  // Reading markdown rendered is a preference, not a property of one file. Keeping
  // it on the panel meant a thread switch dropped it and forced source back.
  const [renderMarkdownPreferred, setRenderMarkdownPreferred] = useLocalStorage(
    RENDER_MARKDOWN_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  // Paired with the path so a dismissed reveal on one file cannot swallow the
  // first reveal after the Explorer switches to another file.
  const [handledReveal, setHandledReveal] = useState<{ path: string; requestId: number } | null>(
    null,
  );
  const breadcrumbRef = useRef<HTMLDivElement>(null);
  const isMarkdown = relativePath ? isMarkdownPreviewFile(relativePath) : false;
  // A reveal still wins over the preference: the line only exists in the source.
  const renderMarkdown =
    isMarkdown &&
    renderMarkdownPreferred &&
    (revealLine === null ||
      (handledReveal?.path === relativePath && handledReveal.requestId === revealRequestId));
  const canOpenInBrowser =
    relativePath !== null && isPreviewSupportedInRuntime() && isBrowserPreviewFile(relativePath);
  const absolutePath = relativePath ? resolvePathLinkTarget(relativePath, cwd) : null;
  const breadcrumbs = useMemo(
    () => (relativePath ? fileBreadcrumbs(projectName, relativePath) : []),
    [projectName, relativePath],
  );
  const onFilePostRender = useFileLineReveal(relativePath, revealLine, revealRequestId);
  const previewMode =
    relativePath && file.data
      ? resolveFilePreviewMode({
          relativePath,
          truncated: file.data.truncated,
          renderMarkdown,
        })
      : null;

  useEffect(() => {
    const currentCrumb = breadcrumbRef.current?.querySelector<HTMLElement>(
      "[data-current-file-crumb='true']",
    );
    currentCrumb?.scrollIntoView({ block: "nearest", inline: "end" });
  }, [relativePath]);

  const toggleExplorer = () => {
    setExplorerOpen((current) => {
      const next = !current;
      try {
        setLocalStorageItem(FILE_EXPLORER_STORAGE_KEY, next, Schema.Boolean);
      } catch (error) {
        console.error(error);
      }
      return next;
    });
  };

  const handleOpenInBrowser = useCallback(() => {
    if (!absolutePath || !environmentHttpBaseUrl) return;
    void (async () => {
      const result = await openFileInPreview({
        threadRef,
        filePath: absolutePath,
        httpBaseUrl: environmentHttpBaseUrl,
        createAssetUrl,
        openPreview,
      });
      if (result._tag === "Success" || isAtomCommandInterrupted(result)) {
        return;
      }
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unable to open file in browser",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    })();
  }, [absolutePath, createAssetUrl, environmentHttpBaseUrl, openPreview, threadRef]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      {relativePath ? (
        <div className="surface-subheader gap-2 px-3" data-surface-subheader>
          <ScrollArea
            ref={breadcrumbRef}
            hideScrollbars
            scrollFade
            className="min-w-0 flex-1 rounded-none"
            data-file-breadcrumbs
          >
            <div className="flex h-full w-max min-w-full items-center text-xs">
              {breadcrumbs.map((crumb, index) => (
                <div
                  key={crumb.path || "project"}
                  className="flex min-w-0 shrink-0 items-center"
                  data-current-file-crumb={crumb.kind === "file"}
                >
                  {index > 0 ? (
                    <ChevronRight className="mx-1 size-3.5 shrink-0 text-muted-foreground/60" />
                  ) : null}
                  <span
                    className={cn(
                      "max-w-40 truncate",
                      crumb.kind === "file"
                        ? "font-medium text-foreground"
                        : "text-muted-foreground",
                    )}
                    title={crumb.path || projectName}
                  >
                    {crumb.label}
                  </span>
                </div>
              ))}
            </div>
          </ScrollArea>
          {absolutePath && environmentId === primaryEnvironmentId ? (
            <OpenInPicker
              environmentId={environmentId}
              keybindings={keybindings}
              availableEditors={availableEditors}
              openInCwd={absolutePath}
              compact
              enableShortcut={false}
            />
          ) : null}
          {isMarkdown && !file.data?.truncated ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Toggle
                    className="shrink-0"
                    pressed={renderMarkdown}
                    onPressedChange={(pressed) => {
                      setRenderMarkdownPreferred(pressed);
                      setHandledReveal(
                        pressed && relativePath !== null
                          ? { path: relativePath, requestId: revealRequestId }
                          : null,
                      );
                    }}
                    aria-label={renderMarkdown ? "Show markdown source" : "Show rendered markdown"}
                    variant="ghost"
                    size="sm"
                  >
                    {renderMarkdown ? <Code2 className="size-3.5" /> : <Eye className="size-3.5" />}
                  </Toggle>
                }
              />
              <TooltipPopup>
                {renderMarkdown ? "Show markdown source" : "Show rendered markdown"}
              </TooltipPopup>
            </Tooltip>
          ) : null}
          {canOpenInBrowser ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Toggle
                    className="shrink-0"
                    pressed={false}
                    onPressedChange={handleOpenInBrowser}
                    aria-label="Open file in preview browser"
                    variant="ghost"
                    size="sm"
                  >
                    <Globe2 className="size-3.5" />
                  </Toggle>
                }
              />
              <TooltipPopup>Open file in preview browser</TooltipPopup>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  className="shrink-0"
                  pressed={explorerOpen}
                  onPressedChange={toggleExplorer}
                  aria-label={explorerOpen ? "Hide file explorer" : "Show file explorer"}
                  variant="ghost"
                  size="sm"
                >
                  <FolderTree className="size-3.5" />
                </Toggle>
              }
            />
            <TooltipPopup>
              {explorerOpen ? "Hide file explorer" : "Show file explorer"}
            </TooltipPopup>
          </Tooltip>
        </div>
      ) : null}
      {relativePath && file.data?.truncated ? (
        <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/8 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          Preview limited to the first 1 MB of a {file.data.byteLength.toLocaleString()} byte file.
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className={cn(
            "min-w-0 flex-1 flex-col overflow-hidden",
            relativePath ? "flex" : "hidden",
          )}
        >
          {relativePath && isImage && absolutePath ? (
            <FilePreviewImageSurface
              key={absolutePath}
              environmentId={environmentId}
              threadRef={threadRef}
              absolutePath={absolutePath}
              alt={relativePath}
            />
          ) : relativePath && file.error && file.data === null ? (
            <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-xs leading-relaxed text-destructive">
              {file.error}
            </div>
          ) : relativePath && file.data === null ? (
            <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
              <LoaderCircle className="size-5 animate-spin" />
            </div>
          ) : relativePath && file.data ? (
            previewMode === "rendered-markdown" ? (
              <RenderedMarkdownSurface
                environmentId={environmentId}
                cwd={cwd}
                relativePath={relativePath}
                threadRef={threadRef}
                contents={file.data.contents}
                onPendingChange={onPendingChange}
              />
            ) : previewMode === "read-only-source" ? (
              <FilePreviewReadOnlySurface
                cwd={cwd}
                relativePath={relativePath}
                contents={file.data.contents}
                byteLength={file.data.byteLength}
                resolvedTheme={resolvedTheme}
                wordWrap={wordWrap}
                onPostRender={onFilePostRender}
              />
            ) : (
              <EditableFileSurface
                key={`${relativePath}:${resolvedTheme}`}
                environmentId={environmentId}
                cwd={cwd}
                relativePath={relativePath}
                composerDraftTarget={composerDraftTarget}
                contents={file.data.contents}
                resolvedTheme={resolvedTheme}
                revealRequestId={revealRequestId}
                wordWrap={wordWrap}
                keybindings={keybindings}
                onPostRender={onFilePostRender}
                onPendingChange={onPendingChange}
              />
            )
          ) : null}
        </div>
        {explorerOpen || relativePath === null ? (
          <aside
            className={cn(
              "flex min-h-0 shrink-0 bg-background",
              relativePath
                ? "w-[min(22rem,46%)] min-w-64 border-l border-border/60"
                : "min-w-0 flex-1",
            )}
          >
            <FileBrowserPanel
              key={`${environmentId}:${cwd}`}
              environmentId={environmentId}
              cwd={cwd}
              projectName={projectName}
              onOpenFile={onOpenFile}
            />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
