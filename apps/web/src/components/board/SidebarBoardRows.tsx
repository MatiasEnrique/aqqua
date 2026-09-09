import type { OrchestrationCard } from "@aqqua/contracts";
import {
  ChevronDownIcon,
  Grid2x2PlusIcon,
  LayoutGridIcon,
  PencilIcon,
  SquarePlusIcon,
  Trash2Icon,
} from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import type { FlowChoice, FlowGroup } from "./flowSelection";
import { ProjectFavicon } from "../ProjectFavicon";
import { SidebarActionIconButton } from "../sidebar-v2/SidebarActionIconButton";
import {
  FlowCardBranch,
  FlowCardFailureNote,
  FlowCardStateBadge,
  SidebarCardActionButton,
  SidebarCardItem,
  SidebarCardStatusSwapSlot,
  sidebarRegistryRowSurfaceClassName,
} from "../sidebar/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/menu";
import { cardNeedsYou } from "./BoardRunTable.logic";

export function FlowNewCardButton({
  flowName,
  disabled = false,
  onClick,
}: {
  readonly flowName: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <SidebarActionIconButton
      icon={SquarePlusIcon}
      label={`New card in ${flowName}`}
      tooltip="New card"
      disabled={disabled}
      onClick={onClick}
    />
  );
}

export function FlowNewFlowButton({
  projectName,
  disabled = false,
  onClick,
}: {
  readonly projectName: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <SidebarActionIconButton
      icon={Grid2x2PlusIcon}
      label={`New flow in ${projectName}`}
      tooltip="New flow"
      disabled={disabled}
      onClick={onClick}
    />
  );
}

export function FlowEditButton({
  flowName,
  disabled = false,
  onClick,
}: {
  readonly flowName: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <SidebarActionIconButton
      icon={PencilIcon}
      label={`Edit ${flowName}`}
      tooltip="Edit flow"
      disabled={disabled}
      onClick={onClick}
    />
  );
}

/**
 * The sidebar's one scope control: a flow at a time, listed under the project
 * that owns it. Picking a flow picks its project too, which is why the trigger
 * wears the project's icon — there is no second project filter to consult.
 */
