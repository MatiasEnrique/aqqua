import { ChevronDownIcon, FileDiffIcon, FileTextIcon, MessageSquareIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { cn } from "~/lib/utils";
import { StatusIndicator } from "../StatusIndicator";
import { ScrollArea } from "../ui/scroll-area";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
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

function selectedLeafLabel(step: CardTreeStepRow, selection: CardSelection): string | null {
  if (selection.stepIndex !== step.stepIndex || selection.kind === "step") return null;
  if (selection.kind === "subagent") {
    const subagent = step.leaves.find(
      (leaf): leaf is Extract<CardTreeLeaf, { kind: "subagent" }> =>
        leaf.kind === "subagent" && leaf.threadId === selection.threadId,
    );
    return subagent?.title ?? "Sub-agent";
  }
  return step.leaves.find((leaf) => leaf.kind === "artifact")?.fileName ?? `${step.name} artifact`;
}

/**
 * Flow detail navigation belongs where conversation tabs normally live.
 * Steps stay visible across the width; each step's menu exposes its owned
 * sub-agents, diff, and artifact without dedicating a second sidebar to them.
 */
export function FlowStepTabs(props: {
  readonly model: CardTreeModel;
  readonly selection: CardSelection;
  readonly onSelect: (selection: CardSelection) => void;
  readonly onOpenDiff: (leaf: Extract<CardTreeLeaf, { kind: "diff" }>) => void;
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
            <FlowStepTab
              key={step.stepIndex}
              step={step}
              selection={props.selection}
              onSelect={props.onSelect}
              onOpenDiff={props.onOpenDiff}
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

function FlowStepTab(props: {
  readonly step: CardTreeStepRow;
  readonly selection: CardSelection;
  readonly onSelect: (selection: CardSelection) => void;
  readonly onOpenDiff: (leaf: Extract<CardTreeLeaf, { kind: "diff" }>) => void;
}) {
  const active = props.selection.stepIndex === props.step.stepIndex;
  const leafLabel = selectedLeafLabel(props.step, props.selection);

  return (
    <li className="shrink-0">
      <div
        data-active-flow-step={active}
        className={cn(
          "flex h-8 items-center rounded-xl border bg-card transition-colors duration-(--duration-fast) ease-(--ease-fluid) [-webkit-app-region:no-drag]",
          active ? "border-input" : "border-border hover:border-input",
        )}
      >
        <button
          type="button"
          aria-current={active ? "step" : undefined}
          onClick={() => props.onSelect({ kind: "step", stepIndex: props.step.stepIndex })}
          className={cn(
            "flex h-full min-w-0 cursor-pointer items-center gap-[7px] rounded-l-xl pl-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            props.step.leaves.length === 0 ? "pr-2.5" : "pr-1.5",
            active ? "font-semibold text-foreground" : "text-muted-foreground",
          )}
        >
          <StatusIndicator
            state={STATUS_STATE[props.step.status]}
            label={STATUS_LABEL[props.step.status]}
            size="size-1.5"
          />
          <span className="max-w-44 truncate">{props.step.label}</span>
          {active && leafLabel !== null ? (
            <span className="max-w-28 truncate font-normal text-muted-foreground">
              · {leafLabel}
            </span>
          ) : null}
        </button>
        {props.step.leaves.length === 0 ? null : (
          <Menu>
            <MenuTrigger
              render={
                <button
                  type="button"
                  aria-label={`Open ${props.step.name} details`}
                  className="mr-1 inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                />
              }
            >
              <ChevronDownIcon aria-hidden className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="start" className="min-w-52">
              <MenuItem
                onClick={() => props.onSelect({ kind: "step", stepIndex: props.step.stepIndex })}
              >
                <MessageSquareIcon />
                Conversation
              </MenuItem>
              <MenuSeparator />
              {props.step.leaves.map((leaf) => (
                <FlowStepLeafMenuItem
                  key={
                    leaf.kind === "subagent"
                      ? `subagent:${leaf.threadId}`
                      : `${leaf.kind}:${leaf.stepIndex}`
                  }
                  leaf={leaf}
                  onSelect={props.onSelect}
                  onOpenDiff={props.onOpenDiff}
                />
              ))}
            </MenuPopup>
          </Menu>
        )}
      </div>
    </li>
  );
}

function FlowStepLeafMenuItem(props: {
  readonly leaf: CardTreeLeaf;
  readonly onSelect: (selection: CardSelection) => void;
  readonly onOpenDiff: (leaf: Extract<CardTreeLeaf, { kind: "diff" }>) => void;
}) {
  const { leaf } = props;
  if (leaf.kind === "subagent") {
    return (
      <MenuItem
        onClick={() =>
          props.onSelect({
            kind: "subagent",
            stepIndex: leaf.stepIndex,
            threadId: leaf.threadId,
          })
        }
      >
        <StatusIndicator
          state={STATUS_STATE[leaf.status]}
          label={STATUS_LABEL[leaf.status]}
          size="size-1.5"
        />
        <span className="min-w-0 flex-1 truncate">{leaf.title}</span>
        {leaf.elapsed === null ? null : (
          <span className="text-muted-foreground text-xs tabular-nums">{leaf.elapsed}</span>
        )}
      </MenuItem>
    );
  }
  if (leaf.kind === "diff") {
    return (
      <MenuItem onClick={() => props.onOpenDiff(leaf)}>
        <FileDiffIcon />
        <span className="min-w-0 flex-1 truncate">{leaf.label}</span>
        {leaf.stat === null ? null : (
          <span className="text-muted-foreground text-xs tabular-nums">
            +{leaf.stat.additions} −{leaf.stat.deletions}
          </span>
        )}
      </MenuItem>
    );
  }
  return (
    <MenuItem
      onClick={() =>
        props.onSelect({
          kind: "artifact",
          stepIndex: leaf.stepIndex,
        })
      }
    >
      <FileTextIcon />
      <span className="min-w-0 flex-1 truncate">{leaf.fileName}</span>
      {leaf.trailing === null ? null : (
        <span className="text-muted-foreground text-xs">{leaf.trailing}</span>
      )}
    </MenuItem>
  );
}
