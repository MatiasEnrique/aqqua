import type { OrchestrationBoard, OrchestrationCard } from "@aqqua/contracts";
import { ChevronDownIcon, LayoutGridIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

import { cn } from "~/lib/utils";
import {
  FlowCardBranch,
  FlowCardFailureNote,
  FlowCardProgress,
  FlowCardStateBadge,
  FlowCardStateDot,
  FlowCardStatusLine,
  SidebarCardActionButton,
  SidebarCardItem,
  SidebarCardLine,
  SidebarCardMeta,
  SidebarCardStatusSwapSlot,
  sidebarCardSurfaceClassName,
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
import { cardNeedsYou } from "./BoardRunTable.logic";

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
 * The one-line flow row: To-Do, Done, Settled and Deleting all reduce to a
 * title, a state, and whatever that shelf lets you do about it. Same panel as
 * the card above it, at the height a conversation's slim row uses.
 */
export function FlowSlimRow({
  card,
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
    <SidebarCardItem size="slim" band="single">
      <div
        className={cn(
          sidebarCardSurfaceClassName({
            isActive: selected,
            isSelected: false,
            recede,
            inFlight: false,
            band: "single",
          }),
          "flex h-9 items-center gap-2.5 px-2.5",
          !interactive && "cursor-default opacity-70",
        )}
      >
        {interactive ? (
          <FlowRowSurfaceButton label={card.title} selected={selected} onOpen={onOpen} />
        ) : null}
        <div className="pointer-events-none relative z-10 flex h-full min-w-0 flex-1 items-center gap-2.5">
          {leading === undefined ? null : leading}
          <span className={cn("min-w-0 flex-1 truncate text-[13px]", titleClassName)}>
            {card.title}
          </span>
          <span className="pointer-events-auto contents">{trailing}</span>
        </div>
      </div>
      <FlowCardFailureNote card={card} />
    </SidebarCardItem>
  );
}

/**
 * A card that is on the pipeline: what it is, how far it has come, and what it
 * is doing right now. Two lines on one panel — the title owns the first, and
 * everything describing where the work sits reads under it.
 */
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
  // Cards that are simply running have nothing for a human to do yet, so they
  // rest faded and come back on hover; a card blocked on you never fades.
  const inFlight = !cardNeedsYou(card);
  return (
    <SidebarCardItem size="card" band="single">
      <div
        className={sidebarCardSurfaceClassName({
          isActive: selected,
          isSelected: false,
          recede: false,
          inFlight,
          band: "single",
        })}
      >
        <FlowRowSurfaceButton label={card.title} selected={selected} onOpen={onOpen} />
        <div className="pointer-events-none relative z-10 flex h-[3.25rem] min-w-0 flex-col justify-center gap-1 px-2.5 py-1.5">
          <SidebarCardLine className="h-5 gap-2">
            <FlowCardStateDot card={card} />
            <span className="min-w-0 flex-1 truncate font-medium text-[13px]">{card.title}</span>
            <span className="pointer-events-auto contents">
              <SidebarCardStatusSwapSlot
                className="h-5"
                // Colour already carries the state here, so the label sits a
                // step below the row's own metadata — as on a conversation card.
                resting={<FlowCardStateBadge card={card} className="text-[8px]" />}
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
          </SidebarCardLine>
          {/* Indented under the title, so the second line reads as detail about
              the row above rather than as a row of its own. */}
          <SidebarCardLine className="h-4 gap-2.5 pl-3.5 text-[11px] leading-none">
            <FlowCardProgress card={card} stepNames={stepNames} />
            <FlowCardStatusLine card={card} stepNames={stepNames} boardName={boardName} />
            <SidebarCardMeta className="h-4">
              <FlowCardBranch card={card} />
            </SidebarCardMeta>
          </SidebarCardLine>
        </div>
      </div>
      <FlowCardFailureNote card={card} />
    </SidebarCardItem>
  );
}
