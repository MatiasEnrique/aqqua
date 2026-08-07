import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@aqqua/client-runtime/environment";
import {
  type CardOperationKind,
  cardActionAvailability,
  cardArtifactProvenance,
  cardStepThreadId,
  isCardDeleting,
  selectSubAgentThreads,
} from "@aqqua/client-runtime/state/boards";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@aqqua/client-runtime/state/runtime";
import type { CardId, EnvironmentId, ProjectId, ThreadId } from "@aqqua/contracts";
import { InfoIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { threadPanelOwner, useRightPanelStore } from "../../rightPanelStore";
import { boardArtifacts, boardEnvironment, useBoard, useCard } from "../../state/boards";
import {
  useThreadDetail,
  useThreadShell,
  useThreadShells,
  useThreadStatus,
} from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { resolveThreadSyncPhase } from "../../threadSync";
import ChatView from "../ChatView";
import type { ComposerBannerStackItem } from "../chat/ComposerBannerStack";
import { useRelativeTimeTick } from "../settings/settingsLayout";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { cardFailureNote } from "./BoardRunTable.logic";
import { CardArtifactPane } from "./CardArtifactPane";
import { CardComposerActions } from "./CardComposerActions";
import {
  artifactVisibilityRevision,
  buildCardTree,
  type CardSelection,
  type CardTreeArtifactStat,
  type CardTreeDiffStat,
  type CardTreeThread,
  cardComposerOperation,
  cardThreadRecovery,
  formatCardSelection,
  isPendingOperationResolved,
  type PendingCardOperation,
  parseCardSelection,
  resolveCardSelection,
  resolveCardThreadPresence,
  selectionThreadId,
} from "./CardDetail.logic";
import { FlowStepTabs } from "./FlowStepTabs";

export interface CardDetailViewProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly cardId: CardId;
  /** Selection is in the URL so a card detail link opens the same row. */
  readonly selectionParam: string | null;
  readonly onSelectionChange: (next: string) => void;
}

type PendingConfirmation = "retry" | "reset" | "delete" | null;

/** The card command a composer action sends, and the operation it starts. */
type CardCommandKind = "continue" | "retry" | "reset" | "delete";

const COMMAND_OPERATIONS: Record<CardCommandKind, CardOperationKind> = {
  continue: "advancing",
  retry: "retrying",
  reset: "resetting",
  delete: "deleting",
};

const COMMAND_FAILURE_TITLES: Record<CardCommandKind, string> = {
  continue: "Could not continue card",
  retry: "Could not retry card",
  reset: "Could not reset card",
  delete: "Could not delete card",
};

/** Why a card is parked, in the composer's own banner stack. */
const CARD_STATUS_NOTES: Record<
  string,
  {
    readonly variant: ComposerBannerStackItem["variant"];
    readonly text: string;
  } | null
> = {
  none: null,
  running: null,
  paused: {
    variant: "warning",
    text: "This step is done and waiting on you — review its artifact, then Resume.",
  },
  "needs-input": {
    variant: "warning",
    text: "This step stopped without reporting. Reply here, or mark it done from the Resume menu.",
  },
  failed: {
    variant: "error",
    text: "This step's turn errored. Retry it fresh, or take over in the thread.",
  },
  cancelled: {
    variant: "info",
    text: "This step was cancelled. Reply here to resume it, retry it fresh, reset the card, or mark it done.",
  },
  deleting: {
    variant: "info",
    text: "Deleting this card's conversations, worktree, and artifacts…",
  },
};

/**
 * Card detail: the card tree in the rail, one detail slot on the app's own
 * chat surface. Selecting a step thread or a sub-agent binds the surface to
 * that thread; selecting an artifact swaps the timeline for the document and
 * keeps the step's composer underneath it.
 */
