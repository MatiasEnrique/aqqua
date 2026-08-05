import { ChevronDownIcon, ChevronRightIcon, NetworkIcon } from "lucide-react";
import type { MouseEvent } from "react";
import { cn } from "~/lib/utils";
import type { SidebarConversationStateCounts } from "../../Sidebar.summaryState";
import { SUB_AGENT_INDENT_PX } from "../../sidebar-v2/constants";
import { SidebarStateCounters } from "../../sidebar-v2/SidebarStatusPresentations";

/**
 * The count chip an orchestrator card owns: how many sub-agents it spawned, and
 * the control that reveals them. Expanding is deliberately not what clicking
 * the row does — navigating into an orchestrator would otherwise reshuffle the
 * list under the pointer.
 */
export function SidebarCardSubThreadToggle(props: {
  readonly count: number;
  readonly isExpanded: boolean;
  readonly description: string;
  readonly onToggle: (event: MouseEvent) => void;
  readonly testId?: string;
}) {
  if (props.count <= 0) return null;
  return (
    <button
      type="button"
      data-thread-selection-safe
      {...(props.testId === undefined ? {} : { "data-testid": props.testId })}
      aria-expanded={props.isExpanded}
      aria-label={
        props.isExpanded
          ? `Collapse sub-agents of ${props.description}`
          : `Expand sub-agents of ${props.description}`
      }
      onClick={props.onToggle}
      className="-ml-0.5 inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-sm px-1 text-[11px] font-medium tabular-nums text-muted-foreground/85 transition-colors hover:bg-foreground/8 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <NetworkIcon aria-hidden className="size-3" />
      {props.count}
      <ChevronDownIcon
        aria-hidden
        className={cn("size-3 transition-transform", !props.isExpanded && "-rotate-90")}
      />
    </button>
  );
}

/**
 * The gutter chevron a nested orchestrator owns. Nested rows have no room for
 * the count chip, and the column is shared, so this is a plain disclosure.
 */
export function SidebarCardSubThreadChevron(props: {
  readonly count: number;
  readonly isExpanded: boolean;
  readonly description: string;
  readonly onToggle: (event: MouseEvent) => void;
}) {
  if (props.count <= 0) return null;
  return (
    <button
      type="button"
      data-thread-selection-safe
      aria-expanded={props.isExpanded}
      aria-label={
        props.isExpanded
          ? `Collapse sub-agents of ${props.description}`
          : `Expand sub-agents of ${props.description}`
      }
      onClick={props.onToggle}
      className="inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {props.isExpanded ? (
        <ChevronDownIcon className="size-3" />
      ) : (
        <ChevronRightIcon className="size-3" />
      )}
    </button>
  );
}

/** The empty column a row reserves so siblings keep one left edge. */
export function SidebarCardSubThreadGutter() {
  return <span aria-hidden className="size-4 shrink-0" />;
}

/**
 * What the fan-out below a card is doing, tallied by state. This never includes
 * the orchestrator itself: its own status renders beside these, and folding it
 * in would make a card that is done read as one more sub-agent in the Done
 * count.
 */
export function SidebarCardSubThreadCounts(props: {
  readonly counts: SidebarConversationStateCounts | null;
}) {
  if (props.counts === null) return null;
  // Unlike the timestamp, this survives a narrow sidebar: it is the only thing
  // saying what the collapsed fan-out below the card is doing.
  return (
    <span className="shrink-0">
      <SidebarStateCounters counts={props.counts} />
    </span>
  );
}

/**
 * One guide per ancestor level, descending from the orchestrator's left content
 * edge. It runs the full height of its row: the family panel now holds every
 * row flush, so there is no list gap left to bridge and nothing to bleed into.
 */
export function SidebarCardSubThreadGuides(props: { readonly depth: number }) {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-y-0 left-2.5 z-10 flex">
      {Array.from({ length: props.depth }, (_, level) => (
        <span
          key={level}
          // Riding a lifted panel rather than the transparent sidebar, the rail
          // needs its own value — the row border at 70% disappears here.
          className="border-l border-sidebar-card-guide"
          style={{ width: SUB_AGENT_INDENT_PX }}
        />
      ))}
    </span>
  );
}
