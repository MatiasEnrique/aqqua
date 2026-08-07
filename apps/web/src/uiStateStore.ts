import { Debouncer } from "@tanstack/react-pacer";
import { create } from "zustand";
import { normalizeProjectPathForComparison } from "./lib/projectPaths";

export const PERSISTED_STATE_KEY = "aqqua:ui-state:v1";
/**
 * State that belongs to ONE window, kept in `sessionStorage`.
 *
 * `localStorage` is shared by every same-origin window, so two open windows
 * overwrote each other's selected worktree and tab order, and a reload could
 * restore whichever wrote last. `sessionStorage` is per-window and still
 * survives a reload, which is exactly the documented behaviour of these two.
 */
export const WINDOW_STATE_KEY = "aqqua:ui-window-state:v1";
const THREAD_CHANGED_FILES_EXPANSION_VERSION = 1;
const LEGACY_PERSISTED_STATE_KEYS = [
  "aqqua:renderer-state:v8",
  "aqqua:renderer-state:v7",
  "aqqua:renderer-state:v6",
  "aqqua:renderer-state:v5",
  "aqqua:renderer-state:v4",
  "aqqua:renderer-state:v3",
  "codething:renderer-state:v4",
  "codething:renderer-state:v3",
  "codething:renderer-state:v2",
  "codething:renderer-state:v1",
] as const;

export interface PersistedUiState {
  projectExpandedById?: Record<string, boolean>;
  projectOrder?: string[];
  worktreeOrder?: string[];
  threadLastVisitedAtById?: Record<string, string>;
  activeWorktreeOverrideKey?: string | null;
  openConversationTabKeys?: string[];
  collapsedConversationTabFamilyKeys?: string[];
  /** @deprecated Ignored on read; never written. Tombstones are ephemeral request state. */
  removedWorktreeAtByKey?: Record<string, string>;
  collapsedProjectCwds?: string[];
  expandedProjectCwds?: string[];
  projectOrderCwds?: string[];
  defaultAdvertisedEndpointKey?: string | null;
  threadChangedFilesExpansionVersion?: typeof THREAD_CHANGED_FILES_EXPANSION_VERSION;
  threadChangedFilesExpandedById?: Record<string, Record<string, boolean>>;
}

export interface UiProjectState {
  projectExpandedById: Record<string, boolean>;
  projectOrder: string[];
  worktreeOrder: string[];
}

export interface UiThreadState {
  threadLastVisitedAtById: Record<string, string>;
  threadChangedFilesExpandedById: Record<string, Record<string, boolean>>;
  /**
   * Which worktree card is selected when the route cannot say — a worktree
   * clicked before it holds anything routable. The route always wins over
   * this; see `resolveActiveWorktreeKey`.
   */
  activeWorktreeOverrideKey: string | null;
  /**
   * The conversations the header keeps as tabs, in the order they were opened.
   *
   * Local and durable on purpose: which conversations you are juggling is a
   * property of this window, like a browser's tabs — not of the thread, which
   * every other device and client shares. Membership grows as conversations
   * open; settling or snoozing leaves it alone, while deleted conversations are
   * pruned once every environment has bootstrapped.
   */
  openConversationTabKeys: string[];
  /**
   * The orchestrator tabs whose sub-agents are folded away into a count.
   *
   * Collapsed rather than expanded is the stored fact, so a family a user has
   * never touched is open — a sub-agent that opened a tab is one the user is
   * meant to see, and it should not need a click to become visible.
   */
  collapsedConversationTabFamilyKeys: string[];
}

export interface UiEndpointState {
  defaultAdvertisedEndpointKey: string | null;
}

export interface UiState extends UiProjectState, UiThreadState, UiEndpointState {}

const initialState: UiState = {
  projectExpandedById: {},
  projectOrder: [],
  worktreeOrder: [],
  threadLastVisitedAtById: {},
  threadChangedFilesExpandedById: {},
  activeWorktreeOverrideKey: null,
  openConversationTabKeys: [],
  collapsedConversationTabFamilyKeys: [],
  defaultAdvertisedEndpointKey: null,
};

