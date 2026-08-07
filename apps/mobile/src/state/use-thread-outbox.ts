import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentShellStatus } from "@aqqua/client-runtime/state/shell";
import type { EnvironmentId } from "@aqqua/contracts";
import { Atom } from "effect/unstable/reactivity";

import { environmentShell } from "./shell";
import { threadOutboxManager } from "./thread-outbox";
export {
  editingQueuedMessageIdsAtom,
  holdEditingQueuedMessage,
  releaseEditingQueuedMessage,
} from "./thread-outbox-coordination";

const threadOutboxShellStatusesAtom = Atom.make(
  (get): ReadonlyMap<EnvironmentId, EnvironmentShellStatus> => {
    const statuses = new Map<EnvironmentId, EnvironmentShellStatus>();
    for (const queue of Object.values(get(threadOutboxManager.queuedMessagesByThreadKeyAtom))) {
      const environmentId = queue[0]?.environmentId;
      if (environmentId !== undefined && !statuses.has(environmentId)) {
        statuses.set(environmentId, get(environmentShell.stateValueAtom(environmentId)).status);
      }
    }
    return statuses;
  },
).pipe(Atom.withLabel("mobile:thread-outbox:shell-statuses"));

/**
 * Queued pending tasks the outbox drain must not deliver right now: the one
 * open in the new-task editor, plus any whose latest edits could not be saved
 * back yet (delivering those would send stale content). Editing sessions hold
 * their message id here and release it once the queued payload is current.
 */
export function useThreadOutboxMessages() {
  return useAtomValue(threadOutboxManager.queuedMessagesByThreadKeyAtom);
}

export function useThreadOutboxShellStatuses() {
  return useAtomValue(threadOutboxShellStatusesAtom);
}
