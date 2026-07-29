import {
  FileDiffIcon,
  FolderTreeIcon,
  GlobeIcon,
  Maximize2Icon,
  Minimize2Icon,
  PanelBottomIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { memo } from "react";

import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface PanelLayoutControlsProps {
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalShortcutLabel: string | null;
  onToggleTerminal: () => void;
}

export const PanelLayoutControls = memo(function PanelLayoutControls({
  terminalAvailable,
  terminalOpen,
  terminalShortcutLabel,
  onToggleTerminal,
}: PanelLayoutControlsProps) {
  return (
    <div
      className="flex h-full shrink-0 items-center gap-1 [-webkit-app-region:no-drag]"
      data-panel-layout-controls
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              className="shrink-0 [-webkit-app-region:no-drag]"
              pressed={terminalOpen}
              onPressedChange={onToggleTerminal}
              aria-label="Toggle terminal drawer"
              variant="ghost"
              size="sm"
              disabled={!terminalAvailable}
            >
              <PanelBottomIcon className="size-3.5" />
            </Toggle>
          }
        />
        <TooltipPopup side="bottom">
          {terminalAvailable
            ? `Toggle terminal drawer${terminalShortcutLabel ? ` (${terminalShortcutLabel})` : ""}`
            : "Terminal drawer is unavailable"}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
});

/**
 * The four right-panel surfaces reachable straight from the chat header. These
 * replaced the generic "toggle right panel" button: users pick the surface they
 * want instead of opening the panel and then hunting for it.
 */
export type RightPanelSurfaceButtonKind = "files" | "diff" | "terminal" | "browser";

/**
 * Maps a right-panel surface kind onto the header button that represents it.
 * Returns null for surfaces with no header button (today: `plan`).
 */
export function rightPanelSurfaceButtonKindOf(
  surfaceKind: string | null,
): RightPanelSurfaceButtonKind | null {
  switch (surfaceKind) {
    case "files":
    case "file":
      return "files";
    case "diff":
      return "diff";
    case "terminal":
      return "terminal";
    case "preview":
      return "browser";
    default:
      return null;
  }
}

const RIGHT_PANEL_SURFACE_BUTTONS = [
  {
    kind: "files",
    label: "Open file explorer",
    icon: FolderTreeIcon,
    unavailableReason: "Files are only available when a project is open.",
  },
  {
    kind: "diff",
    label: "Open diff viewer",
    icon: FileDiffIcon,
    unavailableReason: "Diff is only available for server threads in Git repositories.",
  },
  {
    kind: "terminal",
    label: "Open terminal",
    icon: SquareTerminalIcon,
    unavailableReason: "Terminals are only available when a project is open.",
  },
  {
    kind: "browser",
    label: "Open browser",
    icon: GlobeIcon,
    unavailableReason: "Browser previews are only available in the T3 Code desktop app.",
  },
] as const satisfies ReadonlyArray<{
  kind: RightPanelSurfaceButtonKind;
  label: string;
  icon: typeof FolderTreeIcon;
  unavailableReason: string;
}>;

interface RightPanelSurfaceControlsProps {
  /** Surface currently shown by the right panel, or null when it is closed. */
  activeSurface: RightPanelSurfaceButtonKind | null;
  availability: Readonly<Record<RightPanelSurfaceButtonKind, boolean>>;
  onOpenSurface: (kind: RightPanelSurfaceButtonKind) => void;
  onCloseSurface: () => void;
}

export const RightPanelSurfaceControls = memo(function RightPanelSurfaceControls({
  activeSurface,
  availability,
  onOpenSurface,
  onCloseSurface,
}: RightPanelSurfaceControlsProps) {
  return (
    <div
      className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]"
      data-right-panel-surface-controls
    >
      {RIGHT_PANEL_SURFACE_BUTTONS.map(({ kind, label, icon: Icon, unavailableReason }) => {
        const available = availability[kind];
        const active = available && activeSurface === kind;
        return (
          <Tooltip key={kind}>
            <TooltipTrigger
              render={
                <Toggle
                  className="shrink-0 [-webkit-app-region:no-drag]"
                  pressed={active}
                  // Clicking the surface you are already looking at closes the
                  // panel, so each icon behaves like a per-surface toggle.
                  onPressedChange={() => {
                    if (active) {
                      onCloseSurface();
                    } else {
                      onOpenSurface(kind);
                    }
                  }}
                  aria-label={label}
                  variant="ghost"
                  size="sm"
                  disabled={!available}
                >
                  <Icon className="size-3.5" />
                </Toggle>
              }
            />
            <TooltipPopup side="bottom">{available ? label : unavailableReason}</TooltipPopup>
          </Tooltip>
        );
      })}
    </div>
  );
});

export const RightPanelMaximizeControl = memo(function RightPanelMaximizeControl({
  maximized,
  onToggle,
}: {
  maximized: boolean;
  onToggle: () => void;
}) {
  const label = maximized ? "Restore panel size" : "Maximize panel";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className="shrink-0 [-webkit-app-region:no-drag]"
            pressed={maximized}
            onPressedChange={onToggle}
            aria-label={label}
            variant="ghost"
            size="sm"
          >
            {maximized ? (
              <Minimize2Icon className="size-3.5" />
            ) : (
              <Maximize2Icon className="size-3.5" />
            )}
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
});