const LEGACY_PROJECT_CWD_PREFERENCE_PREFIX = "legacy-project-cwd:";
const LEGACY_PROJECT_EXPANSION_DEFAULT_KEY = "legacy-project-expansion-default";
let legacyKeysCleanedUp = false;

export function legacyProjectCwdPreferenceKey(cwd: string): string {
  return `${LEGACY_PROJECT_CWD_PREFERENCE_PREFIX}${normalizeProjectPathForComparison(cwd)}`;
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0),
    ),
  ];
}

function sanitizeBooleanRecord(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, boolean] => entry[0].length > 0 && typeof entry[1] === "boolean",
    ),
  );
}

function sanitizeTimestampRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        entry[0].length > 0 &&
        typeof entry[1] === "string" &&
        entry[1].length > 0 &&
        Number.isFinite(Date.parse(entry[1])),
    ),
  );
}

export function parsePersistedState(parsed: PersistedUiState): UiState {
  const projectExpandedById =
    parsed.projectExpandedById === undefined
      ? (() => {
          const migrated: Record<string, boolean> = {};
          const collapsedProjectCwds = sanitizeStringArray(parsed.collapsedProjectCwds);
          const expandedProjectCwds = sanitizeStringArray(parsed.expandedProjectCwds);
          for (const cwd of collapsedProjectCwds) {
            migrated[legacyProjectCwdPreferenceKey(cwd)] = false;
          }
          for (const cwd of expandedProjectCwds) {
            migrated[legacyProjectCwdPreferenceKey(cwd)] = true;
          }
          if (!Array.isArray(parsed.collapsedProjectCwds) && expandedProjectCwds.length > 0) {
            migrated[LEGACY_PROJECT_EXPANSION_DEFAULT_KEY] = false;
          }
          return migrated;
        })()
      : sanitizeBooleanRecord(parsed.projectExpandedById);
  const projectOrder =
    parsed.projectOrder === undefined
      ? sanitizeStringArray(parsed.projectOrderCwds).map(legacyProjectCwdPreferenceKey)
      : sanitizeStringArray(parsed.projectOrder);

  return {
    projectExpandedById,
    projectOrder,
    worktreeOrder: sanitizeStringArray(parsed.worktreeOrder),
    threadLastVisitedAtById: sanitizeTimestampRecord(parsed.threadLastVisitedAtById),
    activeWorktreeOverrideKey:
      typeof parsed.activeWorktreeOverrideKey === "string"
        ? parsed.activeWorktreeOverrideKey
        : null,
    openConversationTabKeys: sanitizeStringArray(parsed.openConversationTabKeys),
    collapsedConversationTabFamilyKeys: sanitizeStringArray(
      parsed.collapsedConversationTabFamilyKeys,
    ),
    // Legacy removedWorktreeAtByKey tombstones are intentionally dropped: hide
    // state after deleteWorktree is request-local, not a durable preference.
    threadChangedFilesExpandedById:
      parsed.threadChangedFilesExpansionVersion === THREAD_CHANGED_FILES_EXPANSION_VERSION
        ? sanitizePersistedThreadChangedFilesExpanded(parsed.threadChangedFilesExpandedById)
        : {},
    defaultAdvertisedEndpointKey:
      typeof parsed.defaultAdvertisedEndpointKey === "string" &&
      parsed.defaultAdvertisedEndpointKey.length > 0
        ? parsed.defaultAdvertisedEndpointKey
        : null,
  };
}

/** Exported for the persistence suite: the store itself only reads it at init. */
export function readPersistedState(): UiState {
  if (typeof window === "undefined") {
    return initialState;
  }
  try {
    const raw = window.localStorage.getItem(PERSISTED_STATE_KEY);
    if (!raw) {
      for (const legacyKey of LEGACY_PERSISTED_STATE_KEYS) {
        const legacyRaw = window.localStorage.getItem(legacyKey);
        if (!legacyRaw) {
          continue;
        }
        return withWindowLocalState(parsePersistedState(JSON.parse(legacyRaw) as PersistedUiState));
      }
      return withWindowLocalState(initialState);
    }
    return withWindowLocalState(parsePersistedState(JSON.parse(raw) as PersistedUiState));
  } catch {
    return initialState;
  }
}

