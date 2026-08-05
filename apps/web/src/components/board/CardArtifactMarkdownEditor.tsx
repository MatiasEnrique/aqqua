import { CodeNode } from "@lexical/code";
import {
  $createLinkNode,
  $isLinkNode,
  AutoLinkNode,
  createLinkMatcherWithRegExp,
  LinkNode,
} from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  CHECK_LIST,
  TRANSFORMERS,
  type TextMatchTransformer,
} from "@lexical/markdown";
import { AutoLinkPlugin } from "@lexical/react/LexicalAutoLinkPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { LexicalComposer, type InitialConfigType } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { $createTextNode, type EditorState, type EditorThemeClasses } from "lexical";
import { useCallback, useEffect, useMemo, useRef } from "react";

export const ARTIFACT_MARKDOWN_WRITE_DEBOUNCE_MS = 600;

const URL_PATTERN = /https?:\/\/[^\s<]+/;
const GFM_AUTOLINK: TextMatchTransformer = {
  dependencies: [LinkNode, AutoLinkNode],
  export: (node, exportChildren) => {
    if (!$isLinkNode(node) || node.getURL() !== node.getTextContent()) return null;
    return exportChildren(node);
  },
  importRegExp: URL_PATTERN,
  regExp: /https?:\/\/[^\s<]+$/,
  replace: (textNode, match) => {
    if ($isLinkNode(textNode.getParent())) return;
    const url = match[0];
    if (url === undefined) return;
    const linkNode = $createLinkNode(url);
    const linkTextNode = $createTextNode(url);
    linkTextNode.setFormat(textNode.getFormat());
    linkNode.append(linkTextNode);
    textNode.replace(linkNode);
    return linkTextNode;
  },
  type: "text-match",
};

const URL_MATCHER = createLinkMatcherWithRegExp(URL_PATTERN);
const URL_MATCHERS = [URL_MATCHER];

export const ARTIFACT_MARKDOWN_NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  CodeNode,
  LinkNode,
  AutoLinkNode,
] as const;

export const ARTIFACT_MARKDOWN_TRANSFORMERS = [CHECK_LIST, GFM_AUTOLINK, ...TRANSFORMERS];

const ARTIFACT_MARKDOWN_THEME: EditorThemeClasses = {
  code: "artifact-markdown-editor-code",
  link: "artifact-markdown-editor-link",
  list: {
    checklist: "artifact-markdown-editor-checklist",
    listitemChecked: "artifact-markdown-editor-listitem-checked",
    listitemUnchecked: "artifact-markdown-editor-listitem-unchecked",
  },
  text: {
    bold: "font-semibold text-foreground",
    italic: "italic",
    strikethrough: "line-through",
  },
};

export interface CardArtifactMarkdownEditorProps {
  readonly value: string;
  readonly fileName: string;
  readonly onDirty: () => void;
  readonly onCommit: (value: string) => void;
  readonly onSettled: (value: string) => void;
}

interface ArtifactMarkdownCommitClock {
  readonly setTimeout: (callback: () => void, delay: number) => number;
  readonly clearTimeout: (handle: number) => void;
}

export function createArtifactMarkdownCommitScheduler({
  clock,
  isCurrent,
  onDirty,
  onCommit,
  onSettled,
}: {
  readonly clock: ArtifactMarkdownCommitClock;
  readonly isCurrent: (value: string) => boolean;
  readonly onDirty: () => void;
  readonly onCommit: (value: string) => void;
  readonly onSettled: (value: string) => void;
}) {
  let dirty = false;
  let pendingEditorState: EditorState | null = null;
  let pendingCommit: number | null = null;

  const commit = () => {
    if (pendingCommit !== null) {
      clock.clearTimeout(pendingCommit);
      pendingCommit = null;
    }
    const editorState = pendingEditorState;
    if (editorState === null) return;
    pendingEditorState = null;
    dirty = false;
    const value = serializeArtifactMarkdownEditorState(editorState);
    if (isCurrent(value)) {
      onSettled(value);
      return;
    }
    onCommit(value);
  };

  return {
    schedule(editorState: EditorState) {
      pendingEditorState = editorState;
      if (!dirty) {
        dirty = true;
        onDirty();
      }
      if (pendingCommit !== null) {
        clock.clearTimeout(pendingCommit);
      }
      pendingCommit = clock.setTimeout(commit, ARTIFACT_MARKDOWN_WRITE_DEBOUNCE_MS);
    },
    flush: commit,
  };
}

