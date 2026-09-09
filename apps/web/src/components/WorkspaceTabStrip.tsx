import { type ReactNode, useEffect, useRef } from "react";

import { cn } from "~/lib/utils";
import { ScrollArea } from "./ui/scroll-area";

/**
 * The workspace's tab bar: one strip, whatever the surface puts in it.
 *
 * Conversations and flow steps are different things to page through, but they
 * are the same object on screen — a scrolling row of tabs sharing the titlebar
 * with the workspace actions. Keeping the strip here means neither surface can
 * drift into its own height, padding, or overflow behaviour.
 */
export function WorkspaceTabStrip({
  label,
  activeKey,
  className,
  listClassName,
  onViewportChange,
  trailing,
  children,
  ...navProps
}: {
  readonly label: string;
  /** Changing this scrolls the tab marked `data-active-tab` back into view. */
  readonly activeKey: string | null;
  readonly className?: string;
  readonly listClassName?: string;
  /** The scroll viewport, for chrome that pages the strip from outside it. */
  readonly onViewportChange?: (viewport: HTMLElement | null) => void;
  readonly trailing?: ReactNode;
  readonly children: ReactNode;
} & Record<`data-${string}`, unknown>) {
  const stripRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (onViewportChange === undefined) return;
    onViewportChange(
      stripRef.current?.querySelector<HTMLElement>("[data-slot='scroll-area-viewport']") ?? null,
    );
    return () => onViewportChange(null);
  }, [onViewportChange]);

  // Keep the current tab visible when the strip overflows — arriving from a
  // deep link or a notification must not land on a tab off-screen.
  useEffect(() => {
    stripRef.current
      ?.querySelector<HTMLElement>("[data-active-tab='true']")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeKey]);

  return (
    <nav
      aria-label={label}
      className={cn(
        "flex h-[var(--workspace-tabbar-height)] min-w-0 items-center gap-1 py-1",
        className,
      )}
      {...navProps}
    >
      <ScrollArea ref={stripRef} hideScrollbars scrollFade className="min-w-0 flex-1 rounded-none">
        <ul className={cn("flex h-full w-max min-w-full items-center gap-1", listClassName)}>
          {children}
        </ul>
      </ScrollArea>
      {trailing}
    </nav>
  );
}

/**
 * One tab's surface. Fill alone marks the current tab — an outline on every
 * tab turns the strip into a row of boxes competing with the header's own
 * edges. A tab that cannot be opened yet rests flat and dim instead.
 */
export function WorkspaceTabShell({
  active,
  muted = false,
  className,
  children,
  ...attributes
}: {
  readonly active: boolean;
  /** Nothing to open here yet: no fill, no hover. */
  readonly muted?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
} & Record<`data-${string}`, unknown>) {
  return (
    <div
      data-active-tab={active}
      className={cn(
        "flex h-7 shrink-0 items-center gap-1 rounded-md pr-2 pl-2.5 transition-colors duration-(--duration-fast) ease-(--ease-fluid) [-webkit-app-region:no-drag]",
        active ? "bg-sidebar-row-active" : muted ? null : "hover:bg-accent",
        className,
      )}
      {...attributes}
    >
      {children}
    </div>
  );
}

/** The tab's own label row, whether it is a button or an inert step. */
export function workspaceTabContentClassName(state: "active" | "inactive" | "muted"): string {
  return cn(
    "flex h-full min-w-0 items-center gap-[7px] rounded-md text-xs",
    state === "muted"
      ? "text-muted-foreground/60"
      : cn(
          "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          state === "active" ? "font-semibold text-foreground" : "text-muted-foreground",
        ),
  );
}
