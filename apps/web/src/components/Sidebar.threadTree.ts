/** Deepest nesting level the sidebar will indent to before flattening visually. */
export const SIDEBAR_THREAD_MAX_DEPTH = 4;

export interface SidebarThreadTreeEntry<T> {
  readonly thread: T;
  /** 0 for a root thread, 1 for its sub-agents, clamped at SIDEBAR_THREAD_MAX_DEPTH. */
  readonly depth: number;
  /** Direct sub-agent count, used to label an orchestrator row. */
  readonly childCount: number;
}

type SidebarTreeThread = {
  readonly id: string;
  // `undefined` is spelled out because `exactOptionalPropertyTypes` is on and the
  // contract field is `Schema.optional(...)`, which admits an explicit undefined.
  readonly parentThreadId?: string | null | undefined;
};

/**
 * Flatten threads into sidebar display order: each orchestrator is immediately
 * followed by its sub-agents, depth-first.
 *
 * Sibling order is the caller's input order, so the caller stays in charge of
 * sorting. Three invariants matter more than the nesting itself:
 *
 * - Every input thread is emitted exactly once. A thread whose parent is absent
 *   (archived, filtered out, in another project, or deleted) is promoted to a
 *   root rather than dropped, so delegation can never hide a thread from the
 *   sidebar.
 * - Reference cycles cannot hang or duplicate. Threads left unreachable from any
 *   root are appended as roots in input order.
 * - Depth is clamped for display only; parentage is unchanged.
 */
export function buildSidebarThreadTree<T extends SidebarTreeThread>(input: {
  threads: readonly T[];
  maxDepth?: number;
}): SidebarThreadTreeEntry<T>[] {
  const { threads } = input;
  const maxDepth = input.maxDepth ?? SIDEBAR_THREAD_MAX_DEPTH;
  if (threads.length === 0) {
    return [];
  }

  const byId = new Map<string, T>();
  for (const thread of threads) {
    byId.set(thread.id, thread);
  }

  const childrenByParent = new Map<string, T[]>();
  const roots: T[] = [];
  for (const thread of threads) {
    const parentId = thread.parentThreadId ?? null;
    // A self-reference or an absent parent both mean "render me as a root".
    if (parentId === null || parentId === thread.id || !byId.has(parentId)) {
      roots.push(thread);
      continue;
    }
    const siblings = childrenByParent.get(parentId);
    if (siblings) {
      siblings.push(thread);
    } else {
      childrenByParent.set(parentId, [thread]);
    }
  }

  const entries: SidebarThreadTreeEntry<T>[] = [];
  const emitted = new Set<string>();

  const visit = (thread: T, depth: number): void => {
    if (emitted.has(thread.id)) {
      return;
    }
    emitted.add(thread.id);
    const children = childrenByParent.get(thread.id) ?? [];
    entries.push({
      thread,
      depth: Math.min(depth, maxDepth),
      childCount: children.length,
    });
    for (const child of children) {
      visit(child, depth + 1);
    }
  };

  for (const root of roots) {
    visit(root, 0);
  }

  // Anything still unemitted is part of a parent cycle. Surface those as roots
  // so a malformed edge degrades to a flat list instead of losing threads.
  for (const thread of threads) {
    visit(thread, 0);
  }

  return entries;
}

/**
 * Whether a list of rows should reserve the expand-toggle column.
 *
 * The column is a property of the list, not of the row that owns a toggle:
 * reserving it only where a toggle exists gives sibling rows different title
 * offsets, which reads as broken alignment rather than as hierarchy. Reserving
 * it everywhere costs a column in the (common) list that has no sub-agents at
 * all, so the rule is per rendered scope — a project's thread list in v1, the
 * nested rows of the inbox in v2.
 *
 * `minDepth` restricts the question to a slice of the tree: v2's cards carry
 * their toggle in the card body, so only rows at depth 1+ share a column.
 */
export function shouldReserveThreadExpandGutter(
  rows: Iterable<{ readonly depth: number; readonly childCount: number }>,
  options?: { minDepth?: number },
): boolean {
  const minDepth = options?.minDepth ?? 0;
  for (const row of rows) {
    if (row.depth >= minDepth && row.childCount > 0) {
      return true;
    }
  }
  return false;
}

