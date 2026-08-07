import { scopedThreadKey, scopeThreadRef } from "@aqqua/client-runtime/environment";
import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/models";
import type { EnvironmentId, ProjectId, ScopedThreadRef, ThreadId } from "@aqqua/contracts";
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
    };

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
 * The strip's contents, in the order the tabs were opened.
 *
 * Keys whose conversation no longer exists are dropped rather than rendered as
 * a placeholder: a deleted thread has no tab, and the persisted list is allowed
 * to be briefly stale between prunes.
 */
export function buildConversationTabs(source: ConversationTabSource): ConversationTab[] {
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
      return [
        {
          _tag: "thread",
          key,
          threadRef: scopeThreadRef(thread.environmentId, thread.id),
          title: thread.title || "Untitled",
          state: resolveSidebarConversationAggregateState(thread),
          isActive: source.activeKey === key,
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
    readonly updatedAt: string;
  }[];
}

/**
 * Where clicking a worktree lands.
 *
 * An already-open tab wins, so selecting a worktree resumes what you were doing
 * there instead of yanking a stale conversation into the strip. Within either
 * pool the most recently active conversation wins — the code had no prior rule,
 * and recency is the one the strip's own ordering already implies.
 */
export function resolveWorktreeFocusTarget(input: {
  readonly worktree: WorktreeFocusCandidate;
  readonly openKeys: ReadonlySet<string>;
}): WorktreeFocusTarget {
  const byRecency = [...input.worktree.active].sort(
    (left, right) => parseTimestamp(right.updatedAt) - parseTimestamp(left.updatedAt),
  );
  const isOpen = (ref: { environmentId: EnvironmentId; threadId: ThreadId }) =>
    input.openKeys.has(conversationTabKey(scopeThreadRef(ref.environmentId, ref.threadId)));

  // Open beats closed across BOTH pools before recency gets a say. Checking
  // threads to exhaustion first meant a worktree holding one closed thread and
  // one open draft focused the thread, abandoning the draft being written in.
  const openThread = byRecency.find((candidate) =>
    isOpen({ environmentId: candidate.environmentId, threadId: candidate.id }),
  );
  if (openThread !== undefined) {
    return { _tag: "thread", threadRef: scopeThreadRef(openThread.environmentId, openThread.id) };
  }
  const openDraft = input.worktree.drafts.find(isOpen);
  if (openDraft !== undefined) return { _tag: "draft", draftId: openDraft.draftId };

  const thread = byRecency[0];
  if (thread !== undefined) {
    return {
      _tag: "thread",
      threadRef: scopeThreadRef(thread.environmentId, thread.id),
    };
  }
  const draft = input.worktree.drafts[0];
  return draft === undefined ? { _tag: "none" } : { _tag: "draft", draftId: draft.draftId };
}

function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
