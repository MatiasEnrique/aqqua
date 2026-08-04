/**
 * Right-panel surface state, keyed by an explicit panel owner.
 *
 * Thread-owned surfaces (plan, preview) are scoped to a real thread. Workspace-
 * owned surfaces (diff, history, pull request, files, terminal) share one bucket per
 * workspace root. Owner keying lives in `panelOwner`; persisted surface
 * parsing lives in `rightPanelPersistence`.
 *
 * This is intentionally a shallow model: it owns an ordered set of surface
 * descriptors and the active surface, while each feature continues to own its
 * durable resource state.
 */
import type { WorkspacePanelRef } from "@aqqua/client-runtime/environment";
import type { ScopedThreadRef } from "@aqqua/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";
import {
  originThreadIdForOwner,
  panelOwnerKey,
  resolvePanelOwner,
  threadPanelOwner,
  workspacePanelOwner,
  type PanelOwner,
  type PanelStoreOwner,
} from "./panelOwner";
import {
  EMPTY_THREAD_RIGHT_PANEL_STATE,
  migratePersistedRightPanelState,
  type RightPanelSurface,
  type ThreadRightPanelState,
} from "./rightPanelPersistence";

export type { RightPanelSurface, ThreadRightPanelState } from "./rightPanelPersistence";
export { migratePersistedRightPanelState } from "./rightPanelPersistence";

/** @deprecated Prefer PanelOwner from panelOwner — re-exported for call-site stability. */
export type RightPanelOwner = PanelOwner;
/** @deprecated Prefer PanelStoreOwner from panelOwner. */
export type RightPanelStoreOwner = PanelStoreOwner;

export {
  migratePanelOwnerStorageKey,
  originThreadIdForOwner,
  panelOwnerKey,
  resolvePanelOwner,
  threadPanelOwner,
  workspacePanelOwner,
  type PanelOwner,
  type PanelStoreOwner,
} from "./panelOwner";

// Stable aliases used by existing UI/tests.
export const threadRightPanelOwner = threadPanelOwner;
export const workspaceRightPanelOwner = workspacePanelOwner;
export const resolveRightPanelOwner = resolvePanelOwner;
export const rightPanelOwnerKey = panelOwnerKey;

export const RIGHT_PANEL_KINDS = [
  "plan",
  "diff",
  "history",
  "pullRequest",
  "files",
  "preview",
  "terminal",
] as const;
export type RightPanelKind = (typeof RIGHT_PANEL_KINDS)[number];

export interface RightPanelContext {
  readonly threadRef: ScopedThreadRef;
  readonly workspaceRef: WorkspacePanelRef | null;
}

const THREAD_SCOPED_RIGHT_PANEL_KINDS = new Set<RightPanelKind>(["plan", "preview"]);

export function rightPanelOwnerForKind(
  context: RightPanelContext,
  kind: RightPanelKind,
): PanelOwner {
  if (THREAD_SCOPED_RIGHT_PANEL_KINDS.has(kind) || !context.workspaceRef) {
    return threadPanelOwner(context.threadRef);
  }
  return { type: "workspace", workspaceRef: context.workspaceRef };
}

const RIGHT_PANEL_STORAGE_KEY = "aqqua:right-panel-state:v2";
const RIGHT_PANEL_STORAGE_VERSION = 10;

