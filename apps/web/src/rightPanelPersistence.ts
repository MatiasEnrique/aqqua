/**
 * Persisted right-panel surface descriptors and migration from older shapes.
 */
import { parseScopedThreadKey } from "@aqqua/client-runtime/environment";
import { isWorkspaceTerminalOwnerThreadId } from "@aqqua/shared/terminalOwner";

import { migratePanelOwnerStorageKey } from "./panelOwner";

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
  | { id: "history"; kind: "history" }
  | { id: "pullRequest"; kind: "pullRequest" }
  | {
      id: "files";
      kind: "files";
      relativePath: string | null;
      revealLine: number | null;
      revealRequestId: number;
    }
  | { id: "plan"; kind: "plan" };

export interface ThreadRightPanelState {
  isOpen: boolean;
  activeSurfaceId: string | null;
  surfaces: RightPanelSurface[];
}

export const EMPTY_THREAD_RIGHT_PANEL_STATE: ThreadRightPanelState = {
  isOpen: false,
  activeSurfaceId: null,
  surfaces: [],
};

function parsePersistedSurface(
  value: unknown,
  legacyOriginThreadId: string | undefined,
): RightPanelSurface[] {
  if (!value || typeof value !== "object") return [];
  const surface = value as Record<string, unknown>;
  if (surface.kind === "file") {
    if (typeof surface.relativePath !== "string" || surface.id !== `file:${surface.relativePath}`) {
      return [];
    }
    const revealLine =
      typeof surface.revealLine === "number" && Number.isFinite(surface.revealLine)
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
        id: "files",
        kind: "files",
        relativePath: surface.relativePath,
        revealLine,
        revealRequestId,
      },
    ];
  }
  if (surface.kind === "diff" && surface.id === "diff") {
    return [{ id: "diff", kind: "diff" }];
  }
  if (surface.kind === "history" && surface.id === "history") {
    return [{ id: "history", kind: "history" }];
  }
  if (surface.kind === "pullRequest" && surface.id === "pullRequest") {
    return [{ id: "pullRequest", kind: "pullRequest" }];
  }
  if (surface.kind === "files" && surface.id === "files") {
    const relativePath = typeof surface.relativePath === "string" ? surface.relativePath : null;
    const revealLine =
      relativePath !== null &&
      typeof surface.revealLine === "number" &&
      Number.isFinite(surface.revealLine)
        ? Math.max(1, Math.trunc(surface.revealLine))
        : null;
    const revealRequestId =
      relativePath !== null &&
      typeof surface.revealRequestId === "number" &&
      Number.isSafeInteger(surface.revealRequestId) &&
      surface.revealRequestId >= 0
        ? surface.revealRequestId
        : 0;
    return [{ id: "files", kind: "files", relativePath, revealLine, revealRequestId }];
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
  if (surface.kind === "preview" && surface.id === "browser:new" && surface.resourceId === null) {
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
              (terminalId): terminalId is string => typeof terminalId === "string",
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
    typeof surface.originThreadId === "string" ? surface.originThreadId : legacyOriginThreadId;
  if (!originThreadId || isWorkspaceTerminalOwnerThreadId(originThreadId)) return [];
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
                ...("workspaceRoot" in pane && typeof pane.workspaceRoot === "string"
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
      ...(surface.splitDirection === "vertical" ? { splitDirection: "vertical" as const } : {}),
      originThreadId,
      terminalPanes,
    },
  ];
}

