import { useAtomValue } from "@effect/atom-react";
import { useCallback, useEffect, useMemo } from "react";

import {
  CommandId,
  MessageId,
  type EnvironmentId,
  type ModelSelection,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ThreadId,
} from "@aqqua/contracts";
import { safeErrorLogAttributes } from "@aqqua/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@aqqua/client-runtime/state/runtime";
import { deriveActiveWorkStartedAt } from "@aqqua/shared/orchestrationTiming";

import { isProviderSubagentThread } from "../features/threads/threadListV2";
import { makeQueuedMessageMetadata } from "../lib/commandMetadata";
import {
  convertPastedImagesToAttachments,
  pasteComposerClipboard,
  pickComposerImages,
} from "../lib/composerImages";
import type { DraftComposerImageAttachment } from "../lib/composerImages";
import { scopedThreadKey } from "../lib/scopedEntities";
import { buildThreadFeed } from "../lib/threadActivity";
import { appAtomRegistry } from "../state/atom-registry";
import {
  appendComposerDraftAttachments,
  appendComposerDraftText,
  clearComposerDraftContent,
  composerDraftsAtom,
  ensureComposerDraftsLoaded,
  getComposerDraftSnapshot,
  removeComposerDraftAttachment,
  setComposerDraftText,
  updateComposerDraftSettings,
  useComposerDraft,
} from "./use-composer-drafts";
import { setPendingConnectionError } from "../state/use-remote-environment-registry";
import { useSelectedThreadDetail } from "../state/use-thread-detail";
import { useThreadSelection } from "../state/use-thread-selection";
import { enqueueThreadOutboxMessage, removeThreadOutboxMessage } from "./thread-outbox";
import { claimThreadOutboxMessages } from "./thread-outbox-coordination";
import { buildQueuedThreadMessageEnqueueInput } from "./thread-outbox-model";
import { useThreadOutboxMessages } from "./use-thread-outbox";
import { threadEnvironment } from "./threads";
import { useAtomCommand } from "./use-atom-command";
import {
  cancelDispatchingQueuedMessage,
  cancelledQueuedMessageIdsAtom,
} from "./use-thread-outbox-drain";

export interface ThreadQueuedMessagePresentation {
  readonly messageId: MessageId;
  readonly text: string;
  readonly attachmentCount: number;
  readonly source: "local" | "server";
}

export function appendReviewCommentToDraft(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly text: string;
  readonly attachments?: ReadonlyArray<DraftComposerImageAttachment>;
}): void {
  const threadKey = scopedThreadKey(input.environmentId, input.threadId);
  const existing = appAtomRegistry.get(composerDraftsAtom)[threadKey]?.text ?? "";
  const separator = existing.trim().length > 0 && !existing.endsWith("\n") ? "\n\n" : "";
  setComposerDraftText(threadKey, `${existing}${separator}${input.text}`);
  if (input.attachments && input.attachments.length > 0) {
    appendComposerDraftAttachments(threadKey, input.attachments);
  }
}

export function useThreadDraftForThread(input: {
  readonly environmentId?: EnvironmentId;
  readonly threadId?: ThreadId;
}) {
  const threadKey =
    input.environmentId && input.threadId
      ? scopedThreadKey(input.environmentId, input.threadId)
      : null;
  const draft = useComposerDraft(threadKey);

  return {
    draftMessage: draft.text,
    draftAttachments: draft.attachments,
  };
}