interface RightPanelStoreState {
  byThreadKey: Record<string, ThreadRightPanelState>;
  open: (owner: PanelStoreOwner, kind: Exclude<RightPanelKind, "terminal">) => void;
  openBrowser: (owner: PanelStoreOwner, tabId: string | null) => void;
  openFile: (owner: PanelStoreOwner, relativePath: string, line?: number) => void;
  openTerminal: (
    owner: PanelStoreOwner,
    terminalId: string,
    originThreadId?: string,
    workspaceRoot?: string,
  ) => void;
  splitTerminal: (
    owner: PanelStoreOwner,
    surfaceId: string,
    terminalId: string,
    direction?: "horizontal" | "vertical",
    originThreadId?: string,
    workspaceRoot?: string,
  ) => void;
  activateTerminal: (owner: PanelStoreOwner, surfaceId: string, terminalId: string) => void;
  closeTerminal: (owner: PanelStoreOwner, surfaceId: string, terminalId: string) => void;
  activateSurface: (owner: PanelStoreOwner, surfaceId: string) => void;
  closeSurface: (owner: PanelStoreOwner, surfaceId: string) => void;
  closeOtherSurfaces: (owner: PanelStoreOwner, surfaceId: string) => void;
  closeSurfacesToRight: (owner: PanelStoreOwner, surfaceId: string) => void;
  closeAllSurfaces: (owner: PanelStoreOwner) => void;
  reconcileBrowserSurfaces: (owner: PanelStoreOwner, tabIds: readonly string[]) => void;
  reconcileFileSurfaces: (owner: PanelStoreOwner, workspaceAvailable: boolean) => void;
  migrateLegacyWorkspaceSurfaces: (context: RightPanelContext) => void;
  hideContext: (context: RightPanelContext) => void;
  restoreContext: (context: RightPanelContext) => void;
  show: (owner: PanelStoreOwner) => void;
  close: (owner: PanelStoreOwner) => void;
  toggleVisibility: (owner: PanelStoreOwner) => void;
  toggle: (owner: PanelStoreOwner, kind: Exclude<RightPanelKind, "terminal">) => void;
  removeThread: (owner: PanelStoreOwner) => void;
}

const singletonSurface = (
  kind: Exclude<RightPanelKind, "preview" | "terminal">,
): RightPanelSurface => {
  switch (kind) {
    case "diff":
      return { id: "diff", kind };
    case "history":
      return { id: "history", kind };
    case "pullRequest":
      return { id: "pullRequest", kind };
    case "files":
      return {
        id: "files",
        kind,
        relativePath: null,
        revealLine: null,
        revealRequestId: 0,
      };
    case "plan":
      return { id: "plan", kind };
  }
};

const browserSurface = (tabId: string | null): RightPanelSurface =>
  tabId
    ? { id: `browser:${tabId}`, kind: "preview", resourceId: tabId }
    : { id: "browser:new", kind: "preview", resourceId: null };

const filesSurface = (
  relativePath: string,
  revealLine: number | null,
  revealRequestId: number,
): RightPanelSurface => ({
  id: "files",
  kind: "files",
  relativePath,
  revealLine,
  revealRequestId,
});

const terminalSurface = (
  terminalId: string,
  originThreadId: string,
  workspaceRoot?: string,
): RightPanelSurface => ({
  id: `terminal:${terminalId}`,
  kind: "terminal",
  resourceId: terminalId,
  terminalIds: [terminalId],
  activeTerminalId: terminalId,
  originThreadId,
  terminalPanes: [{ terminalId, originThreadId, ...(workspaceRoot ? { workspaceRoot } : {}) }],
});

const upsertSurface = (
  current: ThreadRightPanelState,
  surface: RightPanelSurface,
  activate = true,
): ThreadRightPanelState => ({
  isOpen: true,
  surfaces: current.surfaces.some((entry) => entry.id === surface.id)
    ? current.surfaces
    : [...current.surfaces, surface],
  activeSurfaceId: activate ? surface.id : current.activeSurfaceId,
});

const updateThread = (
  byThreadKey: Record<string, ThreadRightPanelState>,
  threadKey: string,
  updater: (current: ThreadRightPanelState) => ThreadRightPanelState,
): Record<string, ThreadRightPanelState> => {
  const current = byThreadKey[threadKey] ?? EMPTY_THREAD_RIGHT_PANEL_STATE;
  const next = updater(current);
  if (!next.isOpen && next.activeSurfaceId === null && next.surfaces.length === 0) {
    if (!(threadKey in byThreadKey)) return byThreadKey;
    const { [threadKey]: _removed, ...rest } = byThreadKey;
    return rest;
  }
  if (next === current) return byThreadKey;
  return { ...byThreadKey, [threadKey]: next };
};

