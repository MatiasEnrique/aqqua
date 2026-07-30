import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  cardActionAvailability,
  cardArtifactProvenance,
  cardStepThreadId,
  selectSubAgentThreads,
} from "@t3tools/client-runtime/state/boards";
import type { CardId, EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { InfoIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

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
import { boardArtifacts, boardEnvironment, useCard, useProjectBoard } from "../../state/boards";
import {
  useThreadDetail,
  useThreadShell,
  useThreadShells,
  useThreadStatus,
} from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { resolveThreadSyncPhase } from "../../threadSync";
import { threadPanelOwner, useRightPanelStore } from "../../rightPanelStore";
import { CardArtifactPane } from "./CardArtifactPane";
import { CardComposerActions } from "./CardComposerActions";
import {
  buildCardTree,
  formatCardSelection,
  parseCardSelection,
  resolveCardSelection,
  selectionThreadId,
  type CardSelection,
  type CardTreeArtifactStat,
  type CardTreeDiffStat,
  type CardTreeThread,
} from "./CardDetail.logic";
import { CardTree } from "./CardTree";

export interface CardDetailViewProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly cardId: CardId;
  /** Selection is in the URL so a card detail link opens the same row. */
  readonly selectionParam: string | null;
  readonly onSelectionChange: (next: string) => void;
}

type PendingConfirmation = "retry" | "cancel" | null;

/** Why a card is parked, in the composer's own banner stack. */
const CARD_STATUS_NOTES: Record<
  string,
  { readonly variant: ComposerBannerStackItem["variant"]; readonly text: string } | null
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
    text: "You cancelled this step. Send a message to pick it back up, or retry it fresh.",
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
  const board = useProjectBoard(projectRef);
  const card = useCard(projectRef, cardId);
  const nowMs = useRelativeTimeTick();
  const allThreadShells = useThreadShells();
  const openRightPanel = useRightPanelStore((state) => state.open);

  const continueCard = useAtomCommand(boardEnvironment.continueCard);
  const retryCard = useAtomCommand(boardEnvironment.retryCard);
  const cancelCard = useAtomCommand(boardEnvironment.cancelCard);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation>(null);

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
          isWorking: shell.session?.status === "running",
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
        const existing = byPath.get(file.path) ?? { additions: 0, deletions: 0 };
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
      : boardArtifacts.artifact({ environmentId, input: { cardId, stepName: artifactStepName } }),
  );
  const currentArtifact = useEnvironmentQuery(
    currentStepName === null || currentStepName === artifactStepName
      ? null
      : boardArtifacts.artifact({ environmentId, input: { cardId, stepName: currentStepName } }),
  );

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

  const availability = card === null ? null : cardActionAvailability(card);
  const isLastStep = currentStepIndex !== null && currentStepIndex === steps.length - 1;

  const runCardCommand = useCallback(
    (kind: "continue" | "retry" | "cancel") => {
      const command =
        kind === "continue" ? continueCard : kind === "retry" ? retryCard : cancelCard;
      void command({ environmentId, input: { cardId } });
    },
    [cancelCard, cardId, continueCard, environmentId, retryCard],
  );

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
        onCancel={() => setPendingConfirmation("cancel")}
      />
    );
  }, [availability, card, currentStepIndex, isLastStep, runCardCommand, selection]);

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
    // Why the card is sitting still, said once, next to the actions that
    // resolve it. The badge in the rail says the same thing at a glance.
    const note = card === null ? null : CARD_STATUS_NOTES[card.status ?? "none"];
    if (note === null || note === undefined || selection.stepIndex !== currentStepIndex) {
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
  }, [card, cardId, currentStepIndex, selection, threadShell]);

  const timelineOverride = useMemo(() => {
    if (selection.kind !== "artifact" || card === null || board === null) return undefined;
    const stepName = artifactStepName;
    if (stepName === null) return undefined;
    return (
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
      />
    );
  }, [artifactStepName, board, card, cardId, currentStepIndex, environmentId, selection]);

  if (card === null || board === null || tree === null) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-muted-foreground text-sm">
        This card is no longer on the board.
      </div>
    );
  }

  const rail = (
    <CardTree
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
              {pendingConfirmation === "retry" ? "Retry this step?" : `Cancel '${card.title}'?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingConfirmation === "retry"
                ? "The step's thread is discarded and a fresh one runs the same prompt again. The worktree keeps whatever the previous attempt changed."
                : "This interrupts the running turn. The card stays where it is and can be resumed or retried afterwards."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Keep going</AlertDialogClose>
            <Button
              variant={pendingConfirmation === "cancel" ? "destructive" : "default"}
              onClick={() => {
                const kind = pendingConfirmation;
                setPendingConfirmation(null);
                if (kind === null) return;
                runCardCommand(kind);
              }}
            >
              {pendingConfirmation === "retry" ? "Retry step" : "Cancel card"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    );

  if (threadRef === null || threadShell === null) {
    return (
      <div className="flex h-full min-h-0">
        {rail}
        <div className="flex flex-1 items-center justify-center px-6 text-center text-muted-foreground text-sm">
          {card.position.kind === "todo"
            ? "This card has not been released yet — start it from the board."
            : "This step has not spawned its thread yet."}
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
        leftRail={rail}
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
