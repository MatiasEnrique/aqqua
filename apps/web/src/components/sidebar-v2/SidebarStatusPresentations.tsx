import type {
  SidebarConversationStateCounts,
  SidebarConversationSummaryState,
} from "../Sidebar.summaryState";
import type {
  SidebarProjectState,
  SidebarWorktreeStateCounts,
  SidebarWorktreeSummaryState,
} from "../Sidebar.worktreeGroups";
import { cn } from "~/lib/utils";
import { CONVERSATION_STATE_PRESENTATIONS } from "../conversationStatePresentation";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export type SidebarSummaryState = SidebarConversationSummaryState | "settled";

/**
 * Every state with a presentation, including `failed` — which is not a
 * `SidebarSummaryState` but is what a worktree card and a header tab report.
 */
export type SidebarStatePresentationKey = keyof typeof SIDEBAR_STATE_PRESENTATIONS;

export const SIDEBAR_STATE_PRESENTATIONS = {
  working: CONVERSATION_STATE_PRESENTATIONS.working,
  needsInput: CONVERSATION_STATE_PRESENTATIONS.needsInput,
  done: CONVERSATION_STATE_PRESENTATIONS.done,
  failed: CONVERSATION_STATE_PRESENTATIONS.failed,
  stale: CONVERSATION_STATE_PRESENTATIONS.stale,
  settled: CONVERSATION_STATE_PRESENTATIONS.settled,
} as const;

/**
 * The states that are still in motion, and so pulse.
 *
 * Matches the icon convention the rest of the app already uses — working and
 * needsInput breathe, everything at rest holds still. A pulse means "this is
 * not the final answer", which is exactly wrong for done, failed and settled.
 */
const PULSING_SIDEBAR_STATES: ReadonlySet<string> = new Set(["working", "needsInput"]);

/**
 * The state dot, shared by the worktree registry and the header tab strip so
 * one glyph can't mean two things.
 *
 * `animate-status-pulse` rather than `animate-pulse`: its keyframes step the
 * opacity instead of interpolating it, so a sidebar full of working
 * conversations doesn't repaint every frame on a 120Hz display. Sizes are
 * passed in — the registry dot is a hair larger than the tab's.
 */
export function conversationStateDotClassName(input: {
  /** A presentation key, so a misspelt state fails to compile rather than
      silently losing its pulse. */
  readonly state: SidebarStatePresentationKey;
  readonly size: string;
}): string {
  return cn(
    "shrink-0 rounded-full bg-current",
    input.size,
    PULSING_SIDEBAR_STATES.has(input.state) && "animate-status-pulse motion-reduce:animate-none",
  );
}

/**
 * A worktree's one state: a dot and a micro-label, no count.
 *
 * Deliberately not `SidebarSummaryStateLabel` — that one leads with the state
 * icon at row scale. On a 32px registry row the dot is the whole signal and the
 * word is the caption, so the label is set as small caps rather than body text.
 */
export function SidebarWorktreeSummaryStateLabel(props: {
  state: SidebarWorktreeSummaryState;
  className?: string;
}) {
  const presentation = SIDEBAR_STATE_PRESENTATIONS[props.state];

  return (
    <span
      role="status"
      aria-label={`Worktree status: ${presentation.label}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1",
        presentation.className,
        props.className,
      )}
    >
      <span
        aria-hidden
        className={conversationStateDotClassName({ state: props.state, size: "size-[7px]" })}
      />
      <span aria-hidden className="text-[8px] leading-[10px] font-semibold tracking-wide uppercase">
        {presentation.label}
      </span>
    </span>
  );
}

export function SidebarProjectStateIndicator(props: { state: SidebarProjectState }) {
  const presentation =
    props.state === "idle"
      ? { ...SIDEBAR_STATE_PRESENTATIONS.stale, label: "Idle" }
      : SIDEBAR_STATE_PRESENTATIONS[props.state];
  const Icon = presentation.icon;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="status"
            aria-label={`Project status: ${presentation.label}`}
            className={cn(
              "inline-flex size-4 shrink-0 items-center justify-center",
              presentation.className,
            )}
          />
        }
      >
        <Icon aria-hidden className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="right">{presentation.label}</TooltipPopup>
    </Tooltip>
  );
}

export function SidebarSummaryStateLabel(props: {
  state: SidebarSummaryState;
  className?: string;
}) {
  const presentation = SIDEBAR_STATE_PRESENTATIONS[props.state];
  const Icon = presentation.icon;

  return (
    <span
      className={cn(
        "inline-flex h-4 shrink-0 items-center gap-1 font-medium leading-none",
        presentation.className,
        props.className,
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span role="status" className="leading-none">
        {presentation.label}
      </span>
    </span>
  );
}

const SIDEBAR_WORKTREE_STATE_ORDER = ["working", "needsInput", "done", "stale", "settled"] as const;

function statePresentations(counts: SidebarConversationStateCounts) {
  return SIDEBAR_WORKTREE_STATE_ORDER.flatMap((key) => {
    const count = counts[key];
    return count > 0 ? [{ key, ...SIDEBAR_STATE_PRESENTATIONS[key], count }] : [];
  });
}

export function SidebarStateCounters(props: { counts: SidebarConversationStateCounts }) {
  const counters = statePresentations(props.counts);
  const summary = counters
    .map(
      (counter) =>
        `${counter.count} ${counter.label.toLowerCase()} conversation${counter.count === 1 ? "" : "s"}`,
    )
    .join(", ");

  if (counters.length === 0) return null;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="status"
            aria-label={summary}
            className="inline-flex h-4 shrink-0 items-center gap-1.5 leading-none tabular-nums"
          />
        }
      >
        {counters.map((counter) => {
          const Icon = counter.icon;
          return (
            <span
              key={counter.key}
              aria-hidden
              className={cn("inline-flex items-center gap-0.5 font-medium", counter.className)}
            >
              <Icon className="size-3.5 shrink-0" />
              <span>{counter.count}</span>
            </span>
          );
        })}
      </TooltipTrigger>
      <TooltipPopup side="right" align="start" className="w-72 text-left">
        <SidebarWorktreeStateDetails counts={props.counts} />
      </TooltipPopup>
    </Tooltip>
  );
}

export function SidebarWorktreeStateDetails(props: { counts: SidebarWorktreeStateCounts }) {
  const states = statePresentations(props.counts);
  return (
    <div className="grid gap-1 p-1">
      {states.map((state) => {
        const Icon = state.icon;
        return (
          <div
            key={state.key}
            className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-1.5 py-1.5"
          >
            <span
              className={cn(
                "inline-flex size-7 items-center justify-center rounded-md bg-foreground/[0.04]",
                state.className,
              )}
            >
              <Icon aria-hidden className="size-3.5" />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-medium text-foreground">{state.label}</span>
              <span className="block text-[11px] leading-4 text-muted-foreground text-pretty">
                {state.description}
              </span>
            </span>
            <span
              className={cn(
                "self-start pt-0.5 text-xs font-semibold tabular-nums",
                state.className,
              )}
            >
              {state.count}
            </span>
          </div>
        );
      })}
    </div>
  );
}