/** The strip's own state: this window's, not the shared preference blob's. */
type WindowLocalUiState = Pick<
  PersistedUiState,
  "activeWorktreeOverrideKey" | "openConversationTabKeys" | "collapsedConversationTabFamilyKeys"
>;

/**
 * Overlays this window's own copy of the window-local fields.
 *
 * With nothing stored yet, whatever `parsePersistedState` read from the shared
 * blob stands — so a window open across the change keeps the strip it already
 * had rather than blanking once on the way over.
 *
 * A malformed session blob is contained here rather than thrown at the caller:
 * failing outwards would drop the shared state this window just parsed, and the
 * next mutation would write that loss back over `localStorage` for every window.
 */
function withWindowLocalState(state: UiState): UiState {
  let parsed: WindowLocalUiState;
  try {
    const raw = window.sessionStorage.getItem(WINDOW_STATE_KEY);
    if (raw === null) return state;
    parsed = JSON.parse(raw) as typeof parsed;
    if (!parsed || typeof parsed !== "object") return state;
  } catch {
    return state;
  }
  return {
    ...state,
    activeWorktreeOverrideKey:
      typeof parsed.activeWorktreeOverrideKey === "string"
        ? parsed.activeWorktreeOverrideKey
        : null,
    openConversationTabKeys: sanitizeStringArray(parsed.openConversationTabKeys),
    collapsedConversationTabFamilyKeys: sanitizeStringArray(
      parsed.collapsedConversationTabFamilyKeys,
    ),
  };
}

function sanitizePersistedThreadChangedFilesExpanded(
  value: PersistedUiState["threadChangedFilesExpandedById"],
): Record<string, Record<string, boolean>> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const nextState: Record<string, Record<string, boolean>> = {};
  for (const [threadId, turns] of Object.entries(value)) {
    if (!threadId || !turns || typeof turns !== "object") {
      continue;
    }

    const nextTurns: Record<string, boolean> = {};
    for (const [turnId, expanded] of Object.entries(turns)) {
      if (turnId && typeof expanded === "boolean") {
        nextTurns[turnId] = expanded;
      }
    }

    if (Object.keys(nextTurns).length > 0) {
      nextState[threadId] = nextTurns;
    }
  }

  return nextState;
}

export function persistState(state: UiState): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const projectExpandedById = Object.fromEntries(
      Object.entries(state.projectExpandedById).filter(
        ([key]) => key !== LEGACY_PROJECT_EXPANSION_DEFAULT_KEY,
      ),
    );
    window.localStorage.setItem(
      PERSISTED_STATE_KEY,
      JSON.stringify({
        projectExpandedById,
        projectOrder: state.projectOrder,
        worktreeOrder: state.worktreeOrder,
        threadLastVisitedAtById: state.threadLastVisitedAtById,
        defaultAdvertisedEndpointKey: state.defaultAdvertisedEndpointKey,
        threadChangedFilesExpansionVersion: THREAD_CHANGED_FILES_EXPANSION_VERSION,
        threadChangedFilesExpandedById: state.threadChangedFilesExpandedById,
      } satisfies PersistedUiState),
    );
    window.sessionStorage.setItem(
      WINDOW_STATE_KEY,
      JSON.stringify({
        activeWorktreeOverrideKey: state.activeWorktreeOverrideKey,
        openConversationTabKeys: state.openConversationTabKeys,
        collapsedConversationTabFamilyKeys: state.collapsedConversationTabFamilyKeys,
      } satisfies WindowLocalUiState),
    );
    if (!legacyKeysCleanedUp) {
      legacyKeysCleanedUp = true;
      for (const legacyKey of LEGACY_PERSISTED_STATE_KEYS) {
        window.localStorage.removeItem(legacyKey);
      }
    }
  } catch {
    // Ignore quota/storage errors to avoid breaking chat UX.
  }
}

