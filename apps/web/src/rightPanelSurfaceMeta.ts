import {
  ClipboardList,
  FileDiff,
  Files,
  GitGraph,
  GitPullRequest,
  Globe2,
  TerminalSquare,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { RightPanelSurface } from "~/rightPanelStore";

/**
 * Single source of truth for how a right panel surface is named and drawn, so the
 * activity rail, the tab strip, the new-item menu and each panel header can never
 * drift apart.
 */
export const RIGHT_PANEL_SURFACE_META: Readonly<
  Record<RightPanelSurface["kind"], { readonly label: string; readonly icon: LucideIcon }>
> = {
  files: { label: "Files", icon: Files },
  diff: { label: "Changes", icon: FileDiff },
  history: { label: "History", icon: GitGraph },
  pullRequest: { label: "Pull request", icon: GitPullRequest },
  terminal: { label: "Terminal", icon: TerminalSquare },
  preview: { label: "Browser", icon: Globe2 },
  plan: { label: "Plan", icon: ClipboardList },
};
