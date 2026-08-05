import type { CSSProperties, ReactNode } from "react";
import { cn } from "~/lib/utils";

/**
 * Interaction state that drives a row's surface, independent of what the row
 * shows. Every sidebar row — conversation, sub-agent, settled tail, flow card —
 * shares one surface model: status lives in the row content, and the surface is
 * reserved for interaction (hover, multi-select, route).
 */
export interface SidebarCardSurfaceState {
  readonly isActive: boolean;
  readonly isSelected: boolean;
  /** Quiet work that rests below the rows actually asking for a human. */
  readonly recede: boolean;
  /** Working, or waiting on approval/input: faded whole until hovered. */
  readonly inFlight: boolean;
}

/**
 * The surface classes, as a function so a row can hand them to whatever element
 * it makes interactive — some rows put the handlers on the surface itself,
 * others (the settled row, which owns a selection checkbox outside the button)
 * need the surface on a wrapper.
 */
export function sidebarCardSurfaceClassName(state: SidebarCardSurfaceState): string {
  return cn(
    "group/v2-row relative w-full cursor-pointer overflow-hidden rounded-md text-left outline-none select-none",
    state.isActive
      ? "bg-sidebar-row-active text-sidebar-foreground"
      : state.isSelected
        ? "bg-sidebar-row-selected text-sidebar-foreground"
        : state.recede
          ? "text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
          : "bg-transparent text-sidebar-foreground hover:bg-sidebar-row-hover",
    state.inFlight &&
      !state.isActive &&
      !state.isSelected &&
      "opacity-70 transition-opacity hover:opacity-100",
  );
}

/**
 * Reserved intrinsic heights, so `content-visibility: auto` can skip offscreen
 * rows without the scrollbar jumping when they paint. Arbitrary Tailwind values
 * have to be static strings, hence the map rather than a number prop.
 */
const INTRINSIC_SIZE = {
  card: "[content-visibility:auto] [contain-intrinsic-size:auto_52px]",
  slim: "[content-visibility:auto] [contain-intrinsic-size:auto_34px]",
  /** Nested rows opt out: their guides paint outside the row box. */
  none: "",
} as const;

/** The list item every sidebar row sits in. */
export function SidebarCardItem(props: {
  readonly size?: keyof typeof INTRINSIC_SIZE;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <li
      data-thread-item
      className={cn("list-none", INTRINSIC_SIZE[props.size ?? "card"], props.className)}
    >
      {props.children}
    </li>
  );
}

/** The single horizontal line a compact row lays out on. */
export function SidebarCardLine(props: {
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly children: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 items-center", props.className)} style={props.style}>
      {props.children}
    </div>
  );
}

/**
 * The trailing cluster: branch, provider, time, counts, status, actions. Pushed
 * right and never allowed to shrink, so the description is what gives way when
 * the sidebar narrows.
 */
export function SidebarCardMeta(props: {
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "ml-auto flex min-w-0 shrink-0 items-center gap-2.5 text-[11px] leading-none",
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}
