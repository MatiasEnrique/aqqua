import { scopedThreadKey, scopeThreadRef } from "@aqqua/client-runtime/environment";
import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/models";
import type {
  EnvironmentId,
  OrchestrationCard,
  ProjectId,
  ProviderSubagentBinding,
  ScopedThreadRef,
  ThreadId,
} from "@aqqua/contracts";
import {
  resolveSidebarConversationAggregateState,
  type SidebarConversationAggregateState,
} from "../Sidebar.summaryState";
import {
  resolveSidebarConversationWorktreeKey,
  resolveSidebarDraftWorktreeKey,
} from "../Sidebar.worktreeGroups";

/**
 * Tabs are keyed by scoped thread key — including drafts.
 *
 * A draft already knows the thread it will become, and the draft route resolves
 * to that same ref, so keying by it means promotion is invisible: the tab the
 * user opened as "New thread" is the tab that holds the conversation once the
 * first message lands, with no key to migrate and no window where both exist.
 */
export function conversationTabKey(threadRef: ScopedThreadRef): string {
  return scopedThreadKey(threadRef);
}

/** Adds a conversation to the open set, keeping the order tabs were opened in. */
export function openConversationTab(keys: readonly string[], key: string): string[] {
  return keys.includes(key) ? [...keys] : [...keys, key];
}

/**
 * Opens sub-agent threads that appeared after the previous shell snapshot.
 *
 * Worktree-card mode has no individual conversation rows, so a child spawned
 * from an open orchestrator needs to become a regular tab or it has no visible
 * entry point. Looking at the transition, rather than every current child,
 * prevents restored or newly loaded history from unexpectedly filling the
 * strip.
 *
 * Provider-native children are deliberately excluded. They share their owner's
 * provider session and are opened from the owner's native-agent activity
 * surface, not promoted into the independently controllable conversation tabs.
 */
export function openNewSubAgentConversationTabs(input: {
  readonly openKeys: readonly string[];
  readonly previousThreads: readonly EnvironmentThreadShell[];
  readonly threads: readonly EnvironmentThreadShell[];
}): string[] {
  const previousKeys = new Set(
    input.previousThreads.map((thread) =>
      conversationTabKey(scopeThreadRef(thread.environmentId, thread.id)),
    ),
  );
  const next = [...input.openKeys];
  const openKeys = new Set(next);
  for (const thread of input.threads) {
    if (thread.providerSubagent != null) continue;
    const parentThreadId = thread.parentThreadId ?? null;
    if (parentThreadId === null) continue;
    const key = conversationTabKey(scopeThreadRef(thread.environmentId, thread.id));
    if (previousKeys.has(key)) continue;
    const parentKey = conversationTabKey(scopeThreadRef(thread.environmentId, parentThreadId));
    if (!openKeys.has(parentKey) || openKeys.has(key)) continue;
    next.push(key);
    openKeys.add(key);
  }
  return next;
}

type FlowConversationCard = Pick<OrchestrationCard, "archivedAt" | "stepThreads">;

/**
 * Restores the whole conversation family for a Flow that already has one open
 * tab: every persisted step root plus every aqqua-managed descendant.
 *
 * Flow steps are commonly created while the user is on the Flow surface, where
 * the conversation tab strip is disabled. The transition-only sub-agent opener
 * above therefore never observes them. Rebuilding from the card's durable
 * `stepThreads` also covers cold starts and returning to Threads later.
 * Provider-native children remain subordinate activity of their owning session
 * and deliberately stay out of the independently controllable tab set.
 */
