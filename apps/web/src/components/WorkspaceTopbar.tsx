import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";
import { isElectron } from "../env";

/**
 * The workspace's titlebar row: tabs on the left, workspace actions on the
 * right, sharing the native titlebar on desktop.
 *
 * Every workspace surface wears it — conversations, flow steps, and the panes
 * a flow shows while a card has no conversation to open. Keeping it in one
 * place is what stops those surfaces from drifting apart in height, drag
 * region, and the insets the traffic lights and the right panel need.
 */
export function WorkspaceTopbar({
  tabs,
  trailing,
  reserveControlInset = true,
  ownsTitleBarControls = false,
}: {
  /** The tab strip for this surface, if it has one. */
  readonly tabs?: ReactNode;
  /** Workspace actions for the right end of the row. */
  readonly trailing?: ReactNode;
  /** Leave room for the window controls on desktop. */
  readonly reserveControlInset?: boolean;
  /** The right panel already holds that corner, so the row must not inset. */
  readonly ownsTitleBarControls?: boolean;
}) {
  return (
    <header
      data-chat-header
      className={cn(
        "bg-sidebar transition-[padding-left] duration-200 ease-linear motion-reduce:transition-none",
        isElectron
          ? cn(
              "workspace-topbar drag-region relative gap-2",
              reserveControlInset &&
                !ownsTitleBarControls &&
                "wco:pr-[var(--workspace-native-controls-inset)]",
            )
          : "workspace-topbar gap-2 pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]",
        COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
      )}
    >
      <div className="min-w-0 flex-1">{tabs}</div>
      {trailing}
    </header>
  );
}

/**
 * The rounded slab the workspace's content sits on, below the topbar. The chat
 * column and a flow's card panes are the same object on the chrome.
 */
export function WorkspaceContentSlab({
  className,
  children,
}: {
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background md:rounded-xl",
        className,
      )}
    >
      {children}
    </div>
  );
}
