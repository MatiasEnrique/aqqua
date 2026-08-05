import { scopeThreadRef, scopedThreadKey } from "@aqqua/client-runtime/environment";
import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/models";
import { createFlowThreadOwnership } from "@aqqua/client-runtime/state/boards";
import { EnvironmentId } from "@aqqua/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useMemo } from "react";

import { environmentBoards } from "../../state/boards";

const EMPTY_KEYS: ReadonlySet<string> = new Set();

export function useFlowOwnedThreadKeys(
  threads: ReadonlyArray<EnvironmentThreadShell>,
): ReadonlySet<string> {
  const environmentIdsKey = useMemo(() => {
    const ids = new Set<string>();
    for (const thread of threads) ids.add(thread.environmentId as string);
    return [...ids].sort().join(" ");
  }, [threads]);
  const cardsAtom = useMemo(
    () =>
      environmentBoards.environmentsCardsAtom(
        environmentIdsKey === ""
          ? []
          : environmentIdsKey.split(" ").map((id) => EnvironmentId.make(id)),
      ),
    [environmentIdsKey],
  );
  const cardsByEnvironment = useAtomValue(cardsAtom);

  return useMemo(() => {
    const threadsByEnvironment = new Map<EnvironmentId, EnvironmentThreadShell[]>();
    for (const thread of threads) {
      const bucket = threadsByEnvironment.get(thread.environmentId);
      if (bucket === undefined) threadsByEnvironment.set(thread.environmentId, [thread]);
      else bucket.push(thread);
    }
    const owned = new Set<string>();
    for (const [environmentId, environmentThreads] of threadsByEnvironment) {
      const cards = cardsByEnvironment.get(environmentId) ?? [];
      if (cards.length === 0) continue;
      const ownership = createFlowThreadOwnership({ cards, threads: environmentThreads });
      for (const thread of environmentThreads) {
        if (ownership.isFlowOwned(thread.id)) {
          owned.add(scopedThreadKey(scopeThreadRef(environmentId, thread.id)));
        }
      }
    }
    return owned.size === 0 ? EMPTY_KEYS : owned;
  }, [cardsByEnvironment, threads]);
}
