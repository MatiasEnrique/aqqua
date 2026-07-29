/**
 * Thread-scoped right-panel surface state.
 *
 * This is intentionally a shallow workspace model: it owns an ordered set of
 * surface descriptors and the active surface, while each feature continues to
 * own its durable resource state. Browser surfaces point at preview tab ids,
 * terminal surfaces point at terminal session ids, file surfaces point at
 * workspace paths, and diff/plan/files remain singleton surfaces.
 */
import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import type { WorkspacePanelRef } from "@t3tools/client-runtime/environment";
import { workspaceTerminalOwnerThreadId } from "@t3tools/shared/terminalOwner";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

export const RIGHT_PANEL_KINDS = ["plan", "diff", "files", "file", "preview", "terminal"] as const;
export type RightPanelKind = (typeof RIGHT_PANEL_KINDS)[number];

export interface RightPanelContext {
  readonly threadRef: ScopedThreadRef;
  readonly workspaceRef: WorkspacePanelRef | null;
}

const THREAD_SCOPED_RIGHT_PANEL_KINDS = new Set<RightPanelKind>(["plan", "preview"]);

export function workspaceRightPanelRef(
  workspaceRef: WorkspacePanelRef | null,
): ScopedThreadRef | null {
  if (!workspaceRef) return null;
  return {
    environmentId: workspaceRef.environmentId,
    threadId: ThreadId.make(workspaceTerminalOwnerThreadId(workspaceRef.workspaceRoot)),
  };
}

export function rightPanelRefForKind(
  context: RightPanelContext,
  kind: RightPanelKind,
): ScopedThreadRef {
  return THREAD_SCOPED_RIGHT_PANEL_KINDS.has(kind)
    ? context.threadRef
    : (workspaceRightPanelRef(context.workspaceRef) ?? context.threadRef);
}

export type RightPanelSurface =
  | { id: `browser:${string}`; kind: "preview"; resourceId: string }
  | { id: "browser:new"; kind: "preview"; resourceId: null }
  | {
      id: `terminal:${string}`;
      kind: "terminal";
      resourceId: string;
      terminalIds: string[];
      activeTerminalId: string;
      splitDirection?: "horizontal" | "vertical";
      originThreadId?: string;
      terminalPanes: Array<{
        terminalId: string;
        originThreadId: string;
        workspaceRoot?: string;
      }>;
    }
  | { id: "diff"; kind: "diff" }
  | { id: "files"; kind: "files" }
  | {
      id: `file:${string}`;
      kind: "file";
      relativePath: string;
      revealLine: number | null;
      revealRequestId: number;
    }
  | { id: "plan"; kind: "plan" };

const RIGHT_PANEL_STORAGE_KEY = "t3code:right-panel-state:v2";
const RIGHT_PANEL_STORAGE_VERSION = 8;

export interface ThreadRightPanelState {
  isOpen: boolean;
  activeSurfaceId: string | null;
  surfaces: RightPanelSurface[];
}

interface RightPanelStoreState {
  byThreadKey: Record<string, ThreadRightPanelState>;
  open: (ref: ScopedThreadRef, kind: Exclude<RightPanelKind, "file" | "terminal">) => void;
  openBrowser: (ref: ScopedThreadRef, tabId: string | null) => void;
  openFile: (ref: ScopedThreadRef, relativePath: string, line?: number) => void;
  openTerminal: (
    ref: ScopedThreadRef,
    terminalId: string,
    originThreadId?: string,
    workspaceRoot?: string,
  ) => void;
  splitTerminal: (
    ref: ScopedThreadRef,
    surfaceId: string,
    terminalId: string,
    direction?: "horizontal" | "vertical",
    originThreadId?: string,
    workspaceRoot?: string,
  ) => void;
  activateTerminal: (ref: ScopedThreadRef, surfaceId: string, terminalId: string) => void;
  closeTerminal: (ref: ScopedThreadRef, surfaceId: string, terminalId: string) => void;
  activateSurface: (ref: ScopedThreadRef, surfaceId: string) => void;
  closeSurface: (ref: ScopedThreadRef, surfaceId: string) => void;
  closeOtherSurfaces: (ref: ScopedThreadRef, surfaceId: string) => void;
  closeSurfacesToRight: (ref: ScopedThreadRef, surfaceId: string) => void;
  closeAllSurfaces: (ref: ScopedThreadRef) => void;
  reconcileBrowserSurfaces: (ref: ScopedThreadRef, tabIds: readonly string[]) => void;
  reconcileFileSurfaces: (ref: ScopedThreadRef, workspaceAvailable: boolean) => void;
  migrateLegacyWorkspaceSurfaces: (context: RightPanelContext) => void;
  hideContext: (context: RightPanelContext) => void;
  restoreContext: (context: RightPanelContext) => void;
  show: (ref: ScopedThreadRef) => void;
  close: (ref: ScopedThreadRef) => void;
  toggleVisibility: (ref: ScopedThreadRef) => void;
  toggle: (ref: ScopedThreadRef, kind: Exclude<RightPanelKind, "file" | "terminal">) => void;
  removeThread: (ref: ScopedThreadRef) => void;
}

