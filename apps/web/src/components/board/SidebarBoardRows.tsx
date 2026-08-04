import type { OrchestrationBoard, OrchestrationCard } from "@aqqua/contracts";
import { ChevronDownIcon, LayoutGridIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { cn } from "~/lib/utils";
import {
  FlowCardBranch,
  FlowCardFailureNote,
  FlowCardProgress,
  FlowCardStateBadge,
  FlowCardStateDot,
  FlowCardStatusLine,
} from "../sidebar/card";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { SidebarMenuButton } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";

/**
 * The board switcher: same control as the project selector above it. The menu
 * lists the project's boards and carries the board-level actions.
 */
export function BoardSelector({
  boards,
  board,
  allSelected,
  projectTitle,
  onSelectBoard,
  onNewCard,
  onEditBoard,
  onNewBoard,
}: {
  readonly boards: ReadonlyArray<OrchestrationBoard>;
  /** The pinned board; `null` while "All boards" is on or none exist. */
  readonly board: OrchestrationBoard | null;
  readonly allSelected: boolean;
  readonly projectTitle: string;
  readonly onSelectBoard: (selection: "all" | string) => void;
  readonly onNewCard: () => void;
  readonly onEditBoard: () => void;
  readonly onNewBoard: () => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <SidebarMenuButton
            type="button"
            aria-label={`Flows in ${projectTitle}`}
            className="focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
          />
        }
      >
        <LayoutGridIcon className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {allSelected ? "All flows" : (board?.name ?? `No flow in ${projectTitle}`)}
        </span>
        {/* Boards are per-project; the suffix keeps sections tellable apart
            when "All projects" stacks several of them. */}
        {allSelected || board !== null ? (
          <span className="shrink-0 truncate text-sidebar-muted-foreground/70 text-xs">
            {projectTitle}
          </span>
        ) : null}
        <ChevronDownIcon className="-mr-px size-4 shrink-0" />
      </MenuTrigger>
      <MenuPopup align="start" className="w-(--anchor-width)">
        {boards.length > 0 ? (
          <>
            <MenuRadioGroup
              value={allSelected ? "all" : (board?.id ?? "")}
              onValueChange={(value) => {
                if (typeof value === "string") onSelectBoard(value as "all" | string);
              }}
            >
              {boards.length > 1 ? (
                <MenuRadioItem value="all" closeOnClick>
                  All flows
                </MenuRadioItem>
              ) : null}
              {boards.map((candidate) => (
                <MenuRadioItem key={candidate.id} value={candidate.id} closeOnClick>
                  {candidate.name}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
            <MenuSeparator />
            {/* Per-board actions need a pinned board; the merged view has none. */}
            {board === null ? null : (
              <>
                <MenuItem onClick={onNewCard}>
                  <PlusIcon />
                  New card
                </MenuItem>
                <MenuItem onClick={onEditBoard}>
                  <PencilIcon />
                  Edit flow
                </MenuItem>
              </>
            )}
          </>
        ) : null}
        <MenuItem onClick={onNewBoard}>
          <LayoutGridIcon />
          {boards.length === 0 ? "Create flow" : "New flow"}
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

export function SectionLabel({
  className,
  trailing,
  children,
}: {
  readonly className?: string;
  readonly trailing?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-2 pb-1">
      <span className={cn("font-semibold text-[10.5px] uppercase tracking-[0.08em]", className)}>
        {children}
      </span>
      {trailing === undefined ? null : <span className="text-[10.5px]">{trailing}</span>}
    </div>
  );
}

export function InFlightCardRow({
  card,
  stepNames,
  boardName,
  selected,
  onOpen,
  onDelete,
  pending,
}: {
  readonly card: OrchestrationCard;
  readonly stepNames: ReadonlyArray<string>;
  /** Set in the merged "All boards" view so a row says where it runs. */
  readonly boardName: string | null;
  readonly selected: boolean;
  readonly onOpen: () => void;
  readonly onDelete: (() => void) | null;
  readonly pending: boolean;
}) {
  return (
    <div className="group/card relative">
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex w-full flex-col gap-1.5 rounded-lg px-2 py-2 text-left outline-none transition-[background-color,scale] duration-150 ease-out hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] motion-reduce:transform-none",
          onDelete !== null && "pr-8",
          selected && "bg-sidebar-row-selected shadow-xs ring-1 ring-sidebar-border/60",
        )}
        onClick={onOpen}
      >
        <span className="flex w-full items-center gap-2">
          <FlowCardStateDot card={card} />
          <span className="min-w-0 flex-1 truncate font-medium text-[13px] text-sidebar-foreground">
            {card.title}
          </span>
          <FlowCardStateBadge card={card} />
        </span>
        <span className="flex items-center gap-2 pl-3.5">
          <FlowCardProgress card={card} stepNames={stepNames} />
          <FlowCardStatusLine card={card} stepNames={stepNames} boardName={boardName} />
          <FlowCardBranch card={card} />
        </span>
      </button>
      {onDelete === null ? null : (
        <button
          type="button"
          aria-label={`Delete '${card.title}'`}
          title={`Delete ${card.title}`}
          disabled={pending}
          className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-sm opacity-0 outline-none transition-[opacity,background-color] group-hover/card:opacity-100 pointer-coarse:opacity-100 hover:bg-destructive/10 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30 [&_svg]:text-sidebar-muted-foreground hover:[&_svg]:text-destructive-foreground"
          onClick={onDelete}
        >
          {pending ? <Spinner className="size-3" /> : <Trash2Icon aria-hidden className="size-3" />}
        </button>
      )}
      <FlowCardFailureNote card={card} />
    </div>
  );
}