function normalizeRevealLine(line: number | undefined): number | null {
  if (line === undefined || !Number.isFinite(line)) return null;
  return Math.max(1, Math.trunc(line));
}

export const useRightPanelStore = create<RightPanelStoreState>()(
  persist(
    (set) => ({
      byThreadKey: {},
      open: (owner, kind) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, panelOwnerKey(owner), (current) => {
            if (kind === "preview") {
              const existing = current.surfaces.find((surface) => surface.kind === "preview");
              return upsertSurface(current, existing ?? browserSurface(null));
            }
            return upsertSurface(current, singletonSurface(kind));
          }),
        })),
      openBrowser: (owner, tabId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, panelOwnerKey(owner), (current) => {
            const surface = browserSurface(tabId);
            const withoutPlaceholder = tabId
              ? current.surfaces.filter((entry) => entry.id !== "browser:new")
              : current.surfaces;
            return upsertSurface({ ...current, surfaces: withoutPlaceholder }, surface);
          }),
        })),
      openFile: (owner, relativePath, line) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, panelOwnerKey(owner), (current) => {
            const existing = current.surfaces.find(
              (surface): surface is Extract<RightPanelSurface, { kind: "files" }> =>
                surface.kind === "files",
            );
            const surface = filesSurface(
              relativePath,
              normalizeRevealLine(line),
              (existing?.revealRequestId ?? 0) + 1,
            );
            return {
              isOpen: true,
              activeSurfaceId: surface.id,
              surfaces: existing
                ? current.surfaces.map((entry) => (entry.id === surface.id ? surface : entry))
                : [...current.surfaces, surface],
            };
          }),
        })),
      openTerminal: (owner, terminalId, originThreadId, workspaceRoot) =>
        set((state) => {
          const resolved = resolvePanelOwner(owner);
          const origin = originThreadIdForOwner(resolved, originThreadId);
          if (!origin) return state;
          return {
            byThreadKey: updateThread(state.byThreadKey, panelOwnerKey(resolved), (current) =>
              upsertSurface(current, terminalSurface(terminalId, origin, workspaceRoot)),
            ),
          };
        }),
      splitTerminal: (
        owner,
        surfaceId,
        terminalId,
        direction = "horizontal",
        originThreadId,
        workspaceRoot,
      ) =>
        set((state) => {
          const resolved = resolvePanelOwner(owner);
          const origin = originThreadIdForOwner(resolved, originThreadId);
          if (!origin) return state;
          return {
            byThreadKey: updateThread(state.byThreadKey, panelOwnerKey(resolved), (current) => ({
              ...current,
              isOpen: true,
              activeSurfaceId: surfaceId,
              surfaces: current.surfaces.map((surface) => {
                if (surface.id !== surfaceId || surface.kind !== "terminal") return surface;
                const { splitDirection: _splitDirection, ...baseSurface } = surface;
                return {
                  ...baseSurface,
                  terminalIds: surface.terminalIds.includes(terminalId)
                    ? surface.terminalIds
                    : [...surface.terminalIds, terminalId],
                  activeTerminalId: terminalId,
                  terminalPanes: surface.terminalPanes.some(
                    (pane) => pane.terminalId === terminalId,
                  )
                    ? surface.terminalPanes
                    : [
                        ...surface.terminalPanes,
                        {
                          terminalId,
                          originThreadId: origin,
                          ...(workspaceRoot ? { workspaceRoot } : {}),
                        },
                      ],
                  ...(direction === "vertical" ? { splitDirection: "vertical" as const } : {}),
                };
              }),
            })),
          };
        }),
      activateTerminal: (owner, surfaceId, terminalId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, panelOwnerKey(owner), (current) => ({
            ...current,
            activeSurfaceId: surfaceId,
            surfaces: current.surfaces.map((surface) =>
              surface.id === surfaceId &&
              surface.kind === "terminal" &&
              surface.terminalIds.includes(terminalId)
                ? { ...surface, activeTerminalId: terminalId }
                : surface,
            ),
          })),
        })),
      closeTerminal: (owner, surfaceId, terminalId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, panelOwnerKey(owner), (current) => {
            const surface = current.surfaces.find(
              (entry) => entry.id === surfaceId && entry.kind === "terminal",
            );
            if (!surface || surface.kind !== "terminal") return current;
            const terminalIds = surface.terminalIds.filter((id) => id !== terminalId);
            const terminalPanes = surface.terminalPanes.filter(
              (pane) => pane.terminalId !== terminalId,
            );
            if (terminalIds.length === 0) {
              const index = current.surfaces.findIndex((entry) => entry.id === surfaceId);
              const surfaces = current.surfaces.filter((entry) => entry.id !== surfaceId);
              const fallback = surfaces[Math.min(index, surfaces.length - 1)] ?? null;
              return {
                ...current,
                isOpen: surfaces.length > 0 && current.isOpen,
                surfaces,
                activeSurfaceId:
                  current.activeSurfaceId === surfaceId
                    ? (fallback?.id ?? null)
                    : current.activeSurfaceId,
              };
            }
            return {
              ...current,
              surfaces: current.surfaces.map((entry) =>
                entry.id === surfaceId && entry.kind === "terminal"
                  ? {
                      ...entry,
                      terminalIds,
                      terminalPanes,
                      activeTerminalId:
                        entry.activeTerminalId === terminalId
                          ? (terminalIds.at(-1) ?? terminalIds[0]!)
                          : entry.activeTerminalId,
                    }
                  : entry,
              ),
            };
          }),
        })),
      activateSurface: (owner, surfaceId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, panelOwnerKey(owner), (current) =>
            current.surfaces.some((surface) => surface.id === surfaceId)
              ? { ...current, isOpen: true, activeSurfaceId: surfaceId }
              : current,
          ),
        })),
      closeSurface: (owner, surfaceId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, panelOwnerKey(owner), (current) => {
            const index = current.surfaces.findIndex((surface) => surface.id === surfaceId);
            if (index < 0) return current;
            const surfaces = current.surfaces.filter((surface) => surface.id !== surfaceId);
            if (current.activeSurfaceId !== surfaceId) {
              return { ...current, isOpen: surfaces.length > 0 && current.isOpen, surfaces };
            }
            const fallback = surfaces[Math.min(index, surfaces.length - 1)] ?? null;
            return {
              ...current,
              isOpen: surfaces.length > 0 && current.isOpen,
              surfaces,
              activeSurfaceId: fallback?.id ?? null,
            };
          }),
        })),
      closeOtherSurfaces: (owner, surfaceId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, panelOwnerKey(owner), (current) => {
            const surface = current.surfaces.find((entry) => entry.id === surfaceId);
            if (!surface || current.surfaces.length === 1) return current;
            return {
              ...current,
              isOpen: true,
              surfaces: [surface],
              activeSurfaceId: surface.id,
            };
          }),
        })),
      closeSurfacesToRight: (owner, surfaceId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, panelOwnerKey(owner), (current) => {
            const index = current.surfaces.findIndex((surface) => surface.id === surfaceId);
            if (index < 0 || index === current.surfaces.length - 1) return current;
            const surfaces = current.surfaces.slice(0, index + 1);
            const activeStillExists = surfaces.some(
              (surface) => surface.id === current.activeSurfaceId,
            );
            return {
              ...current,
              surfaces,
              activeSurfaceId: activeStillExists ? current.activeSurfaceId : surfaceId,
            };
          }),
        })),
      closeAllSurfaces: (owner) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, panelOwnerKey(owner), (current) =>
            current.surfaces.length === 0
              ? current
              : { ...current, isOpen: false, surfaces: [], activeSurfaceId: null },
          ),
        })),
      reconcileBrowserSurfaces: (owner, tabIds) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, panelOwnerKey(owner), (current) => {
            const validIds = new Set(tabIds.map((tabId) => `browser:${tabId}`));
            const nonBrowser = current.surfaces.filter((surface) => surface.kind !== "preview");
            const existingBrowser = current.surfaces.filter(
              (surface): surface is Extract<RightPanelSurface, { kind: "preview" }> =>
                surface.kind === "preview" &&
                surface.id !== "browser:new" &&
                validIds.has(surface.id),
            );
            const knownIds = new Set(existingBrowser.map((surface) => surface.id));
            const added = tabIds
              .filter((tabId) => !knownIds.has(`browser:${tabId}`))
              .map((tabId) => browserSurface(tabId));
            const surfaces = [...nonBrowser, ...existingBrowser, ...added];
            const activeStillExists = surfaces.some(
              (surface) => surface.id === current.activeSurfaceId,
            );
            const fallbackBrowser = surfaces.find((surface) => surface.kind === "preview");
            return {
              ...current,
              surfaces,
              activeSurfaceId: activeStillExists
                ? current.activeSurfaceId
                : (fallbackBrowser?.id ?? surfaces[0]?.id ?? null),
            };
          }),
        })),
      reconcileFileSurfaces: (owner, workspaceAvailable) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, panelOwnerKey(owner), (current) => {
            if (workspaceAvailable) return current;
            const surfaces = current.surfaces.filter((surface) => surface.kind !== "files");
            if (surfaces.length === current.surfaces.length) return current;
            const activeStillExists = surfaces.some(
              (surface) => surface.id === current.activeSurfaceId,
            );
            return {
              ...current,
              isOpen: surfaces.length > 0 ? current.isOpen : false,
              surfaces,
              activeSurfaceId: activeStillExists
                ? current.activeSurfaceId
                : (surfaces.at(-1)?.id ?? null),
            };
          }),
        })),
      migrateLegacyWorkspaceSurfaces: (context) =>
        set((state) => {
          const workspaceOwner = workspacePanelOwner(context.workspaceRef);
          if (!workspaceOwner) return state;
          const threadKey = panelOwnerKey(threadPanelOwner(context.threadRef));
          const workspaceKey = panelOwnerKey(workspaceOwner);
          const threadState = state.byThreadKey[threadKey];
          if (!threadState) return state;
          const legacy = threadState.surfaces.filter(
            (surface) => !THREAD_SCOPED_RIGHT_PANEL_KINDS.has(surface.kind),
          );
          if (legacy.length === 0) return state;
          const threadSurfaces = threadState.surfaces.filter((surface) =>
            THREAD_SCOPED_RIGHT_PANEL_KINDS.has(surface.kind),
          );
          const workspaceState = state.byThreadKey[workspaceKey] ?? EMPTY_THREAD_RIGHT_PANEL_STATE;
          const workspaceSurfaces = [...workspaceState.surfaces];
          let migratedActiveSurfaceId: string | null = null;
          for (const legacySurface of legacy) {
            let surface =
              legacySurface.kind === "terminal" && !legacySurface.originThreadId
                ? { ...legacySurface, originThreadId: context.threadRef.threadId }
                : legacySurface;
            const terminalIdentity =
              surface.kind === "terminal"
                ? {
                    resourceId: surface.resourceId,
                    originThreadId: surface.originThreadId,
                  }
                : null;
            const equivalentTerminal = terminalIdentity
              ? workspaceSurfaces.find(
                  (candidate) =>
                    candidate.kind === "terminal" &&
                    candidate.resourceId === terminalIdentity.resourceId &&
                    candidate.originThreadId === terminalIdentity.originThreadId,
                )
              : undefined;
            const idCollision = workspaceSurfaces.some((candidate) => candidate.id === surface.id);
            if (equivalentTerminal) {
              surface = equivalentTerminal;
            } else if (surface.kind === "terminal" && idCollision) {
              surface = {
                ...surface,
                id: `terminal:${surface.originThreadId ?? context.threadRef.threadId}:${surface.resourceId}`,
              };
              workspaceSurfaces.push(surface);
            } else if (!idCollision) {
              workspaceSurfaces.push(surface);
            }
            if (legacySurface.id === threadState.activeSurfaceId) {
              migratedActiveSurfaceId = surface.id;
            }
          }
          const activeWasLegacy = legacy.some(
            (surface) => surface.id === threadState.activeSurfaceId,
          );
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: {
                ...threadState,
                surfaces: threadSurfaces,
                isOpen: threadState.isOpen && threadSurfaces.length > 0 && !activeWasLegacy,
                activeSurfaceId: threadSurfaces.some(
                  (surface) => surface.id === threadState.activeSurfaceId,
                )
                  ? threadState.activeSurfaceId
                  : (threadSurfaces.at(-1)?.id ?? null),
              },
              [workspaceKey]: {
                isOpen: workspaceState.isOpen || (threadState.isOpen && activeWasLegacy),
                surfaces: workspaceSurfaces,
                activeSurfaceId:
                  threadState.isOpen && activeWasLegacy
                    ? migratedActiveSurfaceId
                    : (workspaceState.activeSurfaceId ?? workspaceSurfaces.at(-1)?.id ?? null),
              },
            },
          };
        }),
      hideContext: (context) =>
        set((state) => {
          const active = selectActiveRightPanelContextSurface(state.byThreadKey, context);
          if (!active) return state;
          const activeOwner = rightPanelOwnerForKind(context, active.kind);
          const activeKey = panelOwnerKey(activeOwner);
          const contextKeys = new Set([
            panelOwnerKey(threadPanelOwner(context.threadRef)),
            ...(context.workspaceRef
              ? [panelOwnerKey({ type: "workspace", workspaceRef: context.workspaceRef })]
              : []),
          ]);
          const byThreadKey = { ...state.byThreadKey };
          let changed = false;
          for (const key of contextKeys) {
            const current = byThreadKey[key];
            if (!current) continue;
            byThreadKey[key] = {
              ...current,
              isOpen: false,
              activeSurfaceId: key === activeKey ? current.activeSurfaceId : null,
            };
            changed = true;
          }
          return changed ? { byThreadKey } : state;
        }),
      restoreContext: (context) =>
        set((state) => {
          const workspaceOwner = workspacePanelOwner(context.workspaceRef);
          const candidates: PanelOwner[] = [
            threadPanelOwner(context.threadRef),
            ...(workspaceOwner ? [workspaceOwner] : []),
          ];
          const restoreOwner = candidates.find((owner) => {
            const current = state.byThreadKey[panelOwnerKey(owner)];
            return current?.activeSurfaceId != null;
          });
          if (!restoreOwner) return state;
          return {
            byThreadKey: updateThread(
              state.byThreadKey,
              panelOwnerKey(restoreOwner),
              (current) => ({ ...current, isOpen: true }),
            ),
          };
        }),
      show: (owner) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, panelOwnerKey(owner), (current) =>
            current.isOpen ? current : { ...current, isOpen: true },
          ),
        })),
      close: (owner) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, panelOwnerKey(owner), (current) =>
            current.isOpen ? { ...current, isOpen: false } : current,
          ),
        })),
      toggleVisibility: (owner) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, panelOwnerKey(owner), (current) => ({
            ...current,
            isOpen: !current.isOpen,
          })),
        })),
      toggle: (owner, kind) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, panelOwnerKey(owner), (current) => {
            const active = current.surfaces.find(
              (surface) => surface.id === current.activeSurfaceId,
            );
            if (current.isOpen && active?.kind === kind) {
              return { ...current, isOpen: false };
            }
            if (kind === "preview") {
              const existing = current.surfaces.find((surface) => surface.kind === "preview");
              return upsertSurface(current, existing ?? browserSurface(null));
            }
            return upsertSurface(current, singletonSurface(kind));
          }),
        })),
      removeThread: (owner) =>
        set((state) => {
          const threadKey = panelOwnerKey(owner);
          if (!(threadKey in state.byThreadKey)) return state;
          const { [threadKey]: _removed, ...rest } = state.byThreadKey;
          return { byThreadKey: rest };
        }),
    }),
    {
      name: RIGHT_PANEL_STORAGE_KEY,
      version: RIGHT_PANEL_STORAGE_VERSION,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byThreadKey: state.byThreadKey }),
      migrate: migratePersistedRightPanelState,
    },
  ),
);

