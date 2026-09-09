import { FileTextIcon, PlusIcon } from "lucide-react";
import type { ReactNode } from "react";

import { registerConversationTabStrip } from "../chat/conversationTabStripScroll";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { StatusIndicator } from "../StatusIndicator";
import { TabFamilyCountTrigger, TabFamilyPopover } from "../TabFamilyPopover";
import {
  WorkspaceTabShell,
  WorkspaceTabStrip,
  workspaceTabContentClassName,
} from "../WorkspaceTabStrip";
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
  /** Starts another conversation in the card's worktree, after the ones there. */
  readonly onNewConversation?: (() => void) | undefined;
  readonly actions?: ReactNode;
}) {
  return (
    <WorkspaceTabStrip
      label="Flow steps"
      activeKey={formatFlowStepKey(props.selection)}
      data-flow-step-tabbar
      // The titlebar's paging arrows move whichever strip is mounted; the
      // steps use the same ones the conversations do.
      onViewportChange={registerConversationTabStrip}
      trailing={props.actions}
    >
      {props.model.steps.map((step) => (
        <FlowStepTabFamily
          key={step.stepIndex}
          step={step}
          selection={props.selection}
          onSelect={props.onSelect}
        />
      ))}
      {props.model.conversations.map((conversation) => (
        <li key={conversation.threadId} className="shrink-0">
          <WorkspaceTabShell
            active={
              props.selection.kind === "conversation" &&
              props.selection.threadId === conversation.threadId
            }
          >
            <button
              type="button"
              aria-current={
                props.selection.kind === "conversation" &&
                props.selection.threadId === conversation.threadId
                  ? "page"
                  : undefined
              }
              onClick={() =>
                props.onSelect({ kind: "conversation", threadId: conversation.threadId })
              }
              className={workspaceTabContentClassName(
                props.selection.kind === "conversation" &&
                  props.selection.threadId === conversation.threadId
                  ? "active"
                  : "inactive",
              )}
            >
              <StatusIndicator
                state={STATUS_STATE[conversation.status]}
                label={STATUS_LABEL[conversation.status]}
                size="size-1.5"
              />
              <span className="max-w-44 truncate">{conversation.title}</span>
            </button>
          </WorkspaceTabShell>
        </li>
      ))}
      {props.onNewConversation === undefined ? null : (
        <li className="shrink-0">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="New conversation in this card"
                  onClick={props.onNewConversation}
                  className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-(--duration-fast) ease-(--ease-fluid) hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [-webkit-app-region:no-drag]"
                />
              }
            >
              <PlusIcon aria-hidden className="size-4" />
            </TooltipTrigger>
            <TooltipPopup side="bottom">New conversation</TooltipPopup>
          </Tooltip>
        </li>
      )}
      <li className="shrink-0">
        <WorkspaceTabShell active={false} muted={!props.model.done.reached}>
          <span
            aria-label={`Done: ${props.model.done.trailing}`}
            className={workspaceTabContentClassName(
              props.model.done.reached ? "inactive" : "muted",
            )}
          >
            <StatusIndicator
              state={props.model.done.reached ? "done" : "stale"}
              label={props.model.done.reached ? "Done" : "Not reached"}
              size="size-1.5"
              pulse={false}
            />
            <span>Done</span>
          </span>
        </WorkspaceTabShell>
      </li>
    </WorkspaceTabStrip>
  );
}

/** What the strip scrolls on: the tab in view, and which leaf of it. */
function formatFlowStepKey(selection: CardSelection): string {
  switch (selection.kind) {
    case "conversation":
      return `conversation:${selection.threadId}`;
    case "subagent":
      return `${selection.stepIndex}:${selection.threadId}`;
    default:
      return `${selection.stepIndex}:${selection.kind}`;
  }
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
    (props.selection.kind === "subagent" || props.selection.kind === "artifact") &&
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
    <WorkspaceTabShell active={props.active} muted={pending} className="pr-1.5">
      {pending ? (
        <span
          aria-disabled="true"
          aria-label={`${props.step.label}: Not started`}
          className={workspaceTabContentClassName("muted")}
        >
          <StatusIndicator state="stale" label="Not started" size="size-1.5" pulse={false} />
          <span className="max-w-44 truncate">{props.step.label}</span>
        </span>
      ) : (
        <button
          type="button"
          aria-current={props.active ? "step" : undefined}
          onClick={() => props.onSelect({ kind: "step", stepIndex: props.step.stepIndex })}
          className={workspaceTabContentClassName(props.active ? "active" : "inactive")}
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
    </WorkspaceTabShell>
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
            "data-active-tab": props.holdsActiveLeaf ? true : undefined,
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
  if (selection.kind === "step" || selection.kind === "conversation") return false;
  if (selection.stepIndex !== leaf.stepIndex) return false;
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