export function useThreadComposerState() {
  const { selectedThread: selectedThreadShell } = useThreadSelection();
  const selectedThreadDetail = useSelectedThreadDetail();
  const composerDrafts = useAtomValue(composerDraftsAtom);
  const queuedMessagesByThreadKey = useThreadOutboxMessages();
  const cancelledQueuedMessageIds = useAtomValue(cancelledQueuedMessageIdsAtom);
  const dequeueThreadMessage = useAtomCommand(threadEnvironment.dequeueMessage, {
    reportFailure: false,
  });
  const submitThreadMessages = useAtomCommand(threadEnvironment.submitMessages, {
    reportFailure: false,
  });

  useEffect(() => {
    ensureComposerDraftsLoaded();
  }, []);

  const selectedThreadKey = selectedThreadShell
    ? scopedThreadKey(selectedThreadShell.environmentId, selectedThreadShell.id)
    : null;
  const selectedThreadOutboxMessages = useMemo(
    () => (selectedThreadKey ? (queuedMessagesByThreadKey[selectedThreadKey] ?? []) : []),
    [queuedMessagesByThreadKey, selectedThreadKey],
  );
  const selectedThreadLocalQueuedMessages = useMemo(
    () =>
      selectedThreadOutboxMessages.filter(
        (message) =>
          message.deliveryMode !== "steer" && !cancelledQueuedMessageIds.has(message.messageId),
      ),
    [cancelledQueuedMessageIds, selectedThreadOutboxMessages],
  );
  const selectedThreadQueuedMessages = useMemo(() => {
    const messages = new Map<MessageId, ThreadQueuedMessagePresentation>();
    for (const message of selectedThreadDetail?.queuedMessages ?? []) {
      if (cancelledQueuedMessageIds.has(message.messageId)) {
        continue;
      }
      messages.set(message.messageId, {
        messageId: message.messageId,
        text: message.text,
        attachmentCount: message.attachments.length,
        source: "server",
      });
    }
    for (const message of selectedThreadLocalQueuedMessages) {
      if (!messages.has(message.messageId)) {
        messages.set(message.messageId, {
          messageId: message.messageId,
          text: message.text,
          attachmentCount: message.attachments.length,
          source: "local",
        });
      }
    }
    return [...messages.values()];
  }, [
    cancelledQueuedMessageIds,
    selectedThreadDetail?.queuedMessages,
    selectedThreadLocalQueuedMessages,
  ]);
  const selectedThreadFeed = useMemo(
    () => (selectedThreadDetail ? buildThreadFeed(selectedThreadDetail) : []),
    [selectedThreadDetail],
  );

  const selectedDraft = selectedThreadKey ? composerDrafts[selectedThreadKey] : null;
  const draftMessage = selectedDraft?.text ?? "";
  const draftAttachments = selectedDraft?.attachments ?? [];
  const selectedThreadQueueCount = selectedThreadQueuedMessages.length;
  const selectedThread = selectedThreadDetail ?? selectedThreadShell;
  const modelSelection = selectedDraft?.modelSelection ?? selectedThread?.modelSelection ?? null;
  const runtimeMode = selectedDraft?.runtimeMode ?? selectedThread?.runtimeMode ?? null;
  const interactionMode = selectedDraft?.interactionMode ?? selectedThread?.interactionMode ?? null;

  const selectedThreadSessionActivity = useMemo(() => {
    const selectedThread = selectedThreadDetail ?? selectedThreadShell;
    if (!selectedThread?.session) {
      return null;
    }

    return {
      orchestrationStatus: selectedThread.session.status,
      activeTurnId: selectedThread.session.activeTurnId ?? undefined,
    };
  }, [selectedThreadDetail, selectedThreadShell]);

  const activeWorkStartedAt = useMemo(() => {
    const selectedThread = selectedThreadDetail ?? selectedThreadShell;
    if (!selectedThread) {
      return null;
    }

    return deriveActiveWorkStartedAt(
      selectedThread.latestTurn,
      selectedThreadSessionActivity,
      null,
    );
  }, [selectedThreadDetail, selectedThreadSessionActivity, selectedThreadShell]);

  const activeThreadBusy =
    !!selectedThread &&
    (selectedThread.session?.status === "running" || selectedThread.session?.status === "starting");

  const submitDraft = useCallback(
    async (deliveryMode: "queue" | "steer") => {
      if (!selectedThreadShell) {
        return null;
      }
      const thread = selectedThreadDetail ?? selectedThreadShell;
      if (isProviderSubagentThread(thread)) {
        return null;
      }

      const threadKey = scopedThreadKey(selectedThreadShell.environmentId, selectedThreadShell.id);
      const draft = getComposerDraftSnapshot(threadKey);
      const text = draft.text.trim();
      const attachments = draft.attachments;
      if (text.length === 0 && attachments.length === 0) {
        return null;
      }

      const metadata = makeQueuedMessageMetadata();
      const messageId = MessageId.make(metadata.messageId);
      clearComposerDraftContent(threadKey);
      try {
        await enqueueThreadOutboxMessage({
          environmentId: selectedThreadShell.environmentId,
          threadId: selectedThreadShell.id,
          messageId,
          commandId: CommandId.make(metadata.commandId),
          text,
          attachments,
          modelSelection: draft.modelSelection ?? thread.modelSelection,
          runtimeMode: draft.runtimeMode ?? thread.runtimeMode,
          interactionMode: draft.interactionMode ?? thread.interactionMode,
          deliveryMode,
          createdAt: metadata.createdAt,
        });
        return messageId;
      } catch (error) {
        const currentDraft = getComposerDraftSnapshot(threadKey);
        const restoredText = [text, currentDraft.text]
          .filter((value) => value.length > 0)
          .join("\n\n");
        const restoredAttachments = [...attachments, ...currentDraft.attachments].filter(
          (attachment, index, all) =>
            all.findIndex((candidate) => candidate.id === attachment.id) === index,
        );
        clearComposerDraftContent(threadKey);
        setComposerDraftText(threadKey, restoredText);
        appendComposerDraftAttachments(threadKey, restoredAttachments);
        updateComposerDraftSettings(threadKey, {
          modelSelection: currentDraft.modelSelection ?? draft.modelSelection,
          runtimeMode: currentDraft.runtimeMode ?? draft.runtimeMode,
          interactionMode: currentDraft.interactionMode ?? draft.interactionMode,
        });
        setPendingConnectionError(
          error instanceof Error ? error.message : "Failed to save the queued message.",
        );
        return null;
      }
    },
    [selectedThreadDetail, selectedThreadShell],
  );

  const onSendMessage = useCallback(
    (deliveryMode: "queue" | "steer") => submitDraft(deliveryMode),
    [submitDraft],
  );

  const onDequeueQueuedMessage = useCallback(
    async (messageId: MessageId) => {
      if (!selectedThreadShell) {
        return;
      }
      const localMessage = selectedThreadLocalQueuedMessages.find(
        (message) => message.messageId === messageId,
      );
      const serverHasMessage = (selectedThreadDetail?.queuedMessages ?? []).some(
        (message) => message.messageId === messageId,
      );
      try {
        if (!serverHasMessage && localMessage) {
          if (cancelDispatchingQueuedMessage(messageId)) {
            return;
          }
          await removeThreadOutboxMessage(localMessage);
          return;
        }
        const result = await dequeueThreadMessage({
          environmentId: selectedThreadShell.environmentId,
          input: {
            threadId: selectedThreadShell.id,
            messageId,
          },
        });
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          throw squashAtomCommandFailure(result);
        }
        if (result._tag === "Success" && localMessage) {
          await removeThreadOutboxMessage(localMessage);
        }
      } catch (error) {
        setPendingConnectionError(
          error instanceof Error ? error.message : "Failed to remove the queued message.",
        );
      }
    },
    [
      dequeueThreadMessage,
      selectedThreadDetail?.queuedMessages,
      selectedThreadLocalQueuedMessages,
      selectedThreadShell,
    ],
  );

  const onSubmitQueuedMessages = useCallback(
    async (messageIds: ReadonlyArray<MessageId>) => {
      if (!selectedThreadShell) {
        return;
      }
      const thread = selectedThreadDetail ?? selectedThreadShell;
      if (isProviderSubagentThread(thread) || messageIds.length === 0) {
        return;
      }
      const selectedMessageIds = new Set(messageIds);
      const serverMessageIds = new Set(
        (selectedThreadDetail?.queuedMessages ?? []).map((message) => message.messageId),
      );
      const localMessages = selectedThreadLocalQueuedMessages.filter((message) =>
        selectedMessageIds.has(message.messageId),
      );
      const claim = await claimThreadOutboxMessages(localMessages);
      try {
        const messages = claim.messages
          .filter((message) => !serverMessageIds.has(message.messageId))
          .map((message) => {
            const input = buildQueuedThreadMessageEnqueueInput(message, thread);
            return {
              enqueueCommandId: input.commandId,
              messageId: input.message.messageId,
              text: input.message.text,
              attachments: input.message.attachments,
              modelSelection: input.modelSelection,
              runtimeMode: input.runtimeMode,
              interactionMode: input.interactionMode,
              createdAt: input.createdAt,
            };
          });

        const submitResult = await submitThreadMessages({
          environmentId: selectedThreadShell.environmentId,
          input: {
            threadId: selectedThreadShell.id,
            messageIds,
            messages,
          },
        });
        if (submitResult._tag === "Failure" && !isAtomCommandInterrupted(submitResult)) {
          throw squashAtomCommandFailure(submitResult);
        }
        if (submitResult._tag === "Failure") {
          return;
        }
        for (const message of localMessages) {
          await removeThreadOutboxMessage(message);
        }
      } catch (error) {
        setPendingConnectionError(
          error instanceof Error ? error.message : "Failed to submit the queued message.",
        );
      } finally {
        claim.release();
      }
    },
    [
      selectedThreadDetail,
      selectedThreadLocalQueuedMessages,
      selectedThreadShell,
      submitThreadMessages,
    ],
  );

  const onChangeDraftMessage = useCallback(
    (value: string) => {
      if (!selectedThreadShell) {
        return;
      }

      const threadKey = scopedThreadKey(selectedThreadShell.environmentId, selectedThreadShell.id);
      setComposerDraftText(threadKey, value);
    },
    [selectedThreadShell],
  );

  const onPickDraftImages = useCallback(async () => {
    if (!selectedThreadShell) {
      return;
    }

    const threadKey = scopedThreadKey(selectedThreadShell.environmentId, selectedThreadShell.id);
    const result = await pickComposerImages({
      existingCount: composerDrafts[threadKey]?.attachments.length ?? 0,
    });
    if (result.images.length > 0) {
      appendComposerDraftAttachments(threadKey, result.images);
    }
    if (result.error) {
      setPendingConnectionError(result.error);
    }
  }, [composerDrafts, selectedThreadShell]);

  const onPasteIntoDraft = useCallback(async () => {
    if (!selectedThreadShell) {
      return;
    }

    const threadKey = scopedThreadKey(selectedThreadShell.environmentId, selectedThreadShell.id);
    const result = await pasteComposerClipboard({
      existingCount: composerDrafts[threadKey]?.attachments.length ?? 0,
    });
    if (result.images.length > 0) {
      appendComposerDraftAttachments(threadKey, result.images);
    }
    if (result.text) {
      appendComposerDraftText(threadKey, result.text);
    }
    if (result.error) {
      setPendingConnectionError(result.error);
    }
  }, [composerDrafts, selectedThreadShell]);

  const onNativePasteImages = useCallback(
    async (uris: ReadonlyArray<string>) => {
      if (!selectedThreadShell || uris.length === 0) {
        return;
      }

      const threadKey = scopedThreadKey(selectedThreadShell.environmentId, selectedThreadShell.id);
      try {
        const images = await convertPastedImagesToAttachments({
          uris,
          existingCount: composerDrafts[threadKey]?.attachments.length ?? 0,
        });
        if (images.length > 0) {
          appendComposerDraftAttachments(threadKey, images);
        }
      } catch (error) {
        console.error("[native paste] error converting images", {
          environmentId: selectedThreadShell.environmentId,
          threadId: selectedThreadShell.id,
          uriCount: uris.length,
          ...safeErrorLogAttributes(error),
        });
      }
    },
    [composerDrafts, selectedThreadShell],
  );

  const onRemoveDraftImage = useCallback(
    (imageId: string) => {
      if (!selectedThreadShell) {
        return;
      }

      const threadKey = scopedThreadKey(selectedThreadShell.environmentId, selectedThreadShell.id);
      removeComposerDraftAttachment(threadKey, imageId);
    },
    [selectedThreadShell],
  );

  const onUpdateModelSelection = useCallback(
    (value: ModelSelection) => {
      if (!selectedThreadKey) {
        return;
      }
      updateComposerDraftSettings(selectedThreadKey, { modelSelection: value });
    },
    [selectedThreadKey],
  );

  const onUpdateRuntimeMode = useCallback(
    (value: RuntimeMode) => {
      if (!selectedThreadKey) {
        return;
      }
      updateComposerDraftSettings(selectedThreadKey, { runtimeMode: value });
    },
    [selectedThreadKey],
  );

  const onUpdateInteractionMode = useCallback(
    (value: ProviderInteractionMode) => {
      if (!selectedThreadKey) {
        return;
      }
      updateComposerDraftSettings(selectedThreadKey, { interactionMode: value });
    },
    [selectedThreadKey],
  );

  return {
    selectedThreadFeed,
    selectedThreadQueueCount,
    selectedThreadQueuedMessages,
    activeWorkStartedAt,
    draftMessage,
    draftAttachments,
    modelSelection,
    runtimeMode,
    interactionMode,
    activeThreadBusy,
    onChangeDraftMessage,
    onPickDraftImages,
    onPasteIntoDraft,
    onNativePasteImages,
    onRemoveDraftImage,
    onSendMessage,
    onDequeueQueuedMessage,
    onSubmitQueuedMessages,
    onUpdateModelSelection,
    onUpdateRuntimeMode,
    onUpdateInteractionMode,
  };
}