const EMPTY_THREAD_STATE: ThreadRightPanelState = {
  isOpen: false,
  activeSurfaceId: null,
  surfaces: [],
};

const singletonSurface = (
  kind: Exclude<RightPanelKind, "file" | "preview" | "terminal">,
): RightPanelSurface => {
  switch (kind) {
    case "diff":
      return { id: "diff", kind };
    case "files":
      return { id: "files", kind };
    case "plan":
      return { id: "plan", kind };
  }
};

const browserSurface = (tabId: string | null): RightPanelSurface =>
  tabId
    ? { id: `browser:${tabId}`, kind: "preview", resourceId: tabId }
    : { id: "browser:new", kind: "preview", resourceId: null };

const fileSurface = (
  relativePath: string,
  revealLine: number | null,
  revealRequestId: number,
): RightPanelSurface => ({
  id: `file:${relativePath}`,
  kind: "file",
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
  const current = byThreadKey[threadKey] ?? EMPTY_THREAD_STATE;
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

export function migratePersistedRightPanelState(persistedState: unknown): {
  byThreadKey: Record<string, ThreadRightPanelState>;
} {
  if (!persistedState || typeof persistedState !== "object") {
    return { byThreadKey: {} };
  }
  const byThreadKey =
    "byThreadKey" in persistedState &&
    persistedState.byThreadKey &&
    typeof persistedState.byThreadKey === "object"
      ? Object.fromEntries(
          Object.entries(persistedState.byThreadKey as Record<string, ThreadRightPanelState>).map(
            ([threadKey, threadState]) => {
              const validThreadState =
                threadState && typeof threadState === "object" ? threadState : null;
              const persistedThreadRef = parseScopedThreadKey(threadKey);
              const surfaces = Array.isArray(validThreadState?.surfaces)
                ? validThreadState.surfaces.flatMap<RightPanelSurface>((value) => {
                    if (!value || typeof value !== "object") return [];
                    const surface = value as Record<string, unknown>;
                    if (surface.kind === "file") {
                      if (
                        typeof surface.relativePath !== "string" ||
                        surface.id !== `file:${surface.relativePath}`
                      ) {
                        return [];
                      }
                      const revealLine =
                        typeof surface.revealLine === "number" &&
                        Number.isFinite(surface.revealLine)
                          ? Math.max(1, Math.trunc(surface.revealLine))
                          : null;
                      const revealRequestId =
                        typeof surface.revealRequestId === "number" &&
                        Number.isSafeInteger(surface.revealRequestId) &&
                        surface.revealRequestId >= 0
                          ? surface.revealRequestId
                          : 0;
                      return [
                        {
                          id: surface.id as `file:${string}`,
                          kind: "file",
                          relativePath: surface.relativePath,
                          revealLine,
                          revealRequestId,
                        },
                      ];
                    }
                    if (surface.kind === "diff" && surface.id === "diff") {
                      return [{ id: "diff", kind: "diff" }];
                    }
                    if (surface.kind === "files" && surface.id === "files") {
                      return [{ id: "files", kind: "files" }];
                    }
                    if (surface.kind === "plan" && surface.id === "plan") {
                      return [{ id: "plan", kind: "plan" }];
                    }
                    if (
                      surface.kind === "preview" &&
                      typeof surface.id === "string" &&
                      typeof surface.resourceId === "string" &&
                      surface.id === `browser:${surface.resourceId}`
                    ) {
                      return [
                        {
                          id: surface.id as `browser:${string}`,
                          kind: "preview",
                          resourceId: surface.resourceId,
                        },
                      ];
                    }
                    if (
                      surface.kind === "preview" &&
                      surface.id === "browser:new" &&
                      surface.resourceId === null
                    ) {
                      return [{ id: "browser:new", kind: "preview", resourceId: null }];
                    }
                    if (surface.kind !== "terminal") return [];
                    if (
                      typeof surface.resourceId !== "string" ||
                      typeof surface.id !== "string" ||
                      !surface.id.startsWith("terminal:")
                    ) {
                      return [];
                    }
                    const terminalIds =
                      "terminalIds" in surface && Array.isArray(surface.terminalIds)
                        ? [
                            ...new Set(
                              surface.terminalIds.filter(
                                (terminalId): terminalId is string =>
                                  typeof terminalId === "string",
                              ),
                            ),
                          ]
                        : [surface.resourceId];
                    const activeTerminalId =
                      "activeTerminalId" in surface &&
                      typeof surface.activeTerminalId === "string" &&
                      terminalIds.includes(surface.activeTerminalId)
                        ? surface.activeTerminalId
                        : (terminalIds[0] ?? surface.resourceId);
                    const originThreadId =
                      typeof surface.originThreadId === "string"
                        ? surface.originThreadId
                        : persistedThreadRef?.threadId;
                    if (!originThreadId) return [];
                    const persistedPanes = Array.isArray(surface.terminalPanes)
                      ? surface.terminalPanes.flatMap<{
                          terminalId: string;
                          originThreadId: string;
                          workspaceRoot?: string;
                        }>((pane) =>
                          pane &&
                          typeof pane === "object" &&
                          "terminalId" in pane &&
                          typeof pane.terminalId === "string" &&
                          "originThreadId" in pane &&
                          typeof pane.originThreadId === "string"
                            ? [
                                {
                                  terminalId: pane.terminalId,
                                  originThreadId: pane.originThreadId,
                                  ...("workspaceRoot" in pane &&
                                  typeof pane.workspaceRoot === "string"
                                    ? { workspaceRoot: pane.workspaceRoot }
                                    : {}),
                                },
                              ]
                            : [],
                        )
                      : [];
                    const terminalPanes = terminalIds.map(
                      (terminalId) =>
                        persistedPanes.find((pane) => pane.terminalId === terminalId) ?? {
                          terminalId,
                          originThreadId,
                          ...(typeof surface.workspaceRoot === "string"
                            ? { workspaceRoot: surface.workspaceRoot }
                            : {}),
                        },
                    );
                    return [
                      {
                        id: surface.id as `terminal:${string}`,
                        kind: "terminal",
                        resourceId: surface.resourceId,
                        terminalIds: terminalIds.length > 0 ? terminalIds : [surface.resourceId],
                        activeTerminalId,
                        ...(surface.splitDirection === "vertical"
                          ? { splitDirection: "vertical" as const }
                          : {}),
                        originThreadId,
                        terminalPanes,
                      },
                    ];
                  })
                : [];
              const activeSurfaceId = surfaces.some(
                (surface) => surface.id === validThreadState?.activeSurfaceId,
              )
                ? (validThreadState?.activeSurfaceId ?? null)
                : null;
              const isOpen =
                typeof validThreadState?.isOpen === "boolean"
                  ? validThreadState.isOpen
                  : activeSurfaceId !== null;
              return [threadKey, { isOpen, surfaces, activeSurfaceId }];
            },
          ),
        )
      : {};
  return { byThreadKey };
}

export const useRightPanelStore = create<RightPanelStoreState>()(
  persist(
    (set) => ({
      byThreadKey: {},
      open: (ref, kind) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            if (kind === "preview") {
              const existing = current.surfaces.find((surface) => surface.kind === "preview");
              return upsertSurface(current, existing ?? browserSurface(null));
            }
            return upsertSurface(current, singletonSurface(kind));
          }),
        })),
      openBrowser: (ref, tabId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            const surface = browserSurface(tabId);
            const withoutPlaceholder = tabId
              ? current.surfaces.filter((entry) => entry.id !== "browser:new")
              : current.surfaces;
            return upsertSurface({ ...current, surfaces: withoutPlaceholder }, surface);
          }),
        })),
      openFile: (ref, relativePath, line) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            const withoutStandaloneExplorer = current.surfaces.filter(
              (surface) => surface.kind !== "files",
            );
            const surfaceId = `file:${relativePath}` as const;
            const existing = withoutStandaloneExplorer.find(
              (surface): surface is Extract<RightPanelSurface, { kind: "file" }> =>
                surface.id === surfaceId && surface.kind === "file",
            );
            const surface = fileSurface(
              relativePath,
              normalizeRevealLine(line),
              (existing?.revealRequestId ?? 0) + 1,
            );
            return {
              isOpen: true,
              activeSurfaceId: surface.id,
              surfaces: existing
                ? withoutStandaloneExplorer.map((entry) =>
                    entry.id === surface.id ? surface : entry,
                  )
                : [...withoutStandaloneExplorer, surface],
            };
          }),
        })),
      openTerminal: (ref, terminalId, originThreadId = ref.threadId, workspaceRoot) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) =>
            upsertSurface(current, terminalSurface(terminalId, originThreadId, workspaceRoot)),
          ),
        })),
      splitTerminal: (
        ref,
        surfaceId,
        terminalId,
        direction = "horizontal",
        originThreadId = ref.threadId,
        workspaceRoot,
      ) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => ({
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
                terminalPanes: surface.terminalPanes.some((pane) => pane.terminalId === terminalId)
                  ? surface.terminalPanes
                  : [
                      ...surface.terminalPanes,
                      {
                        terminalId,
                        originThreadId,
                        ...(workspaceRoot ? { workspaceRoot } : {}),
                      },
                    ],
                ...(direction === "vertical" ? { splitDirection: "vertical" as const } : {}),
              };
            }),
          })),
        })),
      activateTerminal: (ref, surfaceId, terminalId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => ({
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
      closeTerminal: (ref, surfaceId, terminalId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
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
      activateSurface: (ref, surfaceId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) =>
            current.surfaces.some((surface) => surface.id === surfaceId)
              ? { ...current, isOpen: true, activeSurfaceId: surfaceId }
              : current,
          ),
        })),
      closeSurface: (ref, surfaceId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
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
      closeOtherSurfaces: (ref, surfaceId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
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
      closeSurfacesToRight: (ref, surfaceId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
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
      closeAllSurfaces: (ref) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) =>
            current.surfaces.length === 0
              ? current
              : { ...current, isOpen: false, surfaces: [], activeSurfaceId: null },
          ),
        })),
      reconcileBrowserSurfaces: (ref, tabIds) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
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
      reconcileFileSurfaces: (ref, workspaceAvailable) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            if (workspaceAvailable) return current;
            const surfaces = current.surfaces.filter(
              (surface) => surface.kind !== "files" && surface.kind !== "file",
            );
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
          const workspaceRef = workspaceRightPanelRef(context.workspaceRef);
          if (!workspaceRef) return state;
          const threadKey = scopedThreadKey(context.threadRef);
          const workspaceKey = scopedThreadKey(workspaceRef);
          const threadState = state.byThreadKey[threadKey];
          if (!threadState) return state;
          const legacy = threadState.surfaces.filter(
            (surface) => !THREAD_SCOPED_RIGHT_PANEL_KINDS.has(surface.kind),
          );
          if (legacy.length === 0) return state;
          const threadSurfaces = threadState.surfaces.filter((surface) =>
            THREAD_SCOPED_RIGHT_PANEL_KINDS.has(surface.kind),
          );
          const workspaceState = state.byThreadKey[workspaceKey] ?? EMPTY_THREAD_STATE;
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
          const activeRef = rightPanelRefForKind(context, active.kind);
          const activeKey = scopedThreadKey(activeRef);
          const contextKeys = new Set([
            scopedThreadKey(context.threadRef),
            ...(context.workspaceRef
              ? [scopedThreadKey(workspaceRightPanelRef(context.workspaceRef)!)]
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
          const workspaceRef = workspaceRightPanelRef(context.workspaceRef);
          const candidates = [context.threadRef, ...(workspaceRef ? [workspaceRef] : [])];
          const restoreRef = candidates.find((ref) => {
            const current = state.byThreadKey[scopedThreadKey(ref)];
            return current?.activeSurfaceId != null;
          });
          if (!restoreRef) return state;
          return {
            byThreadKey: updateThread(
              state.byThreadKey,
              scopedThreadKey(restoreRef),
              (current) => ({ ...current, isOpen: true }),
            ),
          };
        }),
      show: (ref) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) =>
            current.isOpen ? current : { ...current, isOpen: true },
          ),
        })),
      close: (ref) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) =>
            current.isOpen ? { ...current, isOpen: false } : current,
          ),
        })),
      toggleVisibility: (ref) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => ({
            ...current,
            isOpen: !current.isOpen,
          })),
        })),
      toggle: (ref, kind) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
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
      removeThread: (ref) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
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
  ref: ScopedThreadRef | null | undefined,
): ThreadRightPanelState {
  if (!ref) return EMPTY_THREAD_STATE;
  return byThreadKey[scopedThreadKey(ref)] ?? EMPTY_THREAD_STATE;
}

export function selectActiveRightPanel(
  byThreadKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
): RightPanelKind | null {
  const state = selectThreadRightPanelState(byThreadKey, ref);
  if (!state.isOpen) return null;
  return state.surfaces.find((surface) => surface.id === state.activeSurfaceId)?.kind ?? null;
}

export function selectActiveRightPanelSurface(
  byThreadKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
): RightPanelSurface | null {
  const state = selectThreadRightPanelState(byThreadKey, ref);
  if (!state.isOpen) return null;
  return state.surfaces.find((surface) => surface.id === state.activeSurfaceId) ?? null;
}

export function selectRightPanelContextState(
  byThreadKey: Record<string, ThreadRightPanelState>,
  context: RightPanelContext | null | undefined,
): ThreadRightPanelState {
  if (!context) return EMPTY_THREAD_STATE;
  const threadState = selectThreadRightPanelState(byThreadKey, context.threadRef);
  const workspaceRef = workspaceRightPanelRef(context.workspaceRef);
  const workspaceState = selectThreadRightPanelState(byThreadKey, workspaceRef);
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