function migratePersistedOwnerState(
  threadKey: string,
  threadState: ThreadRightPanelState,
): [string, ThreadRightPanelState] {
  const validThreadState = threadState && typeof threadState === "object" ? threadState : null;
  const persistedThreadRef = parseScopedThreadKey(threadKey);
  // Legacy synthetic workspace keys encode the path in the ThreadId; never use
  // that fabricated id as a terminal origin. Canonical workspace keys are not
  // parseable as thread keys, so origin must come from the surface itself.
  const legacyOriginThreadId =
    persistedThreadRef && !isWorkspaceTerminalOwnerThreadId(persistedThreadRef.threadId)
      ? persistedThreadRef.threadId
      : undefined;
  const persistedSurfaces = Array.isArray(validThreadState?.surfaces)
    ? validThreadState.surfaces
    : [];
  const parsedSurfaces = persistedSurfaces.flatMap((value) =>
    parsePersistedSurface(value, legacyOriginThreadId),
  );
  const activePersistedSurface = persistedSurfaces.find(
    (value) =>
      value !== null &&
      typeof value === "object" &&
      "id" in value &&
      value.id === validThreadState?.activeSurfaceId,
  );
  const activeParsedSurface = parsePersistedSurface(
    activePersistedSurface,
    legacyOriginThreadId,
  )[0];
  const surfaces: RightPanelSurface[] = [];
  for (const surface of parsedSurfaces) {
    const existingIndex = surfaces.findIndex((candidate) => candidate.id === surface.id);
    if (existingIndex < 0) surfaces.push(surface);
    else if (surface.kind === "files") surfaces[existingIndex] = surface;
  }
  if (activeParsedSurface?.kind === "files") {
    const filesIndex = surfaces.findIndex((surface) => surface.kind === "files");
    if (filesIndex >= 0) surfaces[filesIndex] = activeParsedSurface;
  }
  const migratedActiveSurfaceId =
    activeParsedSurface?.id ??
    (typeof validThreadState?.activeSurfaceId === "string"
      ? validThreadState.activeSurfaceId
      : null);
  const activeSurfaceId = surfaces.some((surface) => surface.id === migratedActiveSurfaceId)
    ? migratedActiveSurfaceId
    : null;
  const isOpen =
    typeof validThreadState?.isOpen === "boolean"
      ? validThreadState.isOpen
      : activeSurfaceId !== null;
  return [migratePanelOwnerStorageKey(threadKey), { isOpen, surfaces, activeSurfaceId }];
}

function mergeMigratedOwnerStates(
  entries: ReadonlyArray<readonly [string, ThreadRightPanelState]>,
): Record<string, ThreadRightPanelState> {
  const byThreadKey: Record<string, ThreadRightPanelState> = {};
  for (const [key, state] of entries) {
    const existing = byThreadKey[key];
    if (!existing) {
      byThreadKey[key] = state;
      continue;
    }
    // Two legacy keys mapped to the same owner — keep surfaces without id collisions.
    const surfaces = [...existing.surfaces];
    for (const surface of state.surfaces) {
      if (!surfaces.some((candidate) => candidate.id === surface.id)) {
        surfaces.push(surface);
      }
    }
    const activeSurfaceId =
      existing.activeSurfaceId ??
      (state.activeSurfaceId && surfaces.some((surface) => surface.id === state.activeSurfaceId)
        ? state.activeSurfaceId
        : (surfaces.at(-1)?.id ?? null));
    byThreadKey[key] = {
      isOpen: existing.isOpen || state.isOpen,
      surfaces,
      activeSurfaceId,
    };
  }
  return byThreadKey;
}

export function migratePersistedRightPanelState(persistedState: unknown): {
  byThreadKey: Record<string, ThreadRightPanelState>;
} {
  if (!persistedState || typeof persistedState !== "object") {
    return { byThreadKey: {} };
  }
  if (
    !("byThreadKey" in persistedState) ||
    !persistedState.byThreadKey ||
    typeof persistedState.byThreadKey !== "object"
  ) {
    return { byThreadKey: {} };
  }
  const entries = Object.entries(
    persistedState.byThreadKey as Record<string, ThreadRightPanelState>,
  ).map(([threadKey, threadState]) => migratePersistedOwnerState(threadKey, threadState));
  return { byThreadKey: mergeMigratedOwnerStates(entries) };
}