const debouncedPersistState = new Debouncer(persistState, { wait: 500 });

export function markThreadVisited(state: UiState, threadId: string, visitedAt: string): UiState {
  const visitedAtMs = Date.parse(visitedAt);
  if (!Number.isFinite(visitedAtMs)) {
    return state;
  }
  const previousVisitedAt = state.threadLastVisitedAtById[threadId];
  const previousVisitedAtMs = previousVisitedAt ? Date.parse(previousVisitedAt) : NaN;
  if (
    Number.isFinite(previousVisitedAtMs) &&
    Number.isFinite(visitedAtMs) &&
    previousVisitedAtMs >= visitedAtMs
  ) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: {
      ...state.threadLastVisitedAtById,
      [threadId]: visitedAt,
    },
  };
}

export function markThreadUnread(
  state: UiState,
  threadId: string,
  latestTurnCompletedAt: string | null | undefined,
): UiState {
  if (!latestTurnCompletedAt) {
    return state;
  }
  const latestTurnCompletedAtMs = Date.parse(latestTurnCompletedAt);
  if (Number.isNaN(latestTurnCompletedAtMs)) {
    return state;
  }
  const unreadVisitedAt = new Date(latestTurnCompletedAtMs - 1).toISOString();
  if (state.threadLastVisitedAtById[threadId] === unreadVisitedAt) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: {
      ...state.threadLastVisitedAtById,
      [threadId]: unreadVisitedAt,
    },
  };
}

export function setThreadChangedFilesExpanded(
  state: UiState,
  threadId: string,
  turnId: string,
  expanded: boolean,
): UiState {
  const currentThreadState = state.threadChangedFilesExpandedById[threadId] ?? {};
  if (currentThreadState[turnId] === expanded) {
    return state;
  }

  return {
    ...state,
    threadChangedFilesExpandedById: {
      ...state.threadChangedFilesExpandedById,
      [threadId]: {
        ...currentThreadState,
        [turnId]: expanded,
      },
    },
  };
}

export function setActiveWorktreeOverrideKey(state: UiState, key: string | null): UiState {
  if (state.activeWorktreeOverrideKey === key) return state;
  return { ...state, activeWorktreeOverrideKey: key };
}

export function setOpenConversationTabKeys(state: UiState, keys: readonly string[]): UiState {
  const next = [...keys];
  const nextKeySet = new Set(next);
  const collapsedConversationTabFamilyKeys = state.collapsedConversationTabFamilyKeys.filter(
    (key) => nextKeySet.has(key),
  );
  if (
    next.length === state.openConversationTabKeys.length &&
    next.every((key, index) => key === state.openConversationTabKeys[index]) &&
    collapsedConversationTabFamilyKeys.length === state.collapsedConversationTabFamilyKeys.length
  ) {
    return state;
  }
  return { ...state, openConversationTabKeys: next, collapsedConversationTabFamilyKeys };
}

/**
 * Folds an orchestrator's sub-agents away, or unfolds them.
 *
 * Keyed by the orchestrator's tab key and pruned with the strip, so a family
 * that leaves and comes back arrives expanded rather than remembering a
 * collapse from a conversation that is no longer present.
 */
export function toggleCollapsedConversationTabFamily(state: UiState, key: string): UiState {
  const collapsed = state.collapsedConversationTabFamilyKeys;
  return {
    ...state,
    collapsedConversationTabFamilyKeys: collapsed.includes(key)
      ? collapsed.filter((candidate) => candidate !== key)
      : [...collapsed, key],
  };
}

export function retainCollapsedConversationTabFamilies(
  state: UiState,
  knownKeys: ReadonlySet<string>,
): UiState {
  const retained = state.collapsedConversationTabFamilyKeys.filter((key) => knownKeys.has(key));
  if (retained.length === state.collapsedConversationTabFamilyKeys.length) return state;
  return { ...state, collapsedConversationTabFamilyKeys: retained };
}

