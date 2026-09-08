import type { ContextMenuItem, PreviewSessionSnapshot } from "@aqqua/contracts";
import { getTerminalLabel } from "@aqqua/shared/terminalLabels";
import {
  ClipboardList,
  FileDiff,
  Files,
  GitGraph,
  GitPullRequest,
  Globe2,
  PanelRightClose,
  Plus,
  TerminalSquare,
  X,
} from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
} from "react";
import type { LucideIcon } from "lucide-react";

import { isElectron } from "~/env";
import {
  panelOwnerKey,
  rightPanelOwnerForKind,
  type RightPanelContext,
  type RightPanelSurface,
} from "~/rightPanelStore";
import { RIGHT_PANEL_SURFACE_UNAVAILABLE_REASONS } from "~/rightPanelAvailability";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";

import { PreviewPanelShell, type PreviewPanelMode } from "./preview/PreviewPanelShell";

interface RightPanelSidebarProps {
  projectActions?: ReactNode;
  mode: PreviewPanelMode;
  maximized?: boolean;
  /** Keep the activity rail visible while its content is hidden. */
  collapsed?: boolean;
  surfaces: readonly RightPanelSurface[];
  activeSurfaceId: string | null;
  pendingSurfaceIds: ReadonlySet<string>;
  previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  terminalLabelsById: ReadonlyMap<string, string>;
  preferredSurfaceIdForKind: (kind: RightPanelSurface["kind"]) => string | undefined;
  onActivate: (surface: RightPanelSurface) => void;
  onCloseSurface: (surface: RightPanelSurface) => void;
  onCloseOtherSurfaces: (surface: RightPanelSurface) => void;
  onCloseSurfacesToRight: (surface: RightPanelSurface) => void;
  onCloseAllSurfaces: () => void;
  onHide: () => void;
  onCopyFilePath: (relativePath: string) => void;
  onAddBrowser: () => void;
  onAddTerminal: () => void;
  onAddDiff: () => void;
  onAddHistory: () => void;
  onAddPullRequest: () => void;
  onAddFiles: () => void;
  browserAvailable: boolean;
  terminalAvailable: boolean;
  diffAvailable: boolean;
  historyAvailable: boolean;
  pullRequestAvailable: boolean;
  filesAvailable: boolean;
  children: ReactNode;
}

type PanelItemContextMenuAction =
  | "copy-path"
  | "close"
  | "close-others"
  | "close-to-right"
  | "close-all";

type RightPanelActivity = {
  readonly kind: RightPanelSurface["kind"];
  readonly label: string;
  readonly icon: LucideIcon;
  readonly available: boolean;
  readonly disabledReason: string | null;
  readonly onAdd?: () => void;
};

function DisabledReasonTooltip(props: { reason: string; trigger: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={props.trigger} />
      <TooltipPopup side="top">{props.reason}</TooltipPopup>
    </Tooltip>
  );
}

