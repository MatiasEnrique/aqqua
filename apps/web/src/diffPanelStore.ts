import type { WorkspacePanelRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef, TurnId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";
import {
  migratePanelOwnerKeyRecord,
  panelOwnerKey,
  type PanelStoreOwner,
  workspacePanelOwner,
} from "./panelOwner";

export type DiffPanelSelection =
  | { kind: "branch"; baseRef: string | null }
  | { kind: "unstaged" }
  | { kind: "turn"; turnId: TurnId; filePath: string | null; revealRequestId: number };

/** Diff selection is keyed by the shared panel owner model. */
export type DiffPanelOwner = PanelStoreOwner;

const DEFAULT_SELECTION: DiffPanelSelection = { kind: "branch", baseRef: null };
const DEFAULT_WORKING_TREE_SELECTION: DiffPanelSelection = { kind: "unstaged" };

interface DiffPanelStoreState {
  byThreadKey: Record<string, DiffPanelSelection>;
  branchBaseRefByThreadKey: Record<string, string | null>;
  visibleTurnThreadKey: string | null;
  selectGitScope: (owner: DiffPanelOwner, scope: "branch" | "unstaged") => void;
  selectBranchBaseRef: (owner: DiffPanelOwner, baseRef: string | null) => void;
  selectTurn: (owner: DiffPanelOwner, turnId: TurnId, filePath?: string) => void;
  reconcileTurnSelection: (owner: DiffPanelOwner, availableTurnIds: ReadonlyArray<TurnId>) => void;
  migrateLegacyWorkspaceSelection: (
    threadRef: ScopedThreadRef,
    workspaceRef: WorkspacePanelRef,
  ) => void;
  removeThread: (owner: DiffPanelOwner) => void;
}

function normalizeBaseRef(baseRef: string | null): string | null {
  const normalized = baseRef?.trim();
  return normalized ? normalized : null;
}

export function migratePersistedDiffPanelState(persistedState: unknown): {
  byThreadKey: Record<string, DiffPanelSelection>;
  branchBaseRefByThreadKey: Record<string, string | null>;
} {
  if (!persistedState || typeof persistedState !== "object") {
    return { byThreadKey: {}, branchBaseRefByThreadKey: {} };
  }
  const state = persistedState as {
    byThreadKey?: Record<string, DiffPanelSelection>;
    branchBaseRefByThreadKey?: Record<string, string | null>;
  };
  return {
    byThreadKey: migratePanelOwnerKeyRecord(state.byThreadKey),
    branchBaseRefByThreadKey: migratePanelOwnerKeyRecord(state.branchBaseRefByThreadKey),
  };
}

export const useDiffPanelStore = create<DiffPanelStoreState>()(
  persist(
    (set) => ({
      byThreadKey: {},
      branchBaseRefByThreadKey: {},
      visibleTurnThreadKey: null,
      selectGitScope: (owner, scope) =>
        set((state) => {
          const threadKey = panelOwnerKey(owner);
          const previous = state.byThreadKey[threadKey];
          const previousBaseRef =
            previous?.kind === "branch"
              ? previous.baseRef
              : (state.branchBaseRefByThreadKey[threadKey] ?? null);
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]:
                scope === "branch"
                  ? { kind: "branch", baseRef: previousBaseRef }
                  : { kind: "unstaged" },
            },
            branchBaseRefByThreadKey:
              previous?.kind === "branch"
                ? { ...state.branchBaseRefByThreadKey, [threadKey]: previous.baseRef }
                : state.branchBaseRefByThreadKey,
            visibleTurnThreadKey: null,
          };
        }),
      selectBranchBaseRef: (owner, baseRef) =>
        set((state) => {
          const threadKey = panelOwnerKey(owner);
          const normalizedBaseRef = normalizeBaseRef(baseRef);
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: { kind: "branch", baseRef: normalizedBaseRef },
            },
            branchBaseRefByThreadKey: {
              ...state.branchBaseRefByThreadKey,
              [threadKey]: normalizedBaseRef,
            },
            visibleTurnThreadKey: null,
          };
        }),
      selectTurn: (owner, turnId, filePath) =>
        set((state) => {
          const threadKey = panelOwnerKey(owner);
          const previous = state.byThreadKey[threadKey];
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: {
                kind: "turn",
                turnId,
                filePath: filePath?.trim() || null,
                revealRequestId: previous?.kind === "turn" ? previous.revealRequestId + 1 : 1,
              },
            },
            visibleTurnThreadKey: threadKey,
          };
        }),
      reconcileTurnSelection: (owner, availableTurnIds) =>
        set((state) => {
          const threadKey = panelOwnerKey(owner);
          const previous = state.byThreadKey[threadKey];
          const latestTurnId = availableTurnIds[0];
          if (
            previous?.kind !== "turn" ||
            latestTurnId === undefined ||
            availableTurnIds.includes(previous.turnId)
          ) {
            return state;
          }
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: { ...previous, turnId: latestTurnId },
            },
          };
        }),
      migrateLegacyWorkspaceSelection: (threadRef, workspaceRef) =>
        set((state) => {
          const workspaceOwner = workspacePanelOwner(workspaceRef);
          if (!workspaceOwner) return state;
          const threadKey = panelOwnerKey(threadRef);
          const workspaceKey = panelOwnerKey(workspaceOwner);
          if (state.byThreadKey[workspaceKey] !== undefined) return state;
          const legacy = state.byThreadKey[threadKey];
          if (!legacy || legacy.kind === "turn") return state;
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [workspaceKey]: legacy,
            },
            branchBaseRefByThreadKey:
              legacy.kind === "branch"
                ? {
                    ...state.branchBaseRefByThreadKey,
                    [workspaceKey]: legacy.baseRef,
                  }
                : state.branchBaseRefByThreadKey,
          };
        }),
      removeThread: (owner) =>
        set((state) => {
          const threadKey = panelOwnerKey(owner);
          if (!(threadKey in state.byThreadKey) && !(threadKey in state.branchBaseRefByThreadKey)) {
            return state;
          }
          const { [threadKey]: _removed, ...byThreadKey } = state.byThreadKey;
          const { [threadKey]: _removedBaseRef, ...branchBaseRefByThreadKey } =
            state.branchBaseRefByThreadKey;
          return {
            byThreadKey,
            branchBaseRefByThreadKey,
            visibleTurnThreadKey:
              state.visibleTurnThreadKey === threadKey ? null : state.visibleTurnThreadKey,
          };
        }),
    }),
    {
      name: "t3code:diff-panel-state:v1",
      version: 3,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        byThreadKey: state.byThreadKey,
        branchBaseRefByThreadKey: state.branchBaseRefByThreadKey,
      }),
      migrate: migratePersistedDiffPanelState,
    },
  ),
);

export function selectThreadDiffPanelSelection(
  byThreadKey: Record<string, DiffPanelSelection>,
  owner: DiffPanelOwner | null | undefined,
  hasWorkingTreeChanges = false,
): DiffPanelSelection {
  if (!owner) return DEFAULT_SELECTION;
  return (
    byThreadKey[panelOwnerKey(owner)] ??
    (hasWorkingTreeChanges ? DEFAULT_WORKING_TREE_SELECTION : DEFAULT_SELECTION)
  );
}
