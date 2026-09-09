import { scopedThreadKey, scopeThreadRef } from "@aqqua/client-runtime/environment";
import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/models";

type FamilyMember = Pick<EnvironmentThreadShell, "environmentId" | "id" | "parentThreadId">;

interface SidebarThreadFamilyOptions<T> {
  /** Stop family nesting when a parent belongs to a different sidebar group. */
  readonly familyScopeKey?: (thread: T) => string | null;
}

export function sidebarThreadKey(thread: FamilyMember): string {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

/** Missing parents and cross-scope children stay visible; other descendants use a family picker. */
export function buildSidebarThreadFamilies<T extends FamilyMember>(
  threads: readonly T[],
  options: SidebarThreadFamilyOptions<T> = {},
) {
  const byKey = new Map(threads.map((thread) => [sidebarThreadKey(thread), thread]));
  const descendantsByRoot = new Map<string, T[]>();
  const roots: T[] = [];
  for (const thread of threads) {
    const key = sidebarThreadKey(thread);
    let root = thread;
    const visited = new Set([key]);
    while (root.parentThreadId != null) {
      const parentKey = scopedThreadKey(scopeThreadRef(root.environmentId, root.parentThreadId));
      const parent = byKey.get(parentKey);
      if (!parent) break;
      if (
        options.familyScopeKey !== undefined &&
        options.familyScopeKey(root) !== options.familyScopeKey(parent)
      ) {
        break;
      }
      if (visited.has(parentKey)) {
        root = thread;
        break;
      }
      visited.add(parentKey);
      root = parent;
    }
    const rootKey = sidebarThreadKey(root);
    if (rootKey === key) roots.push(thread);
    else {
      const family = descendantsByRoot.get(rootKey);
      if (family) family.push(thread);
      else descendantsByRoot.set(rootKey, [thread]);
    }
  }
  return { roots, descendantsByRoot };
}