export function selectThreadRightPanelState(
  byThreadKey: Record<string, ThreadRightPanelState>,
  owner: PanelStoreOwner | null | undefined,
): ThreadRightPanelState {
  if (!owner) return EMPTY_THREAD_RIGHT_PANEL_STATE;
  return byThreadKey[panelOwnerKey(owner)] ?? EMPTY_THREAD_RIGHT_PANEL_STATE;
}

export function selectActiveRightPanel(
  byThreadKey: Record<string, ThreadRightPanelState>,
  owner: PanelStoreOwner | null | undefined,
): RightPanelKind | null {
  const state = selectThreadRightPanelState(byThreadKey, owner);
  if (!state.isOpen) return null;
  return state.surfaces.find((surface) => surface.id === state.activeSurfaceId)?.kind ?? null;
}

export function selectActiveRightPanelSurface(
  byThreadKey: Record<string, ThreadRightPanelState>,
  owner: PanelStoreOwner | null | undefined,
): RightPanelSurface | null {
  const state = selectThreadRightPanelState(byThreadKey, owner);
  if (!state.isOpen) return null;
  return state.surfaces.find((surface) => surface.id === state.activeSurfaceId) ?? null;
}

/**
 * Pure derivation of the merged thread+workspace right-panel snapshot.
 *
 * Intentionally not referentially stable: each call allocates a fresh object.
 * Components must subscribe to a stable store slice (e.g. `state.byThreadKey`)
 * and memoize this result locally — do not pass this through a
 * `useSyncExternalStore` selector, or React will re-render forever.
 */