export function syncOpenFlowConversationTabs(input: {
  readonly openKeys: readonly string[];
  readonly cardsByEnvironment: ReadonlyMap<EnvironmentId, ReadonlyArray<FlowConversationCard>>;
  readonly threads: readonly EnvironmentThreadShell[];
}): string[] {
  let next = [...input.openKeys];
  const threadByKey = new Map(
    input.threads.map(
      (thread) =>
        [conversationTabKey(scopeThreadRef(thread.environmentId, thread.id)), thread] as const,
    ),
  );
  const managedChildrenByParentKey = new Map<string, string[]>();
  for (const thread of input.threads) {
    if (thread.providerSubagent != null || thread.parentThreadId == null) continue;
    const parentKey = conversationTabKey(
      scopeThreadRef(thread.environmentId, thread.parentThreadId),
    );
    const childKey = conversationTabKey(scopeThreadRef(thread.environmentId, thread.id));
    const children = managedChildrenByParentKey.get(parentKey);
    if (children === undefined) managedChildrenByParentKey.set(parentKey, [childKey]);
    else children.push(childKey);
  }

  for (const [environmentId, cards] of input.cardsByEnvironment) {
    for (const card of cards) {
      if (card.archivedAt !== null) continue;
      const orderedKeys: string[] = [];
      const visited = new Set<string>();
      const appendLineage = (key: string) => {
        if (visited.has(key) || !threadByKey.has(key)) return;
        visited.add(key);
        orderedKeys.push(key);
        for (const childKey of managedChildrenByParentKey.get(key) ?? []) {
          appendLineage(childKey);
        }
      };
      for (const entry of card.stepThreads) {
        appendLineage(conversationTabKey(scopeThreadRef(environmentId, entry.threadId)));
      }
      if (orderedKeys.length === 0) continue;

      const flowKeys = new Set(orderedKeys);
      const insertionIndex = next.findIndex((key) => flowKeys.has(key));
      if (insertionIndex === -1) continue;
      next = [
        ...next.slice(0, insertionIndex).filter((key) => !flowKeys.has(key)),
        ...orderedKeys,
        ...next.slice(insertionIndex).filter((key) => !flowKeys.has(key)),
      ];
    }
  }
  return next;
}
export type ConversationTab =
  | {
      readonly _tag: "draft";
      readonly key: string;
      readonly threadRef: ScopedThreadRef;
      readonly title: string;
      readonly isActive: boolean;
      readonly draftId: string;
    }
  | {
      readonly _tag: "thread";
      readonly key: string;
      readonly threadRef: ScopedThreadRef;
      readonly title: string;
      readonly isActive: boolean;
      readonly state: SidebarConversationAggregateState;
      /**
       * The tab key of the orchestrator that spawned this thread, or null for a
       * top-level conversation. Set even when that tab is absent — whether the
       * parent is on screen is the grouping step's question, not this one's.
       */
      readonly parentKey: string | null;
    };

/** The tab key of a conversation's orchestrator, if it has one. */
export function conversationTabParentKey(tab: ConversationTab): string | null {
  return tab._tag === "thread" ? tab.parentKey : null;
}

/**
 * An orchestrator and the sub-agents it spawned, as one band in the strip.
 *
 * A family is the unit the strip lays out: children sit inside their parent's
 * band rather than drifting to wherever they happened to be opened, so a run of
 * tabs reads as delegation instead of as unrelated conversations that share a
 * prefix.
 */
export interface ConversationTabFamily {
  readonly key: string;
  readonly parent: ConversationTab;
  /** The direct sub-agents this orchestrator spawned. */
  readonly children: readonly ConversationTab[];
}

/**
 * Nests each direct sub-agent under its orchestrator when both tabs are open.
 *
 * A sub-agent whose orchestrator is not in the strip leads its own family
 * rather than disappearing, so it remains reachable on its own.
 */
export function groupConversationTabFamilies(
  tabs: readonly ConversationTab[],
): ConversationTabFamily[] {
  const present = new Set(tabs.map((tab) => tab.key));
  const childrenByParentKey = new Map<string, ConversationTab[]>();
  const roots: ConversationTab[] = [];
  for (const tab of tabs) {
    const parentKey = conversationTabParentKey(tab);
    if (parentKey === null || parentKey === tab.key || !present.has(parentKey)) {
      roots.push(tab);
      continue;
    }
    const siblings = childrenByParentKey.get(parentKey);
    if (siblings === undefined) childrenByParentKey.set(parentKey, [tab]);
    else siblings.push(tab);
  }

  const placed = new Set(roots.map((tab) => tab.key));
  const families = roots.map((parent) => {
    const children = childrenByParentKey.get(parent.key) ?? [];
    for (const child of children) placed.add(child.key);
    return { key: parent.key, parent, children };
  });
  // Nested or cyclic parent data is outside the supported one-level model, but
  // it must not make a conversation disappear from the strip.
  const orphans = tabs
    .filter((tab) => !placed.has(tab.key))
    .map((parent) => ({ key: parent.key, parent, children: [] }));
  return [...families, ...orphans];
}

export interface ConversationTabDraft {
  readonly draftId: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly envMode: "local" | "worktree";
  readonly worktreePath: string | null;
  readonly title: string;
}