function SurfaceMenuItem(props: {
  available: boolean;
  disabledReason?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const item = (
    <MenuItem
      className={!props.available ? "data-disabled:pointer-events-auto" : undefined}
      onClick={props.onClick}
      disabled={!props.available}
    >
      {props.children}
    </MenuItem>
  );
  if (props.available || !props.disabledReason) return item;
  return <DisabledReasonTooltip reason={props.disabledReason} trigger={item} />;
}

function RightPanelEmptyState(props: {
  onAddBrowser: () => void;
  onAddTerminal: () => void;
  onAddDiff: () => void;
  onAddHistory: () => void;
  onAddPullRequest: () => void;
  onAddFiles: () => void;
  browserAvailable: boolean;
  terminalAvailable: boolean;
  diffAvailable: boolean;
  historyAvailable: boolean;
  pullRequestAvailable: boolean;
  filesAvailable: boolean;
}) {
  const actions = [
    {
      label: "Browser",
      description: "Open a local app or URL.",
      icon: Globe2,
      available: props.browserAvailable,
      disabledReason: RIGHT_PANEL_SURFACE_UNAVAILABLE_REASONS.browser,
      onClick: props.onAddBrowser,
    },
    {
      label: "Terminal",
      description: "Start a shell in this workspace.",
      icon: TerminalSquare,
      available: props.terminalAvailable,
      disabledReason: RIGHT_PANEL_SURFACE_UNAVAILABLE_REASONS.terminal,
      onClick: props.onAddTerminal,
    },
    {
      label: "Files",
      description: "Browse and read workspace files.",
      icon: Files,
      available: props.filesAvailable,
      disabledReason: RIGHT_PANEL_SURFACE_UNAVAILABLE_REASONS.files,
      onClick: props.onAddFiles,
    },
    {
      label: "Diff",
      description: "Review changes in this thread.",
      icon: FileDiff,
      available: props.diffAvailable,
      disabledReason: RIGHT_PANEL_SURFACE_UNAVAILABLE_REASONS.diff,
      onClick: props.onAddDiff,
    },
    {
      label: "History",
      description: "Browse the repository commit graph.",
      icon: GitGraph,
      available: props.historyAvailable,
      disabledReason: RIGHT_PANEL_SURFACE_UNAVAILABLE_REASONS.history,
      onClick: props.onAddHistory,
    },
    {
      label: "Pull request",
      description: "Watch the current pull request and its checks.",
      icon: GitPullRequest,
      available: props.pullRequestAvailable,
      disabledReason: RIGHT_PANEL_SURFACE_UNAVAILABLE_REASONS.pullRequest,
      onClick: props.onAddPullRequest,
    },
  ] as const;

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="w-full max-w-xl">
        <div className="mb-5 text-center">
          <h3 className="text-sm font-medium text-foreground">Open a surface</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose what to show in the right panel.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {actions.map((action) => {
            const Icon = action.icon;
            const content = (
              <>
                <Icon className="mb-3 size-5" />
                <span className="text-sm font-medium">{action.label}</span>
                <span className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {action.description}
                </span>
              </>
            );
            if (action.available) {
              return (
                <button
                  key={action.label}
                  type="button"
                  onClick={action.onClick}
                  className="flex min-h-28 w-full flex-col items-start rounded-lg border border-border/80 bg-card p-4 text-left transition hover:border-border hover:bg-accent/60 dark:border-transparent dark:shadow-none dark:inset-ring-1 dark:inset-ring-white/5"
                >
                  {content}
                </button>
              );
            }
            const disabledCard = (
              <button
                type="button"
                className="flex min-h-28 w-full cursor-not-allowed flex-col items-start rounded-lg border border-border/80 bg-card p-4 text-left opacity-40 dark:border-transparent dark:shadow-none dark:inset-ring-1 dark:inset-ring-white/5"
                aria-disabled="true"
              >
                {content}
              </button>
            );
            return (
              <DisabledReasonTooltip
                key={action.label}
                reason={action.disabledReason}
                trigger={disabledCard}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function rightPanelSurfaceTitle(
  surface: RightPanelSurface,
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>,
  terminalLabelsById: ReadonlyMap<string, string>,
): string {
  switch (surface.kind) {
    case "diff":
      return "Diff";
    case "history":
      return "History";
    case "pullRequest":
      return "Pull request";
    case "files":
      return "Files";
    case "terminal":
      return (
        terminalLabelsById.get(surface.activeTerminalId) ??
        getTerminalLabel(surface.activeTerminalId)
      );
    case "plan":
      return "Plan";
    case "preview": {
      const snapshot = surface.resourceId ? sessions[surface.resourceId] : null;
      if (!snapshot || snapshot.navStatus._tag === "Idle") return "Browser";
      if (snapshot.navStatus.title.trim().length > 0) return snapshot.navStatus.title;
      try {
        return new URL(snapshot.navStatus.url).host || "Browser";
      } catch {
        return "Browser";
      }
    }
  }
}

function SurfaceIcon({ surface }: { surface: RightPanelSurface }) {
  switch (surface.kind) {
    case "preview":
      return <Globe2 className="size-3.5 shrink-0" />;
    case "diff":
      return <FileDiff className="size-3.5 shrink-0" />;
    case "history":
      return <GitGraph className="size-3.5 shrink-0" />;
    case "pullRequest":
      return <GitPullRequest className="size-3.5 shrink-0" />;
    case "files":
      return <Files className="size-3.5 shrink-0" />;
    case "terminal":
      return <TerminalSquare className="size-3.5 shrink-0" />;
    case "plan":
      return <ClipboardList className="size-3.5 shrink-0" />;
  }
}

/** Visible tabs keep open tools directly reachable; overflow scrolls horizontally. */
function RightPanelTabStrip(props: {
  readonly surfaces: readonly RightPanelSurface[];
  readonly activeSurfaceId: string | null;
  readonly panelId: string;
  readonly previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  readonly terminalLabelsById: ReadonlyMap<string, string>;
  readonly onActivate: (surface: RightPanelSurface) => void;
  readonly onCloseSurface: (surface: RightPanelSurface) => void;
  readonly pendingSurfaceIds: ReadonlySet<string>;
  readonly onContextMenu: (event: ReactMouseEvent, surface: RightPanelSurface) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stripRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [props.activeSurfaceId]);

  return (
    <ScrollArea
      ref={stripRef}
      hideScrollbars
      scrollFade
      className="min-w-0 flex-1 rounded-none"
      data-right-panel-tab-list
    >
      <div
        role="tablist"
        aria-label="Open panel tabs"
        className="flex h-full w-max min-w-full items-center gap-1 [-webkit-app-region:no-drag]"
      >
        {props.surfaces.map((surface, index) => {
          const active = surface.id === props.activeSurfaceId;
          const title = rightPanelSurfaceTitle(
            surface,
            props.previewSessions,
            props.terminalLabelsById,
          );
          return (
            <div
              key={surface.id}
              role="presentation"
              data-active-tab={active}
              className={cn(
                "group/panel-tab flex h-7 min-w-20 max-w-44 shrink-0 items-center gap-1 rounded-md px-2 text-xs",
                active
                  ? "bg-card text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
              onContextMenu={(event) => props.onContextMenu(event, surface)}
              onMouseDown={(event) => {
                if (shouldClosePanelItemFromAuxClick(event.button)) event.preventDefault();
              }}
              onAuxClick={(event) => {
                if (!shouldClosePanelItemFromAuxClick(event.button)) return;
                event.preventDefault();
                props.onCloseSurface(surface);
              }}
            >
              <button
                type="button"
                role="tab"
                id={`${props.panelId}-${surface.id}`}
                aria-controls={props.panelId}
                aria-selected={active}
                tabIndex={active || (props.activeSurfaceId === null && index === 0) ? 0 : -1}
                aria-label={title}
                title={title}
                className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => props.onActivate(surface)}
                onKeyDown={(event) => {
                  if (event.key === "Delete") {
                    event.preventDefault();
                    props.onCloseSurface(surface);
                    return;
                  }
                  const nextIndex =
                    event.key === "ArrowRight"
                      ? (index + 1) % props.surfaces.length
                      : event.key === "ArrowLeft"
                        ? (index - 1 + props.surfaces.length) % props.surfaces.length
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? props.surfaces.length - 1
                            : null;
                  if (nextIndex === null) return;
                  const next = props.surfaces[nextIndex];
                  if (!next) return;
                  event.preventDefault();
                  props.onActivate(next);
                  const tabs =
                    stripRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                  tabs?.[nextIndex]?.focus();
                }}
              >
                <SurfaceIcon surface={surface} />
                <span className="truncate">{title}</span>
                {props.pendingSurfaceIds.has(surface.id) ? (
                  <span aria-label="Opening" className="size-1 shrink-0 rounded-full bg-current" />
                ) : null}
              </button>
              <button
                type="button"
                aria-label={`Close ${title}`}
                className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => props.onCloseSurface(surface)}
              >
                <X aria-hidden className="size-3" />
              </button>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

export function resolveActivitySurface(input: {
  surfaces: readonly RightPanelSurface[];
  kind: RightPanelSurface["kind"];
  preferredId: string | undefined;
}) {
  return (
    input.surfaces.find(
      (surface) => surface.kind === input.kind && surface.id === input.preferredId,
    ) ?? input.surfaces.find((surface) => surface.kind === input.kind)
  );
}

export function shouldHideActivitySurface(input: {
  readonly collapsed: boolean;
  readonly surfaceId: string | undefined;
  readonly activeSurfaceId: string | null;
}): boolean {
  return (
    !input.collapsed && input.surfaceId !== undefined && input.surfaceId === input.activeSurfaceId
  );
}

export function rightPanelSelectionMemoryKey(
  context: RightPanelContext,
  kind: RightPanelSurface["kind"],
): string {
  return `${panelOwnerKey(rightPanelOwnerForKind(context, kind))}\0${kind}`;
}

export function shouldClosePanelItemFromAuxClick(button: number): boolean {
  return button === 1;
}

export function RightPanelSidebar(props: RightPanelSidebarProps) {
  const panelId = useId();
  const ownsDesktopTitleBar = isElectron && props.mode === "inline";
  const activeSurface = props.surfaces.find((surface) => surface.id === props.activeSurfaceId);
  const activeSurfaceKind = activeSurface?.kind;
  const hasSurfaceOfKind = useCallback(
    (kind: RightPanelSurface["kind"]) => props.surfaces.some((surface) => surface.kind === kind),
    [props.surfaces],
  );
  const activities: RightPanelActivity[] = [
    {
      kind: "files",
      label: "Files",
      icon: Files,
      available: props.filesAvailable || hasSurfaceOfKind("files"),
      disabledReason: props.filesAvailable ? null : RIGHT_PANEL_SURFACE_UNAVAILABLE_REASONS.files,
      onAdd: props.onAddFiles,
    },
    {
      kind: "diff",
      label: "Changes",
      icon: FileDiff,
      available: props.diffAvailable || hasSurfaceOfKind("diff"),
      disabledReason: props.diffAvailable ? null : RIGHT_PANEL_SURFACE_UNAVAILABLE_REASONS.diff,
      onAdd: props.onAddDiff,
    },
    {
      kind: "history",
      label: "History",
      icon: GitGraph,
      available: props.historyAvailable || hasSurfaceOfKind("history"),
      disabledReason: props.historyAvailable
        ? null
        : RIGHT_PANEL_SURFACE_UNAVAILABLE_REASONS.history,
      onAdd: props.onAddHistory,
    },
    {
      kind: "pullRequest",
      label: "Pull request",
      icon: GitPullRequest,
      available: props.pullRequestAvailable || hasSurfaceOfKind("pullRequest"),
      disabledReason: props.pullRequestAvailable
        ? null
        : RIGHT_PANEL_SURFACE_UNAVAILABLE_REASONS.pullRequest,
      onAdd: props.onAddPullRequest,
    },
    {
      kind: "terminal",
      label: "Terminal",
      icon: TerminalSquare,
      available: props.terminalAvailable || hasSurfaceOfKind("terminal"),
      disabledReason: props.terminalAvailable
        ? null
        : RIGHT_PANEL_SURFACE_UNAVAILABLE_REASONS.terminal,
      onAdd: props.onAddTerminal,
    },
    {
      kind: "preview",
      label: "Browser",
      icon: Globe2,
      available: props.browserAvailable || hasSurfaceOfKind("preview"),
      disabledReason: props.browserAvailable
        ? null
        : RIGHT_PANEL_SURFACE_UNAVAILABLE_REASONS.browser,
      onAdd: props.onAddBrowser,
    },
  ];
  if (hasSurfaceOfKind("plan")) {
    activities.push({
      kind: "plan",
      label: "Plan",
      icon: ClipboardList,
      available: true,
      disabledReason: null,
    });
  }

  const handleActivityClick = useCallback(
    (activity: RightPanelActivity) => {
      if (!activity.available) return;
      const surface = resolveActivitySurface({
        surfaces: props.surfaces,
        kind: activity.kind,
        preferredId: props.preferredSurfaceIdForKind(activity.kind),
      });
      if (
        shouldHideActivitySurface({
          collapsed: props.collapsed ?? false,
          surfaceId: surface?.id,
          activeSurfaceId: props.activeSurfaceId,
        })
      ) {
        props.onHide();
      } else if (surface) {
        props.onActivate(surface);
      } else {
        activity.onAdd?.();
      }
    },
    [props],
  );

  const handleSurfaceContextMenu = useCallback(
    async (event: ReactMouseEvent, surface: RightPanelSurface) => {
      event.preventDefault();
      event.stopPropagation();

      const api = readLocalApi();
      if (!api) return;

      const surfaceIndex = props.surfaces.findIndex((entry) => entry.id === surface.id);
      if (surfaceIndex < 0) return;

      const items: ContextMenuItem<PanelItemContextMenuAction>[] = [];
      if (surface.kind === "files" && surface.relativePath !== null) {
        items.push({ id: "copy-path", label: "Copy path" });
      }
      items.push(
        { id: "close", label: "Close" },
        {
          id: "close-others",
          label: "Close others",
          disabled: props.surfaces.length <= 1,
        },
        {
          id: "close-to-right",
          label: "Close to the right",
          disabled: surfaceIndex >= props.surfaces.length - 1,
        },
        {
          id: "close-all",
          label: "Close all",
          disabled: props.surfaces.length === 0,
        },
      );

      const action = await api.contextMenu.show(items, { x: event.clientX, y: event.clientY });
      switch (action) {
        case "copy-path":
          if (surface.kind === "files" && surface.relativePath !== null) {
            props.onCopyFilePath(surface.relativePath);
          }
          break;
        case "close":
          props.onCloseSurface(surface);
          break;
        case "close-others":
          props.onCloseOtherSurfaces(surface);
          break;
        case "close-to-right":
          props.onCloseSurfacesToRight(surface);
          break;
        case "close-all":
          props.onCloseAllSurfaces();
          break;
        case null:
          break;
      }
    },
    [props],
  );
  const activityRail = (
    /* One group so the first title waits, then sliding down the rail reveals the rest instantly. */
    <TooltipProvider key="right-panel-activity-rail" delay={80} closeDelay={0} timeout={600}>
      <nav
        aria-label="Right panel tools"
        className="flex h-full min-h-0 w-11 shrink-0 flex-col items-center overflow-y-auto bg-sidebar [-webkit-app-region:no-drag]"
        data-right-panel-activity-rail
      >
        {props.projectActions ? <div className="shrink-0 pb-2">{props.projectActions}</div> : null}
        {activities.map((activity) => {
          const Icon = activity.icon;
          const active = !props.collapsed && activeSurfaceKind === activity.kind;
          const tooltip = activity.available
            ? activity.label
            : `${activity.label}: ${activity.disabledReason ?? "Unavailable"}`;
          return (
            <Tooltip key={activity.kind}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={activity.label}
                    aria-pressed={active}
                    aria-disabled={!activity.available}
                    data-selected={active ? "true" : "false"}
                    className={cn(
                      "relative inline-flex size-10 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                      active && "bg-accent text-foreground",
                      !activity.available && "cursor-not-allowed opacity-40",
                    )}
                    onClick={() => handleActivityClick(activity)}
                  >
                    {active ? (
                      <span
                        aria-hidden
                        className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-foreground"
                      />
                    ) : null}
                    <Icon aria-hidden className="size-[18px]" />
                  </button>
                }
              />
              <TooltipPopup side="left">{tooltip}</TooltipPopup>
            </Tooltip>
          );
        })}
      </nav>
    </TooltipProvider>
  );
  return (
    <PreviewPanelShell
      mode={props.mode}
      {...(props.collapsed !== undefined ? { collapsed: props.collapsed } : {})}
      {...(props.maximized !== undefined ? { maximized: props.maximized } : {})}
    >
      {props.collapsed ? null : (
        <div
          className={cn(
            "workspace-topbar gap-1 bg-sidebar",
            ownsDesktopTitleBar && "drag-region",
            props.mode !== "inline" && "[--workspace-topbar-height:--spacing(11)]",
            props.mode === "inline" ? "pr-12" : "pr-2",
            ownsDesktopTitleBar && "wco:pr-[calc(var(--workspace-native-controls-inset)+3rem)]",
            props.mode === "inline" && props.maximized && COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
          )}
          data-right-panel-toolbar
        >
          <RightPanelTabStrip
            panelId={panelId}
            surfaces={props.surfaces}
            activeSurfaceId={props.activeSurfaceId}
            previewSessions={props.previewSessions}
            terminalLabelsById={props.terminalLabelsById}
            onActivate={props.onActivate}
            onCloseSurface={props.onCloseSurface}
            pendingSurfaceIds={props.pendingSurfaceIds}
            onContextMenu={(event, surface) => void handleSurfaceContextMenu(event, surface)}
          />
          <Menu>
            <MenuTrigger
              className="relative inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Open a new panel item"
            >
              <Plus className="size-4" />
            </MenuTrigger>
            <MenuPopup align="end" side="bottom" sideOffset={6} className="min-w-44">
              <SurfaceMenuItem
                available={props.browserAvailable}
                disabledReason={RIGHT_PANEL_SURFACE_UNAVAILABLE_REASONS.browser}
                onClick={props.onAddBrowser}
              >
                <Globe2 />
                Browser
              </SurfaceMenuItem>
              <SurfaceMenuItem
                available={props.terminalAvailable}
                disabledReason={RIGHT_PANEL_SURFACE_UNAVAILABLE_REASONS.terminal}
                onClick={props.onAddTerminal}
              >
                <TerminalSquare />
                Terminal
              </SurfaceMenuItem>
              <SurfaceMenuItem
                available={props.filesAvailable}
                disabledReason={RIGHT_PANEL_SURFACE_UNAVAILABLE_REASONS.files}
                onClick={props.onAddFiles}
              >
                <Files />
                Files
              </SurfaceMenuItem>
              <SurfaceMenuItem
                available={props.diffAvailable}
                disabledReason={RIGHT_PANEL_SURFACE_UNAVAILABLE_REASONS.diff}
                onClick={props.onAddDiff}
              >
                <FileDiff />
                Changes
              </SurfaceMenuItem>
              <SurfaceMenuItem
                available={props.historyAvailable}
                disabledReason={RIGHT_PANEL_SURFACE_UNAVAILABLE_REASONS.history}
                onClick={props.onAddHistory}
              >
                <GitGraph />
                History
              </SurfaceMenuItem>
              <SurfaceMenuItem
                available={props.pullRequestAvailable}
                disabledReason={RIGHT_PANEL_SURFACE_UNAVAILABLE_REASONS.pullRequest}
                onClick={props.onAddPullRequest}
              >
                <GitPullRequest />
                Pull request
              </SurfaceMenuItem>
            </MenuPopup>
          </Menu>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Hide right sidebar"
                  onClick={props.onHide}
                >
                  <PanelRightClose className="size-4" />
                </button>
              }
            />
            <TooltipPopup side="bottom">Hide right sidebar</TooltipPopup>
          </Tooltip>
        </div>
      )}
      <div
        className={cn(
          "flex min-h-0 flex-1",
          props.collapsed && "pt-[var(--workspace-topbar-height)]",
          props.collapsed && isElectron && "drag-region",
        )}
        data-right-panel-collapsed={props.collapsed ? "true" : undefined}
      >
        {props.collapsed ? null : (
          <div
            id={panelId}
            role="tabpanel"
            aria-labelledby={activeSurface ? `${panelId}-${activeSurface.id}` : undefined}
            className={cn(
              // The content surface, not the shell, carries the background: it is
              // the card that sits on the chrome, mirroring the chat column's slab.
              "flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden bg-background",
              props.mode === "inline" && "md:rounded-xl",
            )}
          >
            {props.activeSurfaceId === null ? (
              <RightPanelEmptyState
                onAddBrowser={props.onAddBrowser}
                onAddTerminal={props.onAddTerminal}
                onAddDiff={props.onAddDiff}
                onAddHistory={props.onAddHistory}
                onAddPullRequest={props.onAddPullRequest}
                onAddFiles={props.onAddFiles}
                browserAvailable={props.browserAvailable}
                terminalAvailable={props.terminalAvailable}
                diffAvailable={props.diffAvailable}
                historyAvailable={props.historyAvailable}
                pullRequestAvailable={props.pullRequestAvailable}
                filesAvailable={props.filesAvailable}
              />
            ) : (
              props.children
            )}
          </div>
        )}
        {activityRail}
      </div>
    </PreviewPanelShell>
  );
}
