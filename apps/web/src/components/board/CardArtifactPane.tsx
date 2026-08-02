import type { CardArtifactProvenance } from "@aqqua/client-runtime/state/boards";
import type { CardId, EnvironmentId } from "@aqqua/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import ChatMarkdown from "../ChatMarkdown";
import { boardArtifacts, boardEnvironment } from "../../state/boards";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";

const WRITE_DEBOUNCE_MS = 600;

type SaveState = "idle" | "saving" | "saved" | "error";

export interface CardArtifactPaneProps {
  readonly environmentId: EnvironmentId;
  readonly cardId: CardId;
  readonly stepIndex: number;
  readonly stepName: string;
  readonly fileName: string;
  readonly provenance: CardArtifactProvenance | null;
  /**
   * Editing is the manual-gate review flow, so it is on whenever the step is
   * not mid-turn. A running step owns its own file; we do not race it.
   */
  readonly editable: boolean;
  readonly cwd: string | null;
  /** Measured height of the floating composer that covers the scrollport. */
  readonly contentInsetEndAdjustment: number;
}

const ARTIFACT_END_GUTTER_PX = 32;

export function artifactContentBottomPadding(contentInsetEndAdjustment: number): number {
  return Math.max(0, contentInsetEndAdjustment) + ARTIFACT_END_GUTTER_PX;
}

/**
 * The artifact rendered in the chat surface's own message column — the
 * document, its provenance, and nothing else. Editing is in place: no edit
 * mode, no save button, just a debounced write behind the caret.
 */
export function CardArtifactPane({
  environmentId,
  cardId,
  stepIndex,
  stepName,
  fileName,
  provenance,
  editable,
  cwd,
  contentInsetEndAdjustment,
}: CardArtifactPaneProps) {
  const artifact = useEnvironmentQuery(
    boardArtifacts.artifact({ environmentId, input: { cardId, stepName } }),
  );
  const writeArtifact = useAtomCommand(boardEnvironment.writeArtifact);

  const [draft, setDraft] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingWrite = useRef<number | null>(null);
  const unsaved = useRef<string | null>(null);

  const serverContent = artifact.data?.content ?? "";
  const content = draft ?? serverContent;

  const flush = useCallback(
    (next: string) => {
      setSaveState("saving");
      void writeArtifact({ environmentId, input: { cardId, stepName, content: next } }).then(
        (result) => {
          setSaveState(result._tag === "Success" ? "saved" : "error");
        },
      );
    },
    [cardId, environmentId, stepName, writeArtifact],
  );

  const onChange = useCallback(
    (next: string) => {
      setDraft(next);
      setSaveState("saving");
      unsaved.current = next;
      if (pendingWrite.current !== null) {
        window.clearTimeout(pendingWrite.current);
      }
      pendingWrite.current = window.setTimeout(() => {
        pendingWrite.current = null;
        unsaved.current = null;
        flush(next);
      }, WRITE_DEBOUNCE_MS);
    },
    [flush],
  );

  // Leaving the document (another selection, or the route) must not lose the
  // last keystrokes: whatever the debounce still owed gets written on the way
  // out. The pane is keyed per artifact, so unmount is the artifact changing.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(
    () => () => {
      if (pendingWrite.current !== null) {
        window.clearTimeout(pendingWrite.current);
      }
      if (unsaved.current !== null) {
        flushRef.current(unsaved.current);
        unsaved.current = null;
      }
    },
    [],
  );

  const startEditing = useCallback(() => {
    if (!editable) return;
    setIsEditing(true);
    window.requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (element === null) return;
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
    });
  }, [editable]);

  const hint = useMemo(() => {
    if (!editable) return "read-only while the step is running";
    switch (saveState) {
      case "saving":
        return "saving…";
      case "saved":
        return "Saved";
      case "error":
        return "save failed — retry by typing again";
      case "idle":
        return "editable — click to type";
    }
  }, [editable, saveState]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div
        className="mx-auto w-full max-w-3xl px-5 pt-4"
        style={{ paddingBottom: artifactContentBottomPadding(contentInsetEndAdjustment) }}
      >
        <ArtifactProvenance provenance={provenance} fileName={fileName} stepIndex={stepIndex} />

        <div className="mt-4 flex items-center gap-2 px-1 text-muted-foreground/70 text-xs">
          <span className="font-mono">{artifact.data?.path ?? fileName}</span>
          <span aria-live="polite" className={cn(saveState === "error" && "text-destructive")}>
            {hint}
          </span>
        </div>

        <div className="mt-2">
          {isEditing ? (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(event) => onChange(event.target.value)}
              onBlur={() => setIsEditing(false)}
              spellCheck={false}
              className="min-h-96 w-full resize-none bg-transparent px-1 text-[14px] text-foreground/80 leading-[23px] outline-none"
              aria-label={`${fileName} contents`}
            />
          ) : (
            <button
              type="button"
              onClick={startEditing}
              disabled={!editable}
              className={cn("w-full px-1 text-left", editable ? "cursor-text" : "cursor-default")}
              aria-label={editable ? `Edit ${fileName}` : `${fileName}, read-only`}
            >
              {content.trim() === "" ? (
                <p className="text-muted-foreground/60 text-sm">
                  {artifact.isPending
                    ? "Loading…"
                    : "Nothing written yet — the step writes this file, or you can start it here."}
                </p>
              ) : (
                <ChatMarkdown text={content} cwd={cwd ?? undefined} />
              )}
            </button>
          )}
        </div>

        {artifact.error === null ? null : (
          <p className="mt-3 px-1 text-destructive text-xs">{artifact.error}</p>
        )}
      </div>
    </div>
  );
}

function ArtifactProvenance({
  provenance,
  fileName,
  stepIndex,
}: {
  readonly provenance: CardArtifactProvenance | null;
  readonly fileName: string;
  readonly stepIndex: number;
}) {
  if (provenance === null) return null;
  return (
    <div className="flex flex-col gap-1.5 px-1 text-muted-foreground text-xs">
      <div>
        <span className="text-foreground/80">
          {stepIndex + 1} · {provenance.writtenBy.stepName}
        </span>{" "}
        wrote <span className="font-mono">{fileName}</span>
      </div>
      {provenance.readBy.map((reader) => (
        <div key={`${reader.stepIndex}:${reader.placeholder}`}>
          read by{" "}
          <span className="text-foreground/80">
            {reader.stepIndex + 1} · {reader.stepName}
          </span>{" "}
          as{" "}
          <span className="rounded bg-foreground/[0.06] px-1 py-0.5 font-mono text-[11px]">
            {reader.placeholder}
          </span>
        </div>
      ))}
    </div>
  );
}