export interface ConversationTabSource {
  readonly openKeys: readonly string[];
  readonly threads: readonly EnvironmentThreadShell[];
  readonly drafts: readonly ConversationTabDraft[];
  readonly activeKey: string | null;
  /**
   * The worktree whose conversations the strip is showing. Null shows every
   * open tab — the state before a worktree has been resolved, where hiding
   * everything would be worse than showing too much.
   */
  readonly worktreeKey: string | null;
  /** `environmentId:projectId` → the project's own checkout path. */
  readonly projectRootByProjectKey: ReadonlyMap<string, string>;
}

/**
 * The strip's contents: the order the tabs were opened, with each sub-agent
 * pulled up to sit directly after the orchestrator that spawned it.
 *
 * Open order alone would scatter a family, because a sub-agent tab opens when
 * the spawn lands — after whatever else the user opened in between. Ordering
 * here rather than in the view keeps the family order identical for every
 * consumer of the tab model.
 *
 * Keys whose conversation no longer exists are dropped rather than rendered as
 * a placeholder: a deleted thread has no tab, and the persisted list is allowed
 * to be briefly stale between prunes.
 */
export function buildConversationTabs(source: ConversationTabSource): ConversationTab[] {
  return groupConversationTabFamilies(buildUngroupedConversationTabs(source)).flatMap((family) => [
    family.parent,
    ...family.children,
  ]);
}

function buildUngroupedConversationTabs(source: ConversationTabSource): ConversationTab[] {
  const threadByKey = new Map(
    source.threads.map(
      (thread) =>
        [conversationTabKey(scopeThreadRef(thread.environmentId, thread.id)), thread] as const,
    ),
  );
  const draftByKey = new Map(
    source.drafts.map(
      (draft) =>
        [conversationTabKey(scopeThreadRef(draft.environmentId, draft.threadId)), draft] as const,
    ),
  );

  // The routed conversation is always its own tab, whatever worktree it turns
  // out to belong to. Routing somewhere and finding no active tab would be a
  // worse failure than one out-of-scope tab.
  const belongsToWorktree = (conversationWorktreeKey: string | null, key: string) =>
    source.worktreeKey === null ||
    key === source.activeKey ||
    conversationWorktreeKey === source.worktreeKey;

  return source.openKeys.flatMap((key): ConversationTab[] => {
    // The live thread wins over its own draft: the instant a draft is promoted
    // both sources describe the same key, and the thread is the truthful one.
    const thread = threadByKey.get(key);
    if (thread !== undefined) {
      // Native harness children are subordinate views of their owner's real
      // provider session. They never become top-level conversation tabs, even
      // if an older persisted open-key list still contains their key.
      if (thread.providerSubagent != null) {
        return [];
      }
      if (
        !belongsToWorktree(
          resolveSidebarConversationWorktreeKey({
            environmentId: thread.environmentId,
            projectId: thread.projectId,
            worktreePath: thread.worktreePath ?? null,
            projectRootByProjectKey: source.projectRootByProjectKey,
          }),
          key,
        )
      ) {
        return [];
      }
      const parentThreadId = thread.parentThreadId ?? null;
      return [
        {
          _tag: "thread",
          key,
          threadRef: scopeThreadRef(thread.environmentId, thread.id),
          title: thread.title || "Untitled",
          state: resolveSidebarConversationAggregateState(thread),
          isActive: source.activeKey === key,
          parentKey:
            parentThreadId === null
              ? null
              : conversationTabKey(scopeThreadRef(thread.environmentId, parentThreadId)),
        },
      ];
    }
    const draft = draftByKey.get(key);
    if (draft !== undefined) {
      if (
        !belongsToWorktree(
          resolveSidebarDraftWorktreeKey({
            draft: {
              draftId: draft.draftId,
              environmentId: draft.environmentId,
              projectId: draft.projectId,
              envMode: draft.envMode,
              worktreePath: draft.worktreePath,
            },
            projectRootByProjectKey: source.projectRootByProjectKey,
          }),
          key,
        )
      ) {
        return [];
      }
      return [
        {
          _tag: "draft",
          key,
          draftId: draft.draftId,
          threadRef: scopeThreadRef(draft.environmentId, draft.threadId),
          title: draft.title,
          isActive: source.activeKey === key,
        },
      ];
    }
    return [];
  });
}

