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
  /**
   * Where this row sits in its family's panel, or "none" for the flat rows —
   * compact, settled, snoozed — that never join one.
   */
  readonly band?: SidebarCardBand;
}

/**
 * A conversation and its sub-agents share one panel, the composer's. Rows render
 * as siblings in a flat list rather than nested, so that panel is assembled from
 * partial borders: the head opens it, the tail closes it, and the middles only
 * carry sides.
 */
export type SidebarCardBand = "none" | "single" | "head" | "middle" | "tail";

/** The edges and corners each position in a family panel paints. */
const BAND_EDGES: Record<Exclude<SidebarCardBand, "none">, string> = {
  single: "rounded-2xl border",
  head: "rounded-t-2xl border border-b-0",
  middle: "border-x",
  tail: "rounded-b-2xl border border-t-0",
} as const;

/**
 * The surface classes, as a function so a row can hand them to whatever element
 * it makes interactive — some rows put the handlers on the surface itself,
 * others (the settled row, which owns a selection checkbox outside the button)
 * need the surface on a wrapper.
 */
export function sidebarCardSurfaceClassName(state: SidebarCardSurfaceState): string {
  const band = state.band ?? "none";
  return cn(
    "group/v2-row relative w-full cursor-pointer overflow-hidden text-left outline-none select-none",
    band === "none"
      ? cn(
          "rounded-md",
          state.isActive
            ? "bg-sidebar-row-active text-sidebar-foreground"
            : state.isSelected
              ? "bg-sidebar-row-selected text-sidebar-foreground"
              : state.recede
                ? "text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                : "bg-transparent text-sidebar-foreground hover:bg-sidebar-row-hover",
        )
      : cn(
          // A panel rests lifted, so state climbs the border as well as the
          // fill: on this floor a fill-only step reads as no step at all.
          BAND_EDGES[band],
          state.isActive
            ? "border-sidebar-card-border-active bg-sidebar-card-surface-active text-sidebar-foreground"
            : state.isSelected
              ? "border-sidebar-card-border-selected bg-sidebar-card-surface-hover text-sidebar-foreground"
              : state.recede
                ? "border-sidebar-card-border bg-sidebar-card-surface text-sidebar-muted-foreground/75 hover:border-sidebar-card-border-hover hover:bg-sidebar-card-surface-hover hover:text-sidebar-foreground"
                : "border-sidebar-card-border bg-sidebar-card-surface text-sidebar-foreground hover:border-sidebar-card-border-hover hover:bg-sidebar-card-surface-hover",
        ),
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
  /**
   * Nested rows inside a family panel. Their guides used to paint outside the
   * row box, which is why they skipped this; the panel now contains them, so
   * offscreen sub-agents can be skipped like every other row.
   */
  sub: "[content-visibility:auto] [contain-intrinsic-size:auto_32px]",
  none: "",
} as const;

/** The list item every sidebar row sits in. */
export function SidebarCardItem(props: {
  readonly size?: keyof typeof INTRINSIC_SIZE;
  readonly band?: SidebarCardBand;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const band = props.band ?? "none";
  return (
    <li
      data-thread-item
      className={cn(
        "list-none",
        INTRINSIC_SIZE[props.size ?? "card"],
        // The list spaces rows by `gap-1.5`. Inside a family that gap would
        // show the sidebar through the panel, so rows that continue downward
        // pull the next one flush against them. Keep this in step with the
        // list's gap or the band splits open.
        (band === "head" || band === "middle") && "-mb-1.5",
        props.className,
      )}
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
