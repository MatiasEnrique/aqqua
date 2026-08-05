import type { CardArtifactProvenance } from "@aqqua/client-runtime/state/boards";
import type { CardId, EnvironmentId } from "@aqqua/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

import { cn } from "~/lib/utils";
import ChatMarkdown from "../ChatMarkdown";
import { boardArtifacts, boardEnvironment } from "../../state/boards";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { CardArtifactMarkdownEditor } from "./CardArtifactMarkdownEditor";

type SaveState = "idle" | "saving" | "saved" | "error";

type SettledSaveState = Exclude<SaveState, "idle" | "saving">;

export function createArtifactSaveCoordinator(initialContent: string) {
  let confirmedContent = initialContent;
  let desiredContent = initialContent;
  let dirty = false;
  let nextRequestId = 0;
  let latestSuccessfulRequestId = 0;
  const inFlightRequestIds = new Set<number>();

  return {
    markDirty() {
      dirty = true;
    },
    observeConfirmed(content: string) {
      if (dirty || inFlightRequestIds.size > 0) return false;
      confirmedContent = content;
      desiredContent = content;
      return true;
    },
    startWrite(content: string) {
      dirty = false;
      desiredContent = content;
      nextRequestId += 1;
      const request = { id: nextRequestId, content } as const;
      inFlightRequestIds.add(request.id);
      return request;
    },
    finishWrite(
      request: { readonly id: number; readonly content: string },
      outcome: SettledSaveState,
    ): SettledSaveState | null {
      inFlightRequestIds.delete(request.id);
      if (outcome === "saved" && request.id >= latestSuccessfulRequestId) {
        latestSuccessfulRequestId = request.id;
        confirmedContent = request.content;
      }
      if (dirty || inFlightRequestIds.size > 0) return null;
      return desiredContent === confirmedContent ? "saved" : "error";
    },
    settleNoop(content: string): SettledSaveState | null {
      dirty = false;
      desiredContent = content;
      if (inFlightRequestIds.size > 0) return null;
      return desiredContent === confirmedContent ? "saved" : "error";
    },
    getConfirmedContent() {
      return confirmedContent;
    },
    getDesiredContent() {
      return desiredContent;
    },
    canReleaseDraft(content: string) {
      return (
        !dirty &&
        inFlightRequestIds.size === 0 &&
        desiredContent === content &&
        confirmedContent === content
      );
    },
    canSettle(content: string) {
      return inFlightRequestIds.size === 0 && confirmedContent === content;
    },
  };
}

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

export function artifactContentIsAvailable(
  hasLoadedArtifact: boolean,
  draft: string | null,
): boolean {
  return hasLoadedArtifact || draft !== null;
}

export function artifactEditorCanMount(
  hasLoadedArtifact: boolean,
  loadError: string | null,
): boolean {
  return hasLoadedArtifact && loadError === null;
}

/**
 * The artifact rendered in the chat surface's own message column — the
 * document, its provenance, and nothing else. Editing is in place: no edit
 * mode, no save button, just a debounced Markdown write behind the caret.
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
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveCoordinator] = useState(() => createArtifactSaveCoordinator(""));

  const serverContent = artifact.data?.content ?? "";
  const content = draft ?? serverContent;
  const contentIsAvailable = artifactContentIsAvailable(artifact.data !== null, draft);
  const editorCanMount = artifactEditorCanMount(artifact.data !== null, artifact.error);

  useEffect(() => {
    if (artifact.data === null) return;
    if (!saveCoordinator.observeConfirmed(serverContent)) return;
    setDraft(null);
  }, [artifact.data, saveCoordinator, serverContent]);

  const save = useCallback(
    (next: string) => {
      const request = saveCoordinator.startWrite(next);
      setDraft(next);
      setSaveState("saving");
      void writeArtifact({ environmentId, input: { cardId, stepName, content: next } }).then(
        (result) => {
          const nextState = saveCoordinator.finishWrite(
            request,
            result._tag === "Success" ? "saved" : "error",
          );
          if (nextState !== null) setSaveState(nextState);
          if (nextState !== "saved") return;

          const settledContent = saveCoordinator.getDesiredContent();
          void artifact.refresh().then(
            () => {
              if (!saveCoordinator.canReleaseDraft(settledContent)) return;
              setDraft((current) => (current === settledContent ? null : current));
            },
            () => undefined,
          );
        },
      );
    },
    [artifact.refresh, cardId, environmentId, saveCoordinator, stepName, writeArtifact],
  );

  const markDirty = useCallback(() => {
    saveCoordinator.markDirty();
    setSaveState("saving");
  }, [saveCoordinator]);
  const isPersistedValue = useCallback(
    (next: string) => saveCoordinator.canSettle(next),
    [saveCoordinator],
  );
  const markSettled = useCallback(
    (next: string) => {
      const nextState = saveCoordinator.settleNoop(next);
      if (nextState !== null) setSaveState(nextState);
    },
    [saveCoordinator],
  );

  const hint = useMemo(() => {
    if (!editorCanMount) {
      return artifact.error === null ? "loading…" : "read-only — content unavailable";
    }
    if (!editable) return "read-only while the step is running";
    switch (saveState) {
      case "saving":
        return "saving…";
      case "saved":
        return "Saved";
      case "error":
        return "save failed — retry by typing again";
      case "idle":
        return "editable — type anywhere";
    }
  }, [artifact.error, editable, editorCanMount, saveState]);

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
          {!contentIsAvailable ? (
            <p className="px-1 text-muted-foreground/60 text-sm">
              {artifact.error === null
                ? "Loading…"
                : "Content unavailable — reload before editing."}
            </p>
          ) : editable && editorCanMount ? (
            <CardArtifactMarkdownEditor
              value={content}
              fileName={fileName}
              isPersistedValue={isPersistedValue}
              onDirty={markDirty}
              onCommit={save}
              onSettled={markSettled}
            />
          ) : content.trim() === "" ? (
            <p className="px-1 text-muted-foreground/60 text-sm">Nothing written yet.</p>
          ) : (
            <div className="px-1" aria-label={`${fileName}, read-only`}>
              <ChatMarkdown text={content} cwd={cwd ?? undefined} />
            </div>
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