/** The keys still backed by a live conversation, for pruning persisted state. */
export function retainKnownConversationTabs(input: {
  readonly keys: readonly string[];
  readonly knownKeys: ReadonlySet<string>;
}): string[] {
  return input.keys.filter((key) => input.knownKeys.has(key));
}

export type WorktreeFocusTarget =
  | { readonly _tag: "thread"; readonly threadRef: ScopedThreadRef }
  | { readonly _tag: "draft"; readonly draftId: string }
  | { readonly _tag: "none" };

interface WorktreeFocusCandidate {
  readonly drafts: readonly {
    readonly draftId: string;
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
  }[];
  readonly active: readonly {
    readonly environmentId: EnvironmentId;
    readonly id: ThreadId;
    readonly parentThreadId?: ThreadId | null | undefined;
    readonly providerSubagent?: ProviderSubagentBinding | null | undefined;
    readonly updatedAt: string;
  }[];
}

/**
 * Where clicking a worktree lands.
 *
 * A worktree with sub-threads always lands on a top-level conversation. Among
 * top-level conversations, an already-open tab wins, then recency. If the
 * parent shell is unavailable, the same rule falls back across the remaining
 * conversations so an orphaned sub-thread stays reachable.
 */
export function resolveWorktreeFocusTarget(input: {
  readonly worktree: WorktreeFocusCandidate;
  readonly openKeys: ReadonlySet<string>;
  /** A conversation being closed must not win the fallback selection. */
  readonly excludedKey?: string;
}): WorktreeFocusTarget {
  const isExcluded = (ref: { environmentId: EnvironmentId; threadId: ThreadId }) =>
    input.excludedKey === conversationTabKey(scopeThreadRef(ref.environmentId, ref.threadId));
  const byRecency = input.worktree.active
    .filter(
      (candidate) =>
        !isExcluded({ environmentId: candidate.environmentId, threadId: candidate.id }),
    )
    .sort((left, right) => parseTimestamp(right.updatedAt) - parseTimestamp(left.updatedAt));
  const independentlyNavigable = byRecency.filter(
    (candidate) => candidate.providerSubagent == null,
  );
  const topLevel = independentlyNavigable.filter((candidate) => candidate.parentThreadId == null);
  const focusableThreads = topLevel.length > 0 ? topLevel : independentlyNavigable;
  const isOpen = (ref: { environmentId: EnvironmentId; threadId: ThreadId }) =>
    input.openKeys.has(conversationTabKey(scopeThreadRef(ref.environmentId, ref.threadId)));

  // Open beats closed across BOTH pools before recency gets a say. Checking
  // threads to exhaustion first meant a worktree holding one closed thread and
  // one open draft focused the thread, abandoning the draft being written in.
  const openThread = focusableThreads.find((candidate) =>
    isOpen({ environmentId: candidate.environmentId, threadId: candidate.id }),
  );
  if (openThread !== undefined) {
    return { _tag: "thread", threadRef: scopeThreadRef(openThread.environmentId, openThread.id) };
  }
  const remainingDrafts = input.worktree.drafts.filter((draft) => !isExcluded(draft));
  const openDraft = remainingDrafts.find(isOpen);
  if (openDraft !== undefined) return { _tag: "draft", draftId: openDraft.draftId };

  const thread = focusableThreads[0];
  if (thread !== undefined) {
    return {
      _tag: "thread",
      threadRef: scopeThreadRef(thread.environmentId, thread.id),
    };
  }
  const draft = remainingDrafts[0];
  return draft === undefined ? { _tag: "none" } : { _tag: "draft", draftId: draft.draftId };
}

/**
 * Which independently controllable conversation owns the routed transcript.
 * Native children keep their owner's tab active; ordinary threads and drafts
 * retain their own key.
 */
export function resolveConversationTabRouteKey(input: {
  readonly routeThreadKey: string | null;
  readonly threads: readonly EnvironmentThreadShell[];
}): string | null {
  if (input.routeThreadKey === null) return null;
  const routedThread = input.threads.find(
    (thread) =>
      conversationTabKey(scopeThreadRef(thread.environmentId, thread.id)) === input.routeThreadKey,
  );
  const ownerThreadId = routedThread?.providerSubagent?.ownerThreadId;
  if (routedThread === undefined || ownerThreadId === undefined) {
    return input.routeThreadKey;
  }
  return conversationTabKey(scopeThreadRef(routedThread.environmentId, ownerThreadId));
}

function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
