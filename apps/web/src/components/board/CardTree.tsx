import { ChevronRightIcon, ClockIcon, FileDiffIcon, FileTextIcon } from "lucide-react";
import { useMemo, useState, type ComponentType } from "react";

import { cn } from "~/lib/utils";
import { SIDEBAR_STATE_PRESENTATIONS } from "../sidebar-v2/SidebarStatusPresentations";
import type {
  CardSelection,
  CardTreeIconState,
  CardTreeLeaf,
  CardTreeModel,
  CardTreeStepRow,
} from "./CardDetail.logic";

/**
 * The card tree: everything the card owns, in one rail. Selecting a row is
 * what drives the detail slot — steps, their sub-agent threads, and their
 * artifacts are all just rows here, which is what makes one detail slot work.
 */

/**
 * The app's sidebar status icons, recolored onto the board's badge recipe
 * (amber for anything waiting on you) instead of the sidebar's violet.
 */
const TREE_ICON_PRESENTATIONS: Record<
  CardTreeIconState,
  { readonly icon: ComponentType<{ className?: string }>; readonly className: string }
> = {
  done: { icon: SIDEBAR_STATE_PRESENTATIONS.done.icon, className: "text-success" },
  working: { icon: SIDEBAR_STATE_PRESENTATIONS.working.icon, className: "text-info" },
  needsInput: { icon: SIDEBAR_STATE_PRESENTATIONS.needsInput.icon, className: "text-warning" },
  failed: { icon: SIDEBAR_STATE_PRESENTATIONS.needsInput.icon, className: "text-destructive" },
  idle: { icon: SIDEBAR_STATE_PRESENTATIONS.stale.icon, className: "text-muted-foreground/60" },
};

const TREE_ICON_LABELS: Record<CardTreeIconState, string> = {
  done: "Done",
  working: "Working",
  needsInput: "Needs input",
  failed: "Failed",
  idle: "Not reached",
};

function StatusIcon({ state, size }: { readonly state: CardTreeIconState; readonly size: string }) {
  const presentation = TREE_ICON_PRESENTATIONS[state];
  const Icon = presentation.icon;
  return (
    <Icon
      aria-label={TREE_ICON_LABELS[state]}
      className={cn(size, "shrink-0", presentation.className)}
    />
  );
}

export interface CardTreeProps {
  readonly model: CardTreeModel;
  readonly selection: CardSelection;
  readonly onSelect: (selection: CardSelection) => void;
  /** Diff leaves hand off to the app's existing diff panel. */
  readonly onOpenDiff: (leaf: Extract<CardTreeLeaf, { kind: "diff" }>) => void;
}

export function CardTree({ model, selection, onSelect, onOpenDiff }: CardTreeProps) {
  // Steps collapse freely — including the selected one. Selecting a step
  // re-expands it once, then the chevron has the final say.
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set());
  const [lastSelectedStep, setLastSelectedStep] = useState(selection.stepIndex);
  if (lastSelectedStep !== selection.stepIndex) {
    setLastSelectedStep(selection.stepIndex);
    if (collapsed.has(selection.stepIndex)) {
      const next = new Set(collapsed);
      next.delete(selection.stepIndex);
      setCollapsed(next);
    }
  }
  const stepCount = model.steps.length;
  const header = useMemo(
    () => `Pipeline · ${stepCount} step${stepCount === 1 ? "" : "s"}`,
    [stepCount],
  );

  return (
    <nav
      aria-label="Card pipeline"
      className="flex w-66 shrink-0 flex-col gap-0.5 overflow-y-auto border-border/60 border-r px-3 pt-4 pb-3"
    >
      <div className="px-2 pb-2.5 font-bold text-[10px] text-muted-foreground uppercase leading-3 tracking-widest">
        {header}
      </div>

      {model.steps.map((step) => (
        <StepRows
          key={step.stepIndex}
          step={step}
          selection={selection}
          expanded={!collapsed.has(step.stepIndex)}
          onToggle={() =>
            setCollapsed((current) => {
              const next = new Set(current);
              if (next.has(step.stepIndex)) {
                next.delete(step.stepIndex);
              } else {
                next.add(step.stepIndex);
              }
              return next;
            })
          }
          onSelect={onSelect}
          onOpenDiff={onOpenDiff}
        />
      ))}

      <div className="flex h-7.5 items-center gap-2 rounded-lg px-2">
        <span className="w-3 shrink-0" />
        <ClockIcon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0",
            model.done.reached ? "text-success" : "text-muted-foreground/60",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground/70 leading-4">
          Done
        </span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70 leading-3 tabular-nums">
          {model.done.trailing}
        </span>
      </div>
    </nav>
  );
}

