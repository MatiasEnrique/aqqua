import type { BoardId, OrchestrationBoard, OrchestrationCard } from "@aqqua/contracts";
import { LayoutGridIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import {
  FlowCardBranch,
  FlowCardFailureNote,
  FlowCardStateBadge,
  SidebarCardActionButton,
  SidebarCardItem,
  SidebarCardStatusSwapSlot,
  sidebarCardSurfaceClassName,
} from "../sidebar/card";
import { ComboboxEmpty, ComboboxItem, ComboboxList } from "../ui/combobox";
import { SidebarScopePicker } from "../sidebar-v2/SidebarScopePicker";
import { cardNeedsYou } from "./BoardRunTable.logic";

/**
 * The board switcher: same control as the project selector above it. The menu
 * lists the project's boards and carries the board-level actions.
 */
export function BoardSelector({
  boards,
  selectedBoardIds,
  projectTitle,
  onSelectionChange,
  onNewCard,
  onEditBoard,
  onNewBoard,
}: {
  readonly boards: ReadonlyArray<OrchestrationBoard>;
  /** Empty means every flow, matching the project filter above it. */
  readonly selectedBoardIds: ReadonlyArray<BoardId>;
  readonly projectTitle: string;
  readonly onSelectionChange: (boardIds: ReadonlyArray<BoardId>) => void;
  readonly onNewCard: () => void;
  readonly onEditBoard: (board: OrchestrationBoard) => void;
  readonly onNewBoard: () => void;
}) {
  const chosenBoards = boards.filter((candidate) => selectedBoardIds.includes(candidate.id));
  const soleVisibleBoard =
    selectedBoardIds.length === 0
      ? boards.length === 1
        ? (boards[0] ?? null)
        : null
      : chosenBoards.length === 1
        ? (chosenBoards[0] ?? null)
        : null;

  return (
    <SidebarScopePicker
      items={boards as OrchestrationBoard[]}
      chosenItems={chosenBoards}
      itemKey={(candidate) => candidate.id}
      itemLabel={(candidate) => candidate.name}
      icon={<LayoutGridIcon className="size-4" />}
      testId={`sidebar-flow-scope-chips-${projectTitle}`}
      inputLabel={`Filter flows in ${projectTitle}`}
      allItemsLabel="All flows"
      onSelectionChange={(next) => onSelectionChange(next.map((candidate) => candidate.id))}
      renderChip={(candidate) => (
        <>
          <LayoutGridIcon className="size-3 shrink-0" />
          <span className="min-w-0 truncate">{candidate.name}</span>
        </>
      )}
      renderPopup={(close) => (
        <>
          {chosenBoards.length > 0 ? (
            <div className="border-b border-border/60 p-1">
              <button
                type="button"
                className="w-full cursor-pointer rounded-sm px-2 py-1 text-left text-xs font-medium text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => onSelectionChange([])}
              >
                Deselect all
              </button>
            </div>
          ) : null}
          <ComboboxEmpty>No flows found.</ComboboxEmpty>
          <ComboboxList>
            {(candidate: OrchestrationBoard) => (
              <ComboboxItem
                key={candidate.id}
                value={candidate}
                className="pe-1"
                contentClassName="flex min-w-0 items-center gap-2"
              >
                <LayoutGridIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{candidate.name}</span>
                <button
                  type="button"
                  aria-label={`Edit ${candidate.name}`}
                  className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/55 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    close();
                    onEditBoard(candidate);
                  }}
                >
                  <PencilIcon className="size-3.5" />
                </button>
              </ComboboxItem>
            )}
          </ComboboxList>
          <div className="grid gap-0.5 border-t border-border/60 p-1">
            {soleVisibleBoard === null ? null : (
              <button
                type="button"
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  close();
                  onNewCard();
                }}
              >
                <PlusIcon className="size-4" />
                New card
              </button>
            )}
            <button
              type="button"
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                close();
                onNewBoard();
              }}
            >
              <LayoutGridIcon className="size-4" />
              {boards.length === 0 ? "Create flow" : "New flow"}
            </button>
          </div>
        </>
      )}
    />
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
    <SidebarCardItem size="slim">
      <div
        className={cn(
          sidebarCardSurfaceClassName({
            isActive: selected,
            isSelected: false,
            recede,
            inFlight: false,
            band: "none",
          }),
          "flex h-8 items-center gap-1.5 rounded-lg px-1.5",
          !interactive && "cursor-default opacity-70",
        )}
      >
        {interactive ? (
          <FlowRowSurfaceButton label={card.title} selected={selected} onOpen={onOpen} />
        ) : null}
        <div className="pointer-events-none relative z-10 flex h-full min-w-0 flex-1 items-center gap-1.5">
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
 * A card that is on the pipeline, in the same 32px registry language as a
 * worktree card. The flow name appears only in a merged scope; branch and
 * status keep their established trailing positions.
 */
export function InFlightCardRow({
  card,
  boardName,
  selected,
  onOpen,
  onDelete,
  pending,
}: {
  readonly card: OrchestrationCard;
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
    <SidebarCardItem size="slim">
      <div
        className={cn(
          sidebarCardSurfaceClassName({
            isActive: selected,
            isSelected: false,
            recede: false,
            inFlight,
            band: "none",
          }),
          "flex h-8 items-center gap-1.5 rounded-lg px-1.5",
        )}
      >
        <FlowRowSurfaceButton label={card.title} selected={selected} onOpen={onOpen} />
        <div className="pointer-events-none relative z-10 flex h-full min-w-0 flex-1 items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-sidebar-foreground">
            {card.title}
          </span>
          {boardName === null ? null : (
            <span className="hidden max-w-20 shrink truncate text-[10px] text-sidebar-muted-foreground/70 @[19rem]/sidebar-conversations:inline">
              {boardName}
            </span>
          )}
          <FlowCardBranch
            card={card}
            className="hidden @[17rem]/sidebar-conversations:inline-flex"
          />
          <span className="pointer-events-auto">
            <SidebarCardStatusSwapSlot
              className="h-5"
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
        </div>
      </div>
      <FlowCardFailureNote card={card} />
    </SidebarCardItem>
  );
}