export function selectRightPanelContextState(
  byThreadKey: Record<string, ThreadRightPanelState>,
  context: RightPanelContext | null | undefined,
): ThreadRightPanelState {
  if (!context) return EMPTY_THREAD_RIGHT_PANEL_STATE;
  const threadState = selectThreadRightPanelState(byThreadKey, context.threadRef);
  const workspaceOwner = workspacePanelOwner(context.workspaceRef);
  const workspaceState = selectThreadRightPanelState(byThreadKey, workspaceOwner);
  const threadSurfaces = threadState.surfaces.filter((surface) =>
    THREAD_SCOPED_RIGHT_PANEL_KINDS.has(surface.kind),
  );
  const legacyWorkspaceSurfaces = threadState.surfaces.filter(
    (surface) => !THREAD_SCOPED_RIGHT_PANEL_KINDS.has(surface.kind),
  );
  const workspaceSurfaces = [...legacyWorkspaceSurfaces, ...workspaceState.surfaces].filter(
    (surface, index, all) => all.findIndex((candidate) => candidate.id === surface.id) === index,
  );
  const surfaces = [...threadSurfaces, ...workspaceSurfaces];
  const threadActive = threadSurfaces.find((surface) => surface.id === threadState.activeSurfaceId);
  const workspaceActive =
    workspaceSurfaces.find((surface) => surface.id === workspaceState.activeSurfaceId) ??
    legacyWorkspaceSurfaces.find((surface) => surface.id === threadState.activeSurfaceId);
  const activeSurfaceId =
    threadState.isOpen && threadActive
      ? threadActive.id
      : workspaceState.isOpen && workspaceActive
        ? workspaceActive.id
        : threadState.isOpen && workspaceActive
          ? workspaceActive.id
          : null;
  return {
    isOpen: activeSurfaceId !== null,
    activeSurfaceId,
    surfaces,
  };
}

export function selectActiveRightPanelContextSurface(
  byThreadKey: Record<string, ThreadRightPanelState>,
  context: RightPanelContext | null | undefined,
): RightPanelSurface | null {
  const state = selectRightPanelContextState(byThreadKey, context);
  if (!state.isOpen) return null;
  return state.surfaces.find((surface) => surface.id === state.activeSurfaceId) ?? null;
}
