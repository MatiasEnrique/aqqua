import { CircleAlertIcon, CircleCheckIcon, CircleDashedIcon, ClockIcon } from "lucide-react";
import type { SidebarConversationSummaryState } from "../Sidebar.summaryState";
import type { SidebarProjectState, SidebarWorktreeStateCounts } from "../Sidebar.worktreeGroups";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export type SidebarSummaryState = SidebarConversationSummaryState | "settled";

export const SIDEBAR_STATE_PRESENTATIONS = {
  working: {
    label: "Working",
    description: "An agent session is running.",
    icon: CircleDashedIcon,
    className: "text-sky-600 dark:text-sky-400",
  },
  needsInput: {
    label: "Needs input",
    description: "Waiting for your reply or approval.",
    icon: CircleAlertIcon,
    className: "text-violet-600 dark:text-violet-300",
  },
  done: {
    label: "Done",
    description: "Completed or ready, still in the active list.",
    icon: CircleCheckIcon,
    className: "text-emerald-700 dark:text-emerald-300",
  },
  stale: {
    label: "Stale",
    description: "A draft, interrupted turn, or failed session.",
    icon: ClockIcon,
    className: "text-muted-foreground/60",
  },
  settled: {
    label: "Settled",
    description: "Stored in the shared Settled section.",
    icon: CircleCheckIcon,
    className: "text-amber-600 dark:text-amber-300",
  },
} as const;

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

function worktreeStatePresentations(counts: SidebarWorktreeStateCounts) {
  return SIDEBAR_WORKTREE_STATE_ORDER.flatMap((key) => {
    const count = counts[key];
    return count > 0 ? [{ key, ...SIDEBAR_STATE_PRESENTATIONS[key], count }] : [];
  });
}

export function SidebarWorktreeStateCounters(props: { counts: SidebarWorktreeStateCounts }) {
  const counters = worktreeStatePresentations(props.counts);
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
  const states = worktreeStatePresentations(props.counts);
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