export function filterVisibleSidebarThreadEntries<T>(input: {
  entries: readonly SidebarThreadTreeEntry<T>[];
  isExpanded: (entry: SidebarThreadTreeEntry<T>) => boolean;
}): SidebarThreadTreeEntry<T>[] {
  const visible: SidebarThreadTreeEntry<T>[] = [];
  let collapsedDepth: number | null = null;

  for (const entry of input.entries) {
    if (collapsedDepth !== null) {
      if (entry.depth > collapsedDepth) {
        continue;
      }
      collapsedDepth = null;
    }

    visible.push(entry);
    if (entry.childCount > 0 && !input.isExpanded(entry)) {
      collapsedDepth = entry.depth;
    }
  }

  return visible;
}

/**
 * Apply the sidebar preview limit by whole family rather than by row.
 *
 * The limit exists to cap how many *conversations* a collapsed project shows. If
 * it counted rows, an orchestrator with three sub-agents would consume four
 * slots and could be cut off from its own children, so `rootLimit` counts roots
 * and each surviving root keeps every descendant.
 */
export function takeSidebarThreadFamilies<T>(input: {
  entries: readonly SidebarThreadTreeEntry<T>[];
  rootLimit: number;
}): {
  rootCount: number;
  visible: SidebarThreadTreeEntry<T>[];
  hidden: SidebarThreadTreeEntry<T>[];
} {
  const { entries, rootLimit } = input;
  const rootCount = entries.reduce((count, entry) => (entry.depth === 0 ? count + 1 : count), 0);
  const visible: SidebarThreadTreeEntry<T>[] = [];
  const hidden: SidebarThreadTreeEntry<T>[] = [];
  let rootsSeen = 0;
  let keepingCurrentFamily = false;

  for (const entry of entries) {
    if (entry.depth === 0) {
      rootsSeen += 1;
      keepingCurrentFamily = rootsSeen <= rootLimit;
    }
    (keepingCurrentFamily ? visible : hidden).push(entry);
  }

  return { rootCount, visible, hidden };
}

/**
 * The ancestor chain of one row, outermost first.
 *
 * Reads the flattened tree backwards: in depth-first display order the nearest
 * preceding entry with a smaller depth is the parent. Callers use this to keep
 * the branch holding the open thread expanded — a sidebar that collapses
 * sub-agents by default must still never hide the thread you are reading.
 *
 * Returns an empty array for a root, an unknown id, or an entry list that does
 * not contain the thread.
 */
export function resolveSidebarThreadAncestorIds<T>(input: {
  entries: readonly SidebarThreadTreeEntry<T>[];
  threadId: string;
  getThreadId: (thread: T) => string;
}): string[] {
  const { entries, getThreadId, threadId } = input;
  const index = entries.findIndex((entry) => getThreadId(entry.thread) === threadId);
  if (index < 0) {
    return [];
  }

  const ancestors: string[] = [];
  let depth = entries[index]!.depth;
  for (let cursor = index - 1; cursor >= 0 && depth > 0; cursor -= 1) {
    const entry = entries[cursor]!;
    if (entry.depth < depth) {
      ancestors.push(getThreadId(entry.thread));
      depth = entry.depth;
    }
  }
  // Collected nearest-first by walking backwards; callers want outermost first.
  return ancestors.toReversed();
}

export function resolveCollapsedThreadSelectionTarget<T>(input: {
  entries: readonly SidebarThreadTreeEntry<T>[];
  collapsedThreadId: string;
  selectedThreadId: string | null;
  getThreadId: (thread: T) => string;
}): string | null {
  const { collapsedThreadId, entries, getThreadId, selectedThreadId } = input;
  if (selectedThreadId === null || selectedThreadId === collapsedThreadId) {
    return null;
  }

  const collapsedIndex = entries.findIndex(
    (entry) => getThreadId(entry.thread) === collapsedThreadId,
  );
  if (collapsedIndex < 0) {
    return null;
  }

  const collapsedEntry = entries[collapsedIndex]!;
  for (let index = collapsedIndex + 1; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (entry.depth <= collapsedEntry.depth) {
      return null;
    }
    if (getThreadId(entry.thread) === selectedThreadId) {
      return collapsedThreadId;
    }
  }

  return null;
}
