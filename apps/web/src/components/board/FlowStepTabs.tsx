import { FileTextIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { StatusIndicator } from "../StatusIndicator";
import { ScrollArea } from "../ui/scroll-area";
import type {
  CardSelection,
  CardTreeIconState,
  CardTreeLeaf,
  CardTreeModel,
  CardTreeStepRow,
} from "./CardDetail.logic";

const STATUS_STATE = {
  done: "done",
  working: "working",
  needsInput: "needsInput",
  failed: "failed",
  idle: "stale",
} as const satisfies Record<CardTreeIconState, Parameters<typeof StatusIndicator>[0]["state"]>;

const STATUS_LABEL = {
  done: "Done",
  working: "Working",
  needsInput: "Needs input",
  failed: "Failed",
  idle: "Not reached",
} as const satisfies Record<CardTreeIconState, string>;

/**
 * Flow detail navigation belongs where conversation tabs normally live.
 * Steps stay visible across the width; a step and its owned sub-agents and
 * artifacts use the same expandable family tray as conversation tabs.
 */
export function FlowStepTabs(props: {
  readonly model: CardTreeModel;
  readonly selection: CardSelection;
  readonly onSelect: (selection: CardSelection) => void;
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [collapsedStepIndexes, setCollapsedStepIndexes] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const activeStepIndex = props.selection.stepIndex;
  const activeLeafIsFolded =
    props.selection.kind !== "step" && collapsedStepIndexes.has(activeStepIndex);

  useEffect(() => {
    stripRef.current
      ?.querySelector<HTMLElement>("[data-active-flow-step='true']")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeLeafIsFolded, activeStepIndex]);

  return (
    <nav
      aria-label="Flow steps"
      data-flow-step-tabbar
      className="flex h-[var(--workspace-tabbar-height)] shrink-0 items-center px-2 pt-[5px] pb-1"
    >
      <ScrollArea ref={stripRef} hideScrollbars scrollFade className="min-w-0 flex-1 rounded-none">
        <ol className="flex h-full w-max min-w-full items-center gap-1">
          {props.model.steps.map((step) => (
            <FlowStepTabFamily
              key={step.stepIndex}
              step={step}
              selection={props.selection}
              onSelect={props.onSelect}
              isCollapsed={collapsedStepIndexes.has(step.stepIndex)}
              onToggleCollapsed={() =>
                setCollapsedStepIndexes((current) => {
                  const next = new Set(current);
                  if (next.has(step.stepIndex)) next.delete(step.stepIndex);
                  else next.add(step.stepIndex);
                  return next;
                })
              }
            />
          ))}
          <li
            aria-label={`Done: ${props.model.done.trailing}`}
            className={cn(
              "flex h-8 shrink-0 items-center gap-1.5 rounded-xl border px-2.5 text-xs",
              props.model.done.reached
                ? "border-input bg-card font-semibold text-foreground"
                : "border-border/60 bg-card/40 text-muted-foreground/60",
            )}
          >
            <StatusIndicator
              state={props.model.done.reached ? "done" : "stale"}
              label={props.model.done.reached ? "Done" : "Not reached"}
              size="size-1.5"
              pulse={false}
            />
            <span>Done</span>
          </li>
        </ol>
      </ScrollArea>
    </nav>
  );
}

function FlowStepTabFamily(props: {
  readonly step: CardTreeStepRow;
  readonly selection: CardSelection;
  readonly onSelect: (selection: CardSelection) => void;
  readonly isCollapsed: boolean;
  readonly onToggleCollapsed: () => void;
}) {
  const pending = props.step.state === "pending";
  const parentActive =
    !pending &&
    props.selection.kind === "step" &&
    props.selection.stepIndex === props.step.stepIndex;
  const holdsActiveLeaf =
    !pending &&
    props.selection.kind !== "step" &&
    props.selection.stepIndex === props.step.stepIndex;

  const parentShell = (
    <FlowStepTabShell
      step={props.step}
      active={parentActive}
      banded={props.step.leaves.length > 0 && !props.isCollapsed}
      onSelect={props.onSelect}
      details={
        props.step.leaves.length === 0
          ? undefined
          : {
              count: props.step.leaves.length,
              isCollapsed: props.isCollapsed,
              holdsActiveLeaf,
              onToggle: props.onToggleCollapsed,
            }
      }
    />
  );

  if (props.step.leaves.length === 0 || props.isCollapsed) {
    return <li className="shrink-0">{parentShell}</li>;
  }

  return (
    <li className="shrink-0">
      <div
        data-flow-step-family={props.step.stepIndex}
        className="flex h-8 items-center gap-px rounded-xl border border-border bg-muted p-px [-webkit-app-region:no-drag]"
      >
        {parentShell}
        {props.step.leaves.map((leaf) => (
          <FlowStepLeafTab
            key={
              leaf.kind === "subagent"
                ? `subagent:${leaf.threadId}`
                : `${leaf.kind}:${leaf.stepIndex}`
            }
            leaf={leaf}
            active={isLeafActive(leaf, props.selection)}
            onSelect={props.onSelect}
          />
        ))}
      </div>
    </li>
  );
}

function FlowStepTabShell(props: {
  readonly step: CardTreeStepRow;
  readonly active: boolean;
  readonly banded: boolean;
  readonly onSelect: (selection: CardSelection) => void;
  readonly details?:
    | {
        readonly count: number;
        readonly isCollapsed: boolean;
        readonly holdsActiveLeaf: boolean;
        readonly onToggle: () => void;
      }
    | undefined;
}) {
  const pending = props.step.state === "pending";
  return (
    <div
      data-active-flow-step={props.active}
      className={cn(
        "flex items-center border bg-card pr-1.5 pl-2.5 transition-colors duration-(--duration-fast) ease-(--ease-fluid) [-webkit-app-region:no-drag]",
        props.banded ? "h-[30px] rounded-[10px]" : "h-8 rounded-xl",
        props.active
          ? "border-input"
          : pending
            ? "border-border/60 bg-card/40"
            : "border-border hover:border-input",
      )}
    >
      {pending ? (
        <span
          aria-disabled="true"
          aria-label={`${props.step.label}: Not started`}
          className="flex h-full min-w-0 items-center gap-[7px] text-muted-foreground/60 text-xs"
        >
          <StatusIndicator state="stale" label="Not started" size="size-1.5" pulse={false} />
          <span className="max-w-44 truncate">{props.step.label}</span>
        </span>
      ) : (
        <button
          type="button"
          aria-current={props.active ? "step" : undefined}
          onClick={() => props.onSelect({ kind: "step", stepIndex: props.step.stepIndex })}
          className={cn(
            "flex h-full min-w-0 cursor-pointer items-center gap-[7px] rounded-md text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            props.active ? "font-semibold text-foreground" : "text-muted-foreground",
          )}
        >
          <StatusIndicator
            state={STATUS_STATE[props.step.status]}
            label={STATUS_LABEL[props.step.status]}
            size="size-1.5"
          />
          <span className="max-w-44 truncate">{props.step.label}</span>
        </button>
      )}
      {props.details === undefined ? null : (
        <FlowStepDetailCountChip stepName={props.step.name} {...props.details} />
      )}
    </div>
  );
}

function FlowStepDetailCountChip(props: {
  readonly stepName: string;
  readonly count: number;
  readonly isCollapsed: boolean;
  readonly holdsActiveLeaf: boolean;
  readonly onToggle: () => void;
}) {
  const detailsLabel = props.count === 1 ? "1 detail" : `${props.count} details`;
  const action = props.isCollapsed ? "Show" : "Hide";
  return (
    <button
      type="button"
      aria-expanded={!props.isCollapsed}
      aria-label={`${action} ${detailsLabel} of ${props.stepName}`}
      data-flow-step-count
      data-active-flow-step={props.holdsActiveLeaf ? true : undefined}
      onClick={props.onToggle}
      className={cn(
        "ml-1 inline-flex h-[17px] shrink-0 cursor-pointer items-center gap-[3px] rounded-full px-1.5 text-[10.5px] font-semibold tabular-nums outline-none transition-colors duration-(--duration-fast) ease-(--ease-fluid) focus-visible:ring-2 focus-visible:ring-ring",
        props.holdsActiveLeaf
          ? "bg-foreground text-background"
          : props.isCollapsed
            ? "bg-accent text-foreground"
            : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <FlowStepDetailCountIcon />
      {props.count}
    </button>
  );
}

function FlowStepDetailCountIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="size-[9px] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
    >
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
    </svg>
  );
}

function isLeafActive(leaf: CardTreeLeaf, selection: CardSelection): boolean {
  if (selection.stepIndex !== leaf.stepIndex || selection.kind === "step") return false;
  return leaf.kind === "subagent"
    ? selection.kind === "subagent" && selection.threadId === leaf.threadId
    : selection.kind === "artifact";
}

function FlowStepLeafTab(props: {
  readonly leaf: CardTreeLeaf;
  readonly active: boolean;
  readonly onSelect: (selection: CardSelection) => void;
}) {
  const { leaf } = props;
  const label = leaf.kind === "subagent" ? leaf.title : leaf.fileName;
  const trailing = leaf.kind === "subagent" ? leaf.elapsed : leaf.trailing;
  return (
    <button
      type="button"
      data-flow-step-leaf
      data-active-flow-step={props.active}
      aria-current={props.active ? "step" : undefined}
      onClick={() =>
        props.onSelect(
          leaf.kind === "subagent"
            ? { kind: "subagent", stepIndex: leaf.stepIndex, threadId: leaf.threadId }
            : { kind: "artifact", stepIndex: leaf.stepIndex },
        )
      }
      className={cn(
        "flex h-[30px] min-w-0 cursor-pointer items-center gap-1.5 rounded-[10px] border pr-2 pl-1.5 text-[11px] outline-none transition-colors duration-(--duration-fast) ease-(--ease-fluid) focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        props.active
          ? "border-input bg-card font-medium text-foreground"
          : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
      )}
    >
      <FlowStepLeafElbowIcon />
      {leaf.kind === "subagent" ? (
        <StatusIndicator
          state={STATUS_STATE[leaf.status]}
          label={STATUS_LABEL[leaf.status]}
          size="size-[5px]"
        />
      ) : (
        <FileTextIcon aria-hidden className="size-2.5 shrink-0 text-muted-foreground/70" />
      )}
      <span className="max-w-32 truncate">{label}</span>
      {trailing === null ? null : (
        <span className="shrink-0 text-[10px] text-muted-foreground/70 tabular-nums">
          {trailing}
        </span>
      )}
    </button>
  );
}

function FlowStepLeafElbowIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="size-2.5 shrink-0 text-muted-foreground/50"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
    >
      <path d="M6 4v9a4 4 0 0 0 4 4h8" />
    </svg>
  );
}
