import { FileTextIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

import { cn } from "~/lib/utils";
import { StatusIndicator } from "../StatusIndicator";
import { TabFamilyCountTrigger, TabFamilyPopover } from "../TabFamilyPopover";
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
 * Steps stay visible across the width; each step's sub-agents and artifacts
 * live in the same compact descendant picker used by conversation tabs.
 */
export function FlowStepTabs(props: {
  readonly model: CardTreeModel;
  readonly selection: CardSelection;
  readonly onSelect: (selection: CardSelection) => void;
  readonly actions?: ReactNode;
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const activeStepIndex = props.selection.stepIndex;

  useEffect(() => {
    stripRef.current
      ?.querySelector<HTMLElement>("[data-active-flow-step='true']")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeStepIndex]);

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
      {props.actions}
    </nav>
  );
}

function FlowStepTabFamily(props: {
  readonly step: CardTreeStepRow;
  readonly selection: CardSelection;
  readonly onSelect: (selection: CardSelection) => void;
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
      selection={props.selection}
      onSelect={props.onSelect}
      details={
        props.step.leaves.length === 0
          ? undefined
          : {
              count: props.step.leaves.length,
              holdsActiveLeaf,
              leaves: props.step.leaves,
            }
      }
    />
  );

  return <li className="shrink-0">{parentShell}</li>;
}

function FlowStepTabShell(props: {
  readonly step: CardTreeStepRow;
  readonly active: boolean;
  readonly selection: CardSelection;
  readonly onSelect: (selection: CardSelection) => void;
  readonly details?:
    | {
        readonly count: number;
        readonly holdsActiveLeaf: boolean;
        readonly leaves: readonly CardTreeLeaf[];
      }
    | undefined;
}) {
  const pending = props.step.state === "pending";
  return (
    <div
      data-active-flow-step={props.active}
      className={cn(
        "flex items-center border bg-card pr-1.5 pl-2.5 transition-colors duration-(--duration-fast) ease-(--ease-fluid) [-webkit-app-region:no-drag]",
        "h-8 rounded-xl",
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
        <FlowStepDetailCountChip
          stepName={props.step.name}
          selection={props.selection}
          onSelect={props.onSelect}
          {...props.details}
        />
      )}
    </div>
  );
}

function FlowStepDetailCountChip(props: {
  readonly stepName: string;
  readonly count: number;
  readonly holdsActiveLeaf: boolean;
  readonly leaves: readonly CardTreeLeaf[];
  readonly selection: CardSelection;
  readonly onSelect: (selection: CardSelection) => void;
}) {
  const detailsLabel = props.count === 1 ? "1 detail" : `${props.count} details`;
  const activeLeaf = props.leaves.find((leaf) => isLeafActive(leaf, props.selection));
  const activeLeafLabel = activeLeaf === undefined ? null : leafLabel(activeLeaf);
  return (
    <TabFamilyPopover
      title={`${props.stepName} details`}
      trigger={
        <TabFamilyCountTrigger
          label={
            activeLeafLabel === null
              ? `Open ${detailsLabel} of ${props.stepName}`
              : `Open ${detailsLabel} of ${props.stepName}, current ${activeLeafLabel}`
          }
          count={props.count}
          active={props.holdsActiveLeaf}
          markerAttributes={{
            "data-flow-step-count": true,
            "data-active-flow-step": props.holdsActiveLeaf ? true : undefined,
          }}
          leadingMargin
        />
      }
      items={props.leaves.map((leaf) => ({
        key: leafKey(leaf),
        label: leafLabel(leaf),
        leading:
          leaf.kind === "subagent" ? (
            <StatusIndicator
              state={STATUS_STATE[leaf.status]}
              label={STATUS_LABEL[leaf.status]}
              size="size-1.5"
            />
          ) : (
            <FileTextIcon aria-hidden className="size-3 shrink-0 text-muted-foreground/70" />
          ),
        trailing: leaf.kind === "subagent" ? leaf.elapsed : leaf.trailing,
        active: isLeafActive(leaf, props.selection),
        onSelect: () => props.onSelect(selectionForLeaf(leaf)),
      }))}
    />
  );
}

function isLeafActive(leaf: CardTreeLeaf, selection: CardSelection): boolean {
  if (selection.stepIndex !== leaf.stepIndex || selection.kind === "step") return false;
  return leaf.kind === "subagent"
    ? selection.kind === "subagent" && selection.threadId === leaf.threadId
    : selection.kind === "artifact";
}

function leafKey(leaf: CardTreeLeaf): string {
  return leaf.kind === "subagent" ? `subagent:${leaf.threadId}` : `${leaf.kind}:${leaf.stepIndex}`;
}

function leafLabel(leaf: CardTreeLeaf): string {
  return leaf.kind === "subagent" ? leaf.title : leaf.fileName;
}

function selectionForLeaf(leaf: CardTreeLeaf): CardSelection {
  return leaf.kind === "subagent"
    ? { kind: "subagent", stepIndex: leaf.stepIndex, threadId: leaf.threadId }
    : { kind: "artifact", stepIndex: leaf.stepIndex };
}