export function setDefaultAdvertisedEndpointKey(state: UiState, key: string | null): UiState {
  const nextKey = key && key.length > 0 ? key : null;
  if (state.defaultAdvertisedEndpointKey === nextKey) {
    return state;
  }
  return {
    ...state,
    defaultAdvertisedEndpointKey: nextKey,
  };
}

export function resolveProjectExpanded(
  projectExpandedById: Readonly<Record<string, boolean>>,
  preferenceKeys: readonly string[],
): boolean {
  for (const key of preferenceKeys) {
    const expanded = projectExpandedById[key];
    if (expanded !== undefined) {
      return expanded;
    }
  }
  return projectExpandedById[LEGACY_PROJECT_EXPANSION_DEFAULT_KEY] ?? true;
}

export function setProjectExpanded(
  state: UiState,
  projectIds: string | readonly string[],
  expanded: boolean,
): UiState {
  const ids = typeof projectIds === "string" ? [projectIds] : projectIds;
  const nextEntries = ids.filter((projectId) => state.projectExpandedById[projectId] !== expanded);
  if (nextEntries.length === 0) {
    return state;
  }
  const projectExpandedById = { ...state.projectExpandedById };
  for (const projectId of nextEntries) {
    projectExpandedById[projectId] = expanded;
  }
  return {
    ...state,
    projectExpandedById,
  };
}

export function reorderProjects(
  state: UiState,
  currentProjectOrder: readonly string[],
  draggedProjectIds: readonly string[],
  targetProjectIds: readonly string[],
): UiState {
  if (draggedProjectIds.length === 0) {
    return state;
  }
  const draggedSet = new Set(draggedProjectIds);
  const targetSet = new Set(targetProjectIds);
  if (draggedProjectIds.every((id) => targetSet.has(id))) {
    return state;
  }

  const originalTargetIndex = currentProjectOrder.findIndex((id) => targetSet.has(id));
  if (originalTargetIndex < 0) {
    return state;
  }

  const projectOrder = [...currentProjectOrder];

  const removed: string[] = [];
  let draggedBeforeTarget = 0;
  for (let i = projectOrder.length - 1; i >= 0; i--) {
    if (draggedSet.has(projectOrder[i]!)) {
      removed.unshift(projectOrder.splice(i, 1)[0]!);
      if (i < originalTargetIndex) {
        draggedBeforeTarget++;
      }
    }
  }
  if (removed.length === 0) {
    return state;
  }

  const insertIndex = originalTargetIndex - Math.max(0, draggedBeforeTarget - 1);
  projectOrder.splice(insertIndex, 0, ...removed);
  return {
    ...state,
    projectOrder,
  };
}

export function reorderWorktrees(
  state: UiState,
  currentWorktreeOrder: readonly string[],
  draggedWorktreeKey: string,
  targetWorktreeKey: string,
): UiState {
  const draggedIndex = currentWorktreeOrder.indexOf(draggedWorktreeKey);
  const targetIndex = currentWorktreeOrder.indexOf(targetWorktreeKey);
  if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) {
    return state;
  }

  const worktreeOrder = [...currentWorktreeOrder];
  const [dragged] = worktreeOrder.splice(draggedIndex, 1);
  if (dragged === undefined) return state;
  worktreeOrder.splice(targetIndex, 0, dragged);

  const visibleKeys = new Set(currentWorktreeOrder);
  const mergedWorktreeOrder: string[] = [];
  let nextVisibleIndex = 0;
  for (const persistedKey of state.worktreeOrder) {
    if (!visibleKeys.has(persistedKey)) {
      mergedWorktreeOrder.push(persistedKey);
      continue;
    }
    mergedWorktreeOrder.push(worktreeOrder[nextVisibleIndex]!);
    nextVisibleIndex++;
  }
  mergedWorktreeOrder.push(...worktreeOrder.slice(nextVisibleIndex));
  if (
    mergedWorktreeOrder.length === state.worktreeOrder.length &&
    mergedWorktreeOrder.every((key, index) => key === state.worktreeOrder[index])
  ) {
    return state;
  }
  return {
    ...state,
    worktreeOrder: mergedWorktreeOrder,
  };
}