export function FlowPicker({
  groups,
  selected,
  onSelect,
}: {
  readonly groups: ReadonlyArray<FlowGroup>;
  readonly selected: FlowChoice | null;
  readonly onSelect: (choice: FlowChoice) => void;
}) {
  const selectedId = selected?.flow.id ?? null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Select flow"
        title={
          selected === null ? undefined : `${selected.project.displayName} · ${selected.flow.name}`
        }
        className={cn(
          "flex min-h-8 w-full cursor-pointer items-center gap-1.5 rounded-md px-1 text-left text-[13px] font-medium leading-5 text-sidebar-foreground outline-none",
          "transition-colors hover:bg-sidebar-row-hover data-popup-open:bg-sidebar-row-hover",
          "focus-visible:ring-2 focus-visible:ring-ring",
        )}
        data-testid="sidebar-flow-picker"
      >
        {selected === null ? (
          <LayoutGridIcon
            aria-hidden
            className="size-3.5 shrink-0 text-sidebar-muted-foreground/80"
          />
        ) : (
          <ProjectFavicon
            environmentId={selected.project.environmentId}
            cwd={selected.project.workspaceRoot}
            className="size-3.5 shrink-0 rounded-sm"
          />
        )}
        <span className="min-w-0 flex-1 truncate">{selected?.flow.name ?? "No flow yet"}</span>
        <ChevronDownIcon
          aria-hidden
          className="size-3.5 shrink-0 text-sidebar-muted-foreground/70"
        />
      </DropdownMenuTrigger>
      {/* Same anchoring as the project menu: the popup takes the trigger's
          width so it reads as the field opening, not a box beside it. */}
      <DropdownMenuContent align="start" className="w-(--anchor-width) min-w-60">
        {groups.map((group, index) => (
          <DropdownMenuGroup key={group.project.projectKey}>
            {index === 0 ? null : <DropdownMenuSeparator />}
            <DropdownMenuLabel className="flex items-center gap-2">
              <ProjectFavicon
                environmentId={group.project.environmentId}
                cwd={group.project.workspaceRoot}
                className="size-3.5 shrink-0 rounded-sm"
              />
              <span className="min-w-0 truncate">{group.project.displayName}</span>
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={selectedId}
              onValueChange={(value) => {
                const flow = group.flows.find((candidate) => candidate.id === value);
                if (flow === undefined) return;
                onSelect({ project: group.project, flow });
              }}
            >
              {/* The menu's own size runs a step above the project label these
                  flows sit under, which read as the flow outranking its
                  project. */}
              {group.flows.map((flow) => (
                <DropdownMenuRadioItem
                  key={flow.id}
                  value={flow.id}
                  closeOnClick
                  className="gap-2 text-xs sm:text-xs"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <LayoutGridIcon
                      aria-hidden
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 truncate">{flow.name}</span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SectionLabel({
  className,
  count,
  trailing,
  children,
}: {
  readonly className?: string;
  /** Rendered beside the label the way the thread list weighs its group counts. */
  readonly count?: number;
  readonly trailing?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <h3 className="mb-1 flex h-8 items-center gap-2 rounded-md bg-sidebar-control-surface/60 px-2 text-[13px] font-semibold text-sidebar-foreground">
      <span className={cn("min-w-0 truncate", className)}>{children}</span>
      {count === undefined ? null : (
        <span className="text-[11px] font-normal tabular-nums text-sidebar-muted-foreground">
          {count}
        </span>
      )}
      {trailing === undefined ? null : (
        <span className="ml-auto text-[11px] font-normal">{trailing}</span>
      )}
    </h3>
  );
}

/**
 * The click target every flow row lays under its content: the whole surface is
 * pressable, and it sits *behind* the row so the hover actions on top keep
 * their own clicks. Same construction the conversation rows use.
 */
function FlowRowSurfaceButton({
  label,
  selected,
  onOpen,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onOpen: () => void;
}) {
  const handleKeyDown = (event: ReactKeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onOpen();
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-current={selected ? "true" : undefined}
      className="absolute inset-0 z-0 rounded-[inherit] outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
      onClick={onOpen}
      onKeyDown={handleKeyDown}
    />
  );
}

/**
 * The compact lifecycle row keeps two readable lines: project + card identity
 * above, then flow + worktree context below. Operational state stays pinned at
 * the right edge instead of competing with the title.
 */
export function FlowSlimRow({
  card,
  projectIcon,
  projectName,
  flowName,
  selected,
  onOpen,
  leading,
  trailing,
  titleClassName,
  /** Rows that are out of the working set rest dimmer until hovered. */
  recede = false,
  interactive = true,
}: {
  readonly card: OrchestrationCard;
  readonly projectIcon: ReactNode;
  readonly projectName: string;
  readonly flowName: string;
  readonly selected: boolean;
  readonly onOpen: () => void;
  readonly leading?: ReactNode;
  readonly trailing: ReactNode;
  readonly titleClassName?: string;
  readonly recede?: boolean;
  /** Deleting rows are a receipt, not a destination. */
  readonly interactive?: boolean;
}) {
  return (
    <SidebarCardItem size="flow">
      <div
        className={cn(
          "group/v2-row relative flex min-h-10 w-full cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2 py-0.5 text-left outline-none select-none transition-colors duration-(--duration-fast) ease-(--ease-fluid)",
          sidebarRegistryRowSurfaceClassName(selected),
          recede && !selected && "text-sidebar-muted-foreground/75",
          !interactive && "cursor-default opacity-70",
        )}
      >
        {interactive ? (
          <FlowRowSurfaceButton label={card.title} selected={selected} onOpen={onOpen} />
        ) : null}
        <div className="pointer-events-none relative z-10 flex h-full min-w-0 flex-1 items-center gap-2">
          <span
            role="img"
            aria-label={`Project: ${projectName}`}
            title={projectName}
            className="flex size-3.5 shrink-0 items-center justify-center"
          >
            {projectIcon}
          </span>
          <span className="flex min-w-0 flex-1 flex-col justify-center">
            <span className="flex min-w-0 items-center gap-1.5">
              {leading === undefined ? null : leading}
              <span className={cn("min-w-0 flex-1 truncate text-[13px] leading-5", titleClassName)}>
                {card.title}
              </span>
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-sidebar-muted-foreground">
              <span data-flow-name={flowName} title={flowName} className="min-w-0 truncate">
                {flowName}
              </span>
              <FlowCardBranch card={card} className="max-w-28" />
            </span>
          </span>
          <span className="pointer-events-auto flex shrink-0 items-center gap-1.5">{trailing}</span>
        </div>
      </div>
      <FlowCardFailureNote card={card} />
    </SidebarCardItem>
  );
}

/**
 * A card that is on the pipeline. It uses the same two-line identity as every
 * other flow row so moving between lifecycle shelves never drops context.
 */
export function InFlightCardRow({
  card,
  projectIcon,
  projectName,
  flowName,
  selected,
  onOpen,
  onDelete,
  pending,
}: {
  readonly card: OrchestrationCard;
  readonly projectIcon: ReactNode;
  readonly projectName: string;
  readonly flowName: string;
  readonly selected: boolean;
  readonly onOpen: () => void;
  readonly onDelete: (() => void) | null;
  readonly pending: boolean;
}) {
  // Cards that are simply running have nothing for a human to do yet, so they
  // rest faded and come back on hover; a card blocked on you never fades.
  const inFlight = !cardNeedsYou(card);
  return (
    <SidebarCardItem size="flow">
      <div
        className={cn(
          "group/v2-row relative flex min-h-10 w-full cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2 py-0.5 text-left outline-none select-none duration-(--duration-fast) ease-(--ease-fluid)",
          sidebarRegistryRowSurfaceClassName(selected),
          inFlight && !selected
            ? "opacity-70 transition-[background-color,color,opacity] hover:opacity-100"
            : "transition-colors",
        )}
      >
        <FlowRowSurfaceButton label={card.title} selected={selected} onOpen={onOpen} />
        <div className="pointer-events-none relative z-10 flex h-full min-w-0 flex-1 items-center gap-2">
          <span
            role="img"
            aria-label={`Project: ${projectName}`}
            title={projectName}
            className="flex size-3.5 shrink-0 items-center justify-center"
          >
            {projectIcon}
          </span>
          <span className="flex min-w-0 flex-1 flex-col justify-center">
            <span className="min-w-0 truncate text-[13px] leading-5 text-sidebar-foreground">
              {card.title}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-sidebar-muted-foreground">
              <span data-flow-name={flowName} title={flowName} className="min-w-0 truncate">
                {flowName}
              </span>
              <FlowCardBranch card={card} className="max-w-28" />
            </span>
          </span>
          <span className="pointer-events-auto">
            <SidebarCardStatusSwapSlot
              className="h-5"
              resting={<FlowCardStateBadge card={card} />}
              actions={
                onDelete === null ? null : (
                  <SidebarCardActionButton
                    icon={Trash2Icon}
                    label={`Delete '${card.title}'`}
                    title={`Delete ${card.title}`}
                    disabled={pending}
                    tone="destructive"
                    shape="square"
                    className="-my-1"
                    onClick={onDelete}
                  />
                )
              }
            />
          </span>
        </div>
      </div>
      <FlowCardFailureNote card={card} />
    </SidebarCardItem>
  );
}