export function CardDetailView({
  environmentId,
  projectId,
  cardId,
  selectionParam,
  onSelectionChange,
}: CardDetailViewProps) {
  const projectRef = useMemo(
    () => scopeProjectRef(environmentId, projectId),
    [environmentId, projectId],
  );
  const card = useCard(projectRef, cardId);
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  // Projects can hold several boards; the card knows which one it runs on.
  const board = useBoard(environmentId, card?.boardId ?? null);
  const nowMs = useRelativeTimeTick();
  const allThreadShells = useThreadShells();
  const openRightPanel = useRightPanelStore((state) => state.open);

  const continueCard = useAtomCommand(boardEnvironment.continueCard);
  const retryCard = useAtomCommand(boardEnvironment.retryCard);
  const resetCard = useAtomCommand(boardEnvironment.resetCard);
  const deleteCard = useAtomCommand(boardEnvironment.deleteCard);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation>(null);
  // Local only, and only until the projection catches up: the server decides
  // what actually happens to the card, this just keeps one click from being
  // submitted twice while the command is on the wire.
  const [pendingOperation, setPendingOperation] = useState<PendingCardOperation | null>(null);
  const [cleanupRetryPending, setCleanupRetryPending] = useState(false);

  const threads = useMemo<ReadonlyArray<CardTreeThread>>(
    () =>
      allThreadShells
        .filter((shell) => shell.environmentId === environmentId)
        .map((shell) => ({
          id: shell.id,
          title: shell.title,
          parentThreadId: shell.parentThreadId ?? null,
          createdAt: shell.createdAt,
          updatedAt: shell.updatedAt,
          isWorking: shell.session?.status === "running" || shell.session?.status === "starting",
          needsInput: shell.hasPendingApprovals || shell.hasPendingUserInput,
        })),
    [allThreadShells, environmentId],
  );

  const requested = useMemo(() => parseCardSelection(selectionParam), [selectionParam]);
  const subAgentThreadIds = useMemo(() => {
    if (card === null || requested === null) return new Set<string>();
    const parent = cardStepThreadId(card, requested.stepIndex);
    return new Set(selectSubAgentThreads(threads, parent).map((thread) => thread.id as string));
  }, [card, requested, threads]);

  const selection = useMemo<CardSelection>(() => {
    if (card === null || board === null) {
      return { kind: "step", stepIndex: 0 };
    }
    return resolveCardSelection({ card, board, requested, subAgentThreadIds });
  }, [board, card, requested, subAgentThreadIds]);

  const threadId = card === null ? null : selectionThreadId(card, selection);
  const threadRef = useMemo(
    () => (threadId === null ? null : scopeThreadRef(environmentId, threadId)),
    [environmentId, threadId],
  );
  const threadShell = useThreadShell(threadRef);
  const threadDetail = useThreadDetail(threadRef);
  const threadStatus = useThreadStatus(threadRef);

  // The step's diff, from the checkpoints the app already keeps for its diff
  // panel — every file the step's turns touched, deduped across turns.
  const diffByThreadId = useMemo(() => {
    const map = new Map<string, CardTreeDiffStat>();
    if (threadDetail === null || threadId === null) return map;
    const byPath = new Map<string, { additions: number; deletions: number }>();
    for (const checkpoint of threadDetail.checkpoints) {
      for (const file of checkpoint.files) {
        const existing = byPath.get(file.path) ?? {
          additions: 0,
          deletions: 0,
        };
        byPath.set(file.path, {
          additions: existing.additions + file.additions,
          deletions: existing.deletions + file.deletions,
        });
      }
    }
    if (byPath.size === 0) return map;
    let additions = 0;
    let deletions = 0;
    for (const stat of byPath.values()) {
      additions += stat.additions;
      deletions += stat.deletions;
    }
    map.set(threadId, { filesChanged: byPath.size, additions, deletions });
    return map;
  }, [threadDetail, threadId]);

  const steps = card?.snapshot?.steps ?? board?.steps ?? [];
  const currentStepIndex = card?.position.kind === "step" ? card.position.stepIndex : null;
  const artifactStepName =
    selection.kind === "artifact" ? (steps[selection.stepIndex]?.name ?? null) : null;
  const currentStepName =
    currentStepIndex === null ? null : (steps[currentStepIndex]?.name ?? null);

  const selectedArtifact = useEnvironmentQuery(
    artifactStepName === null
      ? null
      : boardArtifacts.artifact({
          environmentId,
          input: { cardId, stepName: artifactStepName },
        }),
  );
  const currentArtifact = useEnvironmentQuery(
    currentStepName === null || currentStepName === artifactStepName
      ? null
      : boardArtifacts.artifact({
          environmentId,
          input: { cardId, stepName: currentStepName },
        }),
  );

  const selectedArtifactRevision =
    card === null || selection.kind !== "artifact"
      ? null
      : artifactVisibilityRevision(card, selection.stepIndex);
  const currentArtifactRevision =
    card === null || currentStepIndex === null || currentStepName === artifactStepName
      ? null
      : artifactVisibilityRevision(card, currentStepIndex);

  // Artifact files are written by the provider outside the projection stream.
  // A step becoming reviewable is therefore the precise signal to invalidate
  // the cached read for an artifact that is already visible or selected.
  useEffect(() => {
    if (selectedArtifactRevision === null) return;
    void selectedArtifact.refresh().catch(() => undefined);
  }, [selectedArtifact.refresh, selectedArtifactRevision]);
  useEffect(() => {
    if (currentArtifactRevision === null) return;
    void currentArtifact.refresh().catch(() => undefined);
  }, [currentArtifact.refresh, currentArtifactRevision]);

  const artifactByStepIndex = useMemo(() => {
    const map = new Map<number, CardTreeArtifactStat>();
    const encoder = new TextEncoder();
    const record = (
      stepIndex: number | null,
      content: string | null | undefined,
      exists: boolean | undefined,
    ) => {
      if (stepIndex === null || exists === undefined) return;
      map.set(stepIndex, {
        exists,
        sizeBytes: content === null || content === undefined ? 0 : encoder.encode(content).length,
      });
    };
    if (selection.kind === "artifact") {
      record(selection.stepIndex, selectedArtifact.data?.content, selectedArtifact.data?.exists);
    }
    record(currentStepIndex, currentArtifact.data?.content, currentArtifact.data?.exists);
    return map;
  }, [currentArtifact.data, currentStepIndex, selectedArtifact.data, selection]);

  const tree = useMemo(() => {
    if (card === null || board === null) return null;
    return buildCardTree({
      card,
      board,
      threads,
      diffByThreadId,
      artifactByStepIndex,
      nowMs,
    });
  }, [artifactByStepIndex, board, card, diffByThreadId, nowMs, threads]);

  const select = useCallback(
    (next: CardSelection) => {
      onSelectionChange(formatCardSelection(next));
    },
    [onSelectionChange],
  );

  const availability = useMemo(() => {
    if (card === null) return null;
    const base = cardActionAvailability(card);
    return {
      ...base,
      canReset: base.canReset && serverConfig?.environment.capabilities.boardCardReset === true,
    };
  }, [card, serverConfig?.environment.capabilities.boardCardReset]);
  const isLastStep = currentStepIndex !== null && currentStepIndex === steps.length - 1;

  const runCardCommand = useCallback(
    (kind: CardCommandKind) => {
      if (card === null) return;
      const command =
        kind === "continue"
          ? continueCard
          : kind === "retry"
            ? retryCard
            : kind === "reset"
              ? resetCard
              : deleteCard;
      setPendingOperation({
        kind: COMMAND_OPERATIONS[kind],
        cardUpdatedAt: card.updatedAt,
      });
      void command({ environmentId, input: { cardId } }).then((result) => {
        if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
        // A rejected command starts nothing — hand the buttons straight back.
        setPendingOperation(null);
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: COMMAND_FAILURE_TITLES[kind],
            description: error instanceof Error ? error.message : "The card command failed.",
          }),
        );
      });
    },
    [card, cardId, continueCard, deleteCard, environmentId, resetCard, retryCard],
  );

  const retryCleanup = useCallback(() => {
    if (
      card === null ||
      (card.operation?.kind !== "resetting" && card.operation?.kind !== "deleting")
    ) {
      return;
    }
    const kind = card.operation.kind;
    const command = kind === "resetting" ? resetCard : deleteCard;
    setCleanupRetryPending(true);
    void command({ environmentId, input: { cardId } }).then((result) => {
      setCleanupRetryPending(false);
      if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: kind === "resetting" ? "Could not resume reset" : "Could not resume deletion",
          description: error instanceof Error ? error.message : "The cleanup command failed.",
        }),
      );
    });
  }, [card, cardId, deleteCard, environmentId, resetCard]);

  // The guard is a bridge, never a state: it lasts exactly until the card comes
  // back changed, carries its own operation, or leaves the board.
  useEffect(() => {
    if (pendingOperation === null) return;
    if (isPendingOperationResolved(pendingOperation, card)) setPendingOperation(null);
  }, [card, pendingOperation]);

  const cardOperationInFlight = cardComposerOperation(card, pendingOperation);
  const failureNote = card === null ? null : cardFailureNote(card);

  const renderComposerIdlePrimaryAction = useMemo(() => {
    // Sub-agents keep the plain send arrow: only the step can move the card.
    // So do finished steps — the card's actions belong to where it sits.
    if (card === null || availability === null) return undefined;
    if (selection.kind === "subagent" || card.position.kind !== "step") return undefined;
    if (selection.stepIndex !== currentStepIndex) return undefined;
    return (state: { promptHasText: boolean; disabled: boolean; focusComposer: () => void }) => (
      <CardComposerActions
        promptHasText={state.promptHasText}
        disabled={state.disabled}
        availability={availability}
        operation={cardOperationInFlight}
        canResumeWithoutMessage={card.status === "paused"}
        isLastStep={isLastStep}
        onResume={() => {
          if (card.status === "paused") {
            runCardCommand("continue");
            return;
          }
          state.focusComposer();
        }}
        onRetry={() => setPendingConfirmation("retry")}
        onMarkDone={() => runCardCommand("continue")}
        onReset={() => setPendingConfirmation("reset")}
      />
    );
  }, [
    availability,
    card,
    cardOperationInFlight,
    currentStepIndex,
    isLastStep,
    runCardCommand,
    selection,
  ]);

  const composerBanners = useMemo<ReadonlyArray<ComposerBannerStackItem>>(() => {
    if (selection.kind === "subagent") {
      // The hint only applies once the sub-agent has returned; while its turn
      // is still in flight the composer behaves like any live conversation.
      const returned = threadShell !== null && threadShell.latestTurn?.state !== "running";
      if (!returned) return [];
      return [
        {
          id: `board-subagent:${selection.threadId}`,
          variant: "info",
          icon: <InfoIcon />,
          title: (
            <span className="font-normal text-muted-foreground">
              This thread has already returned; new turns won't move the card.
            </span>
          ),
        },
      ];
    }
    if (selection.stepIndex !== currentStepIndex) return [];
    // An operation that failed says so first, and keeps saying so: it is the
    // reason a card is back where the user thought it had left.
    if (failureNote !== null) {
      return [
        {
          id: `board-card-failure:${cardId}`,
          variant: "error",
          icon: <InfoIcon />,
          title: <span className="font-normal text-muted-foreground">{failureNote}</span>,
        },
      ];
    }
    // Why the card is sitting still, said once, next to the actions that
    // resolve it. The badge in the rail says the same thing at a glance.
    const note = card === null ? null : CARD_STATUS_NOTES[card.status ?? "none"];
    if (note === null || note === undefined) {
      return [];
    }
    return [
      {
        id: `board-card-status:${cardId}:${card?.status ?? "none"}`,
        variant: note.variant,
        icon: <InfoIcon />,
        title: <span className="font-normal text-muted-foreground">{note.text}</span>,
      },
    ];
  }, [card, cardId, currentStepIndex, failureNote, selection, threadShell]);

  const timelineOverride = useMemo(() => {
    if (selection.kind !== "artifact" || card === null || board === null) return undefined;
    const stepName = artifactStepName;
    if (stepName === null) return undefined;
    return (contentInsetEndAdjustment: number) => (
      <CardArtifactPane
        key={`${cardId}:${stepName}`}
        environmentId={environmentId}
        cardId={cardId}
        stepIndex={selection.stepIndex}
        stepName={stepName}
        fileName={`${stepName}.md`}
        provenance={cardArtifactProvenance(card, board, selection.stepIndex)}
        editable={card.status !== "running" || selection.stepIndex !== currentStepIndex}
        cwd={card.worktreePath}
        contentInsetEndAdjustment={contentInsetEndAdjustment}
      />
    );
  }, [artifactStepName, board, card, cardId, currentStepIndex, environmentId, selection]);

  if (card === null || board === null || tree === null) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-muted-foreground text-sm">
        This card is no longer in the flow.
      </div>
    );
  }

  const surfaceTabs = (
    <FlowStepTabs
      model={tree}
      selection={selection}
      onSelect={select}
      onOpenDiff={(leaf) => {
        select({ kind: "step", stepIndex: leaf.stepIndex });
        openRightPanel(threadPanelOwner(scopeThreadRef(environmentId, leaf.threadId)), "diff");
      }}
    />
  );

  const confirmation =
    pendingConfirmation === null ? null : (
      <AlertDialog
        open
        onOpenChange={(open) => {
          if (!open) setPendingConfirmation(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingConfirmation === "retry"
                ? "Retry this step?"
                : pendingConfirmation === "delete"
                  ? `Delete '${card.title}'?`
                  : `Reset '${card.title}'?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingConfirmation === "retry"
                ? "The step's thread is discarded and a fresh one runs the same prompt again. The worktree keeps whatever the previous attempt changed."
                : pendingConfirmation === "delete"
                  ? "This removes the card from the flow along with its conversations, worktree, and artifacts. It cannot be undone."
                  : "This stops the current run, archives its step conversations, clears its artifacts, and returns the card to To-Do. Starting it again uses the latest flow configuration and keeps the existing worktree changes."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Keep going</AlertDialogClose>
            <Button
              variant={pendingConfirmation === "retry" ? "default" : "destructive"}
              onClick={() => {
                const kind = pendingConfirmation;
                setPendingConfirmation(null);
                if (kind === null) return;
                runCardCommand(kind);
              }}
            >
              {pendingConfirmation === "retry"
                ? "Retry step"
                : pendingConfirmation === "delete"
                  ? "Delete card"
                  : "Reset card"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    );

  if (isCardDeleting(card)) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {surfaceTabs}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-sm">
          <Trash2Icon aria-hidden className="size-5 text-destructive-foreground" />
          <span className="font-medium text-foreground">
            {card.lastError === null ? "Deleting card…" : "Deletion needs another attempt"}
          </span>
          <span className="max-w-md text-muted-foreground">
            {card.lastError ??
              "Removing its conversations, worktree, and artifacts. The card has already left the flow; this view closes when cleanup finishes."}
          </span>
          {card.lastError === null ? null : (
            <Button size="sm" onClick={retryCleanup} disabled={cleanupRetryPending}>
              {cleanupRetryPending ? <Spinner className="size-3.5" /> : <RotateCcwIcon />}
              Retry cleanup
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (card.operation?.kind === "resetting") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {surfaceTabs}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-sm">
          {card.lastError === null ? (
            <Spinner className="size-5" />
          ) : (
            <RotateCcwIcon aria-hidden className="size-5 text-warning-foreground" />
          )}
          <span className="font-medium text-foreground">
            {card.lastError === null ? "Resetting card…" : "Reset needs another attempt"}
          </span>
          <span className="max-w-md text-muted-foreground">
            {card.lastError ??
              "Archiving its conversations and removing artifacts. The card returns to To-Do when cleanup finishes."}
          </span>
          {card.lastError === null ? null : (
            <Button size="sm" onClick={retryCleanup} disabled={cleanupRetryPending}>
              {cleanupRetryPending ? <Spinner className="size-3.5" /> : <RotateCcwIcon />}
              Retry cleanup
            </Button>
          )}
        </div>
      </div>
    );
  }

  const presence = resolveCardThreadPresence({
    card,
    selection,
    threadId,
    threadShellExists: threadShell !== null,
  });

  if (presence !== "linked" || threadRef === null) {
    if (presence === "unavailable") {
      const recovery = cardThreadRecovery({
        card,
        selection,
        resetSupported: serverConfig?.environment.capabilities.boardCardReset === true,
      });
      const isCurrentStep =
        card.position.kind === "step" &&
        selection.kind === "step" &&
        selection.stepIndex === card.position.stepIndex;
      const busy = cardOperationInFlight !== null;
      const actions = [
        recovery.canRetryStep
          ? { key: "retry", label: "Retry step", run: () => setPendingConfirmation("retry") }
          : null,
        recovery.canMarkDone
          ? {
              key: "continue",
              label: isLastStep ? "Mark step done" : "Continue",
              run: () => runCardCommand("continue"),
            }
          : null,
        recovery.canReset
          ? { key: "reset", label: "Reset card", run: () => setPendingConfirmation("reset") }
          : null,
        recovery.canDelete
          ? { key: "delete", label: "Delete card", run: () => setPendingConfirmation("delete") }
          : null,
      ].flatMap((action) => (action === null ? [] : [action]));
      return (
        <div className="flex h-full min-h-0 flex-col">
          {surfaceTabs}
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-sm">
            <InfoIcon aria-hidden className="size-5 text-muted-foreground" />
            <span className="font-medium text-foreground">This flow conversation was removed.</span>
            <span className="max-w-md text-muted-foreground">
              {isCurrentStep
                ? "The card still points at this step, but its conversation no longer exists. Pick it up again from here, or clear the card."
                : "This conversation is no longer available, so its history cannot be shown."}
            </span>
            {actions.length === 0 ? null : (
              <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
                {actions.map((action) => (
                  <Button
                    key={action.key}
                    size="sm"
                    variant={action.key === "delete" ? "destructive" : "outline"}
                    disabled={busy}
                    onClick={action.run}
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
          {confirmation}
        </div>
      );
    }
    // Between Start and the first step thread the server is doing real work
    // (worktree, checkout, setup script) — show that instead of a dead pane.
    return (
      <div className="flex h-full min-h-0 flex-col">
        {surfaceTabs}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground text-sm">
          {presence === "unreleased" ? (
            "This card has not been released yet — start it from the flow."
          ) : (
            <>
              <Spinner className="size-4" />
              <span>
                {presence === "starting"
                  ? "Starting this card — creating its worktree and checking out the branch…"
                  : "Preparing this step's thread…"}
              </span>
            </>
          )}
        </div>
        {confirmation}
      </div>
    );
  }

  return (
    <>
      <ChatView
        key={threadId ?? "none"}
        environmentId={environmentId}
        threadId={threadRef.threadId as ThreadId}
        routeKind="server"
        threadSyncPhase={resolveThreadSyncPhase({
          detailExists: threadDetail !== null,
          shellExists: true,
          status: threadStatus,
        })}
        surfaceTabs={surfaceTabs}
        composerBanners={composerBanners}
        {...(timelineOverride === undefined ? {} : { timelineOverride })}
        {...(renderComposerIdlePrimaryAction === undefined
          ? {}
          : { renderComposerIdlePrimaryAction })}
      />
      {confirmation}
    </>
  );
}