function StepRows({
  step,
  selection,
  expanded,
  onToggle,
  onSelect,
  onOpenDiff,
}: {
  readonly step: CardTreeStepRow;
  readonly selection: CardSelection;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onSelect: (selection: CardSelection) => void;
  readonly onOpenDiff: (leaf: Extract<CardTreeLeaf, { kind: "diff" }>) => void;
}) {
  const isSelected = selection.kind === "step" && selection.stepIndex === step.stepIndex;

  return (
    <>
      <div
        className={cn(
          "flex h-7.5 items-center gap-2 rounded-lg px-2 transition-colors duration-150 ease-out",
          isSelected ? "bg-popover" : "hover:bg-foreground/[0.04]",
        )}
      >
        <button
          type="button"
          aria-label={expanded ? `Collapse ${step.name}` : `Expand ${step.name}`}
          aria-expanded={expanded}
          className="flex w-3 shrink-0 cursor-pointer items-center justify-center text-muted-foreground/70"
          onClick={onToggle}
          disabled={step.leaves.length === 0}
        >
          {step.leaves.length === 0 ? null : (
            <ChevronRightIcon
              className={cn(
                "size-2.5 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
                expanded && "rotate-90",
              )}
              strokeWidth={3}
            />
          )}
        </button>
        <button
          type="button"
          aria-current={isSelected ? "true" : undefined}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
          onClick={() => onSelect({ kind: "step", stepIndex: step.stepIndex })}
        >
          <StatusIcon state={step.status} size="size-3.5" />
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px] leading-4",
              isSelected ? "font-semibold text-foreground" : "font-medium text-muted-foreground",
            )}
          >
            {step.label}
          </span>
          {step.trailing === null ? null : (
            <span
              className={cn(
                "shrink-0 font-mono text-[10px] leading-3 tabular-nums",
                isSelected ? "text-muted-foreground" : "text-muted-foreground/70",
              )}
            >
              {step.trailing}
            </span>
          )}
        </button>
      </div>

      {step.leaves.length > 0 ? (
        // Children stay mounted inside a 0fr/1fr grid so expand and collapse
        // interpolate height instead of popping; `inert` keeps the hidden rows
        // out of the tab order. The collapsed -mt cancels the parent gap slot
        // the zero-height wrapper would otherwise leave behind.
        <div
          inert={!expanded}
          className={cn(
            "grid transition-[grid-template-rows,margin,opacity] duration-250 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
            expanded ? "grid-rows-[1fr] opacity-100" : "-mt-0.5 grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="overflow-hidden">
            {/* Children hang off a guide line under the chevron column, the
                same nesting language the conversations sidebar uses for
                worktrees. Step rows carry a 20px chevron gutter, so children
                need the deeper inset to land clearly right of the step icons. */}
            <div className="ml-3.5 flex flex-col gap-0.5 border-border/50 border-l pl-3.5">
              {step.leaves.map((leaf) => (
                <LeafRow
                  key={leafKey(leaf)}
                  leaf={leaf}
                  selection={selection}
                  onSelect={onSelect}
                  onOpenDiff={onOpenDiff}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function leafKey(leaf: CardTreeLeaf): string {
  switch (leaf.kind) {
    case "subagent":
      return `sub:${leaf.threadId}`;
    case "diff":
      return `diff:${leaf.stepIndex}`;
    case "artifact":
      return `artifact:${leaf.stepIndex}`;
  }
}

function LeafRow({
  leaf,
  selection,
  onSelect,
  onOpenDiff,
}: {
  readonly leaf: CardTreeLeaf;
  readonly selection: CardSelection;
  readonly onSelect: (selection: CardSelection) => void;
  readonly onOpenDiff: (leaf: Extract<CardTreeLeaf, { kind: "diff" }>) => void;
}) {
  const isSelected =
    (leaf.kind === "subagent" &&
      selection.kind === "subagent" &&
      selection.threadId === leaf.threadId) ||
    (leaf.kind === "artifact" &&
      selection.kind === "artifact" &&
      selection.stepIndex === leaf.stepIndex);

  const onClick = () => {
    switch (leaf.kind) {
      case "subagent":
        onSelect({ kind: "subagent", stepIndex: leaf.stepIndex, threadId: leaf.threadId });
        return;
      case "artifact":
        onSelect({ kind: "artifact", stepIndex: leaf.stepIndex });
        return;
      case "diff":
        onOpenDiff(leaf);
    }
  };

  return (
    <button
      type="button"
      aria-current={isSelected ? "true" : undefined}
      onClick={onClick}
      className={cn(
        "flex h-6.5 cursor-pointer items-center gap-2 rounded-lg px-2 text-left transition-colors duration-150 ease-out",
        isSelected ? "bg-popover" : "hover:bg-foreground/[0.04]",
      )}
    >
      {leaf.kind === "subagent" ? (
        <>
          <StatusIcon state={leaf.status} size="size-3" />
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-xs leading-4",
              isSelected ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {leaf.title}
          </span>
          {leaf.elapsed === null ? null : (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70 leading-3 tabular-nums">
              {leaf.elapsed}
            </span>
          )}
        </>
      ) : null}

      {leaf.kind === "diff" ? (
        <>
          <FileDiffIcon aria-hidden className="size-3 shrink-0 text-muted-foreground/70" />
          <span className="min-w-0 flex-1 truncate text-muted-foreground/80 text-xs leading-4">
            {leaf.label}
          </span>
          {leaf.stat === null ? null : (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70 leading-3 tabular-nums">
              +{leaf.stat.additions} −{leaf.stat.deletions}
            </span>
          )}
        </>
      ) : null}

      {leaf.kind === "artifact" ? (
        <>
          <FileTextIcon aria-hidden className="size-3 shrink-0 text-muted-foreground/70" />
          <span
            className={cn(
              "min-w-0 flex-1 truncate font-mono text-[11px] leading-[14px]",
              isSelected ? "text-foreground" : "text-muted-foreground/80",
            )}
          >
            {leaf.fileName}
          </span>
          {leaf.trailing === null ? null : (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70 leading-3 tabular-nums">
              {leaf.trailing}
            </span>
          )}
        </>
      ) : null}
    </button>
  );
}