/** A rich document surface whose storage format remains Markdown. */
export function CardArtifactMarkdownEditor({
  value,
  fileName,
  onDirty,
  onCommit,
  onSettled,
}: CardArtifactMarkdownEditorProps) {
  const initialValueRef = useRef(value);
  const initialConfig = useMemo<InitialConfigType>(
    () => ({
      namespace: "aqqua-card-artifact-markdown-editor",
      editable: true,
      nodes: ARTIFACT_MARKDOWN_NODES,
      theme: ARTIFACT_MARKDOWN_THEME,
      editorState: () => {
        $convertFromMarkdownString(
          initialValueRef.current,
          ARTIFACT_MARKDOWN_TRANSFORMERS,
          undefined,
          true,
        );
      },
      onError: (error) => {
        throw error;
      },
    }),
    [],
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="relative min-h-96">
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              aria-label={`${fileName} contents`}
              className="artifact-markdown-editor chat-markdown min-h-96 w-full px-1 text-sm leading-relaxed text-foreground/80 focus:outline-none"
              spellCheck
            />
          }
          placeholder={
            <p className="pointer-events-none absolute top-0 px-1 text-muted-foreground/60 text-sm">
              Nothing written yet — start the document here.
            </p>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <ArtifactMarkdownSyncPlugin
          value={value}
          onDirty={onDirty}
          onCommit={onCommit}
          onSettled={onSettled}
        />
        <MarkdownShortcutPlugin transformers={ARTIFACT_MARKDOWN_TRANSFORMERS} />
        <ListPlugin />
        <CheckListPlugin />
        <LinkPlugin />
        <AutoLinkPlugin matchers={URL_MATCHERS} />
        <HistoryPlugin />
      </div>
    </LexicalComposer>
  );
}

function ArtifactMarkdownSyncPlugin({
  value,
  onDirty,
  onCommit,
  onSettled,
}: {
  readonly value: string;
  readonly onDirty: () => void;
  readonly onCommit: (value: string) => void;
  readonly onSettled: (value: string) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const currentMarkdownRef = useRef(value);
  const dirtyRef = useRef(false);
  const onDirtyRef = useRef(onDirty);
  const onCommitRef = useRef(onCommit);
  const onSettledRef = useRef(onSettled);
  onDirtyRef.current = onDirty;
  onCommitRef.current = onCommit;
  onSettledRef.current = onSettled;
  const schedulerRef = useRef<ReturnType<typeof createArtifactMarkdownCommitScheduler> | null>(
    null,
  );
  if (schedulerRef.current === null) {
    schedulerRef.current = createArtifactMarkdownCommitScheduler({
      clock: {
        setTimeout: (callback, delay) => window.setTimeout(callback, delay),
        clearTimeout: (handle) => window.clearTimeout(handle),
      },
      isCurrent: (nextValue) => nextValue === currentMarkdownRef.current,
      onDirty: () => {
        dirtyRef.current = true;
        onDirtyRef.current();
      },
      onCommit: (nextValue) => {
        dirtyRef.current = false;
        currentMarkdownRef.current = nextValue;
        onCommitRef.current(nextValue);
      },
      onSettled: (nextValue) => {
        dirtyRef.current = false;
        onSettledRef.current(nextValue);
      },
    });
  }

  useEffect(() => {
    if (value === currentMarkdownRef.current) return;
    if (dirtyRef.current) return;
    currentMarkdownRef.current = value;
    editor.update(() => {
      $convertFromMarkdownString(value, ARTIFACT_MARKDOWN_TRANSFORMERS, undefined, true);
    });
  }, [editor, value]);

  const handleChange = useCallback((editorState: EditorState) => {
    schedulerRef.current?.schedule(editorState);
  }, []);

  useEffect(
    () => () => {
      schedulerRef.current?.flush();
    },
    [],
  );

  return <OnChangePlugin ignoreSelectionChange onChange={handleChange} />;
}

export function serializeArtifactMarkdownEditorState(editorState: EditorState): string {
  return editorState.read(() =>
    $convertToMarkdownString(ARTIFACT_MARKDOWN_TRANSFORMERS, undefined, true),
  );
}