export function rememberWorktreeOrder(
  state: UiState,
  creationOrderedWorktreeKeys: readonly string[],
): UiState {
  const rememberedKeys = new Set(state.worktreeOrder);
  const newKeys = creationOrderedWorktreeKeys.filter((key) => !rememberedKeys.has(key));
  if (newKeys.length === 0) return state;
  return {
    ...state,
    worktreeOrder: [...state.worktreeOrder, ...newKeys],
  };
}

interface UiStateStore extends UiState {
  markThreadVisited: (threadId: string, visitedAt: string) => void;
  markThreadUnread: (threadId: string, latestTurnCompletedAt: string | null | undefined) => void;
  setActiveWorktreeOverrideKey: (key: string | null) => void;
  setOpenConversationTabKeys: (keys: readonly string[]) => void;
  toggleCollapsedConversationTabFamily: (key: string) => void;
  retainCollapsedConversationTabFamilies: (knownKeys: ReadonlySet<string>) => void;
  setThreadChangedFilesExpanded: (threadId: string, turnId: string, expanded: boolean) => void;
  setDefaultAdvertisedEndpointKey: (key: string | null) => void;
  setProjectExpanded: (projectIds: string | readonly string[], expanded: boolean) => void;
  reorderProjects: (
    currentProjectOrder: readonly string[],
    draggedProjectIds: readonly string[],
    targetProjectIds: readonly string[],
  ) => void;
  reorderWorktrees: (
    currentWorktreeOrder: readonly string[],
    draggedWorktreeKey: string,
    targetWorktreeKey: string,
  ) => void;
  rememberWorktreeOrder: (creationOrderedWorktreeKeys: readonly string[]) => void;
}

export const useUiStateStore = create<UiStateStore>((set) => ({
  ...readPersistedState(),
  markThreadVisited: (threadId, visitedAt) =>
    set((state) => markThreadVisited(state, threadId, visitedAt)),
  markThreadUnread: (threadId, latestTurnCompletedAt) =>
    set((state) => markThreadUnread(state, threadId, latestTurnCompletedAt)),
  setActiveWorktreeOverrideKey: (key) => set((state) => setActiveWorktreeOverrideKey(state, key)),
  setOpenConversationTabKeys: (keys) => set((state) => setOpenConversationTabKeys(state, keys)),
  toggleCollapsedConversationTabFamily: (key) =>
    set((state) => toggleCollapsedConversationTabFamily(state, key)),
  retainCollapsedConversationTabFamilies: (knownKeys) =>
    set((state) => retainCollapsedConversationTabFamilies(state, knownKeys)),
  setThreadChangedFilesExpanded: (threadId, turnId, expanded) =>
    set((state) => setThreadChangedFilesExpanded(state, threadId, turnId, expanded)),
  setDefaultAdvertisedEndpointKey: (key) =>
    set((state) => setDefaultAdvertisedEndpointKey(state, key)),
  setProjectExpanded: (projectIds, expanded) =>
    set((state) => setProjectExpanded(state, projectIds, expanded)),
  reorderProjects: (currentProjectOrder, draggedProjectIds, targetProjectIds) =>
    set((state) =>
      reorderProjects(state, currentProjectOrder, draggedProjectIds, targetProjectIds),
    ),
  reorderWorktrees: (currentWorktreeOrder, draggedWorktreeKey, targetWorktreeKey) =>
    set((state) =>
      reorderWorktrees(state, currentWorktreeOrder, draggedWorktreeKey, targetWorktreeKey),
    ),
  rememberWorktreeOrder: (creationOrderedWorktreeKeys) =>
    set((state) => rememberWorktreeOrder(state, creationOrderedWorktreeKeys)),
}));

useUiStateStore.subscribe((state) => debouncedPersistState.maybeExecute(state));

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", () => {
    debouncedPersistState.flush();
  });
}
