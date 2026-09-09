import { useAtomValue } from "@effect/atom-react";
import type { WorkspacePanelRef } from "@aqqua/client-runtime/environment";
import type { EnvironmentId } from "@aqqua/contracts";
import { lazy, Suspense, useCallback, useMemo, useState, type ReactNode } from "react";

import { useOpenInPreferredEditor } from "../../editorPreferences";
import type { RightPanelSurface } from "../../rightPanelStore";
import { primaryServerAvailableEditorsAtom } from "../../state/server";
import { RightPanelSidebar } from "../RightPanelSidebar";
import { stackedThreadToast, toastManager } from "../ui/toast";

const DiffPanel = lazy(() => import("../DiffPanel"));
const FileBrowserPanel = lazy(() => import("../files/FileBrowserPanel"));
const GitHistoryPanel = lazy(() =>
  import("../gitHistory/GitHistoryPanel").then((module) => ({ default: module.GitHistoryPanel })),
);

const NO_SURFACES: ReadonlyArray<RightPanelSurface> = [];
const NO_PENDING: ReadonlySet<string> = new Set();
const NO_PREVIEWS = {};
const NO_TERMINAL_LABELS: ReadonlyMap<string, string> = new Map();

const FILES_SURFACE: RightPanelSurface = {
  id: "files",
  kind: "files",
  relativePath: null,
  revealLine: null,
  revealRequestId: 0,
};
const DIFF_SURFACE: RightPanelSurface = { id: "diff", kind: "diff" };
const HISTORY_SURFACE: RightPanelSurface = { id: "history", kind: "history" };

/**
 * The workspace panels for a checkout with no conversation in front of it.
 *
 * A flow card owns a worktree whether or not one of its steps is open, so the
 * rail belongs on those panes too — the same rail, the same panels, reading the
 * card's checkout. What the panels cannot do here is talk to a composer: with
 * no conversation there is nowhere to send a review comment or a terminal, so
 * those surfaces stay out rather than pretending.
 */
export function WorkspaceRightPanel({
  environmentId,
  workspaceRoot,
  projectName,
  timestampFormat,
}: {
  readonly environmentId: EnvironmentId;
  /** The checkout the panels read; `null` leaves the rail empty but present. */
  readonly workspaceRoot: string | null;
  readonly projectName: string;
  readonly timestampFormat: Parameters<typeof GitHistoryPanel>[0]["timestampFormat"];
}) {
  const [surfaces, setSurfaces] = useState<ReadonlyArray<RightPanelSurface>>(NO_SURFACES);
  const [activeSurfaceId, setActiveSurfaceId] = useState<string | null>(null);
  const availableEditors = useAtomValue(primaryServerAvailableEditorsAtom);
  const openInPreferredEditor = useOpenInPreferredEditor(environmentId, availableEditors);
  const available = workspaceRoot !== null;

  const workspaceRef = useMemo<WorkspacePanelRef | null>(
    () => (workspaceRoot === null ? null : { environmentId, workspaceRoot }),
    [environmentId, workspaceRoot],
  );

  const open = useCallback((surface: RightPanelSurface) => {
    setSurfaces((current) =>
      current.some((candidate) => candidate.id === surface.id) ? current : [...current, surface],
    );
    setActiveSurfaceId(surface.id);
  }, []);

  const close = useCallback((surface: RightPanelSurface) => {
    setSurfaces((current) => {
      const next = current.filter((candidate) => candidate.id !== surface.id);
      setActiveSurfaceId((active) =>
        active === surface.id ? (next[next.length - 1]?.id ?? null) : active,
      );
      return next;
    });
  }, []);

  const closeAll = useCallback(() => {
    setSurfaces(NO_SURFACES);
    setActiveSurfaceId(null);
  }, []);

  const openFileInEditor = useCallback(
    (relativePath: string) => {
      if (workspaceRoot === null) return;
      void (async () => {
        const result = await openInPreferredEditor(`${workspaceRoot}/${relativePath}`);
        if (result._tag === "Success") return;
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not open the file",
            description: "Set a preferred editor in Settings → General.",
          }),
        );
      })();
    },
    [openInPreferredEditor, workspaceRoot],
  );

  const activeSurface = surfaces.find((surface) => surface.id === activeSurfaceId) ?? null;
  const content: ReactNode =
    workspaceRoot === null || activeSurface === null ? null : activeSurface.kind === "files" ? (
      <Suspense fallback={null}>
        <FileBrowserPanel
          environmentId={environmentId}
          cwd={workspaceRoot}
          projectName={projectName}
          onOpenFile={openFileInEditor}
        />
      </Suspense>
    ) : activeSurface.kind === "diff" ? (
      <Suspense fallback={null}>
        <DiffPanel
          mode="embedded"
          // No conversation behind this pane, so no review comments: the diff
          // is here to be read.
          composerDraftTarget={null}
          initialGitScope="branch"
          threadRef={null}
          workspaceRef={workspaceRef}
          fallbackCwd={workspaceRoot}
        />
      </Suspense>
    ) : activeSurface.kind === "history" ? (
      <Suspense fallback={null}>
        <GitHistoryPanel
          environmentId={environmentId}
          cwd={workspaceRoot}
          composerDraftTarget={null}
          threadRef={null}
          workspaceRef={workspaceRef}
          timestampFormat={timestampFormat}
        />
      </Suspense>
    ) : null;

  return (
    <RightPanelSidebar
      mode="inline"
      collapsed={activeSurface === null}
      surfaces={surfaces}
      activeSurfaceId={activeSurfaceId}
      pendingSurfaceIds={NO_PENDING}
      previewSessions={NO_PREVIEWS}
      terminalLabelsById={NO_TERMINAL_LABELS}
      preferredSurfaceIdForKind={(kind) =>
        surfaces.find((surface) => surface.kind === kind)?.id ?? undefined
      }
      onActivate={(surface) => setActiveSurfaceId(surface.id)}
      onCloseSurface={close}
      onCloseOtherSurfaces={(surface) => {
        setSurfaces([surface]);
        setActiveSurfaceId(surface.id);
      }}
      onCloseSurfacesToRight={(surface) => {
        setSurfaces((current) => {
          const index = current.findIndex((candidate) => candidate.id === surface.id);
          return index < 0 ? current : current.slice(0, index + 1);
        });
      }}
      onCloseAllSurfaces={closeAll}
      onHide={closeAll}
      onCopyFilePath={(relativePath) => void navigator.clipboard?.writeText(relativePath)}
      onAddFiles={() => open(FILES_SURFACE)}
      onAddDiff={() => open(DIFF_SURFACE)}
      onAddHistory={() => open(HISTORY_SURFACE)}
      onAddBrowser={() => undefined}
      onAddTerminal={() => undefined}
      onAddPullRequest={() => undefined}
      filesAvailable={available}
      diffAvailable={available}
      historyAvailable={available}
      // These three carry a conversation's state — terminals belong to a
      // thread, previews and pull request actions post back into one.
      browserAvailable={false}
      terminalAvailable={false}
      pullRequestAvailable={false}
    >
      {content}
    </RightPanelSidebar>
  );
}
