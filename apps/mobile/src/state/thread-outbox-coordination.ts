import type { MessageId } from "@aqqua/contracts";
import { Atom } from "effect/unstable/reactivity";

import { appAtomRegistry } from "./atom-registry";
import { threadOutboxManager } from "./thread-outbox";
import type { QueuedThreadMessage } from "./thread-outbox-model";

export const editingQueuedMessageIdsAtom = Atom.make<Readonly<Record<MessageId, true>>>({}).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:thread-outbox:editing-message-ids"),
);

export function holdEditingQueuedMessage(messageId: MessageId): void {
  const current = appAtomRegistry.get(editingQueuedMessageIdsAtom);
  if (!current[messageId]) {
    appAtomRegistry.set(editingQueuedMessageIdsAtom, { ...current, [messageId]: true });
  }
}

export function releaseEditingQueuedMessage(messageId: MessageId): void {
  const current = appAtomRegistry.get(editingQueuedMessageIdsAtom);
  if (!current[messageId]) return;
  const next = { ...current };
  delete next[messageId];
  appAtomRegistry.set(editingQueuedMessageIdsAtom, next);
}

const queuedMessageDispatches = new Map<MessageId, Promise<void>>();

export function trackQueuedMessageDispatch(messageId: MessageId): () => void {
  let resolveDispatch: (() => void) | undefined;
  const settled = new Promise<void>((resolve) => {
    resolveDispatch = resolve;
  });
  queuedMessageDispatches.set(messageId, settled);
  return () => {
    resolveDispatch?.();
    if (queuedMessageDispatches.get(messageId) === settled) {
      queuedMessageDispatches.delete(messageId);
    }
  };
}

export async function claimThreadOutboxMessages(
  messages: ReadonlyArray<QueuedThreadMessage>,
): Promise<{
  readonly messages: ReadonlyArray<QueuedThreadMessage>;
  readonly release: () => void;
}> {
  const alreadyHeld = appAtomRegistry.get(editingQueuedMessageIdsAtom);
  const newlyHeld = messages.filter((message) => !alreadyHeld[message.messageId]);
  for (const message of newlyHeld) {
    holdEditingQueuedMessage(message.messageId);
  }

  await Promise.all(
    messages.map((message) => queuedMessageDispatches.get(message.messageId) ?? Promise.resolve()),
  );
  const currentMessageIds = new Set(
    Object.values(appAtomRegistry.get(threadOutboxManager.queuedMessagesByThreadKeyAtom)).flatMap(
      (queue) => queue.map((message) => message.messageId),
    ),
  );
  return {
    messages: messages.filter((message) => currentMessageIds.has(message.messageId)),
    release: () => {
      for (const message of newlyHeld) {
        releaseEditingQueuedMessage(message.messageId);
      }
    },
  };
}
