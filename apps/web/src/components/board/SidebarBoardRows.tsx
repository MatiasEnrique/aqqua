import { cardOperation } from "@aqqua/client-runtime/state/boards";
import type { OrchestrationBoard, OrchestrationCard } from "@aqqua/contracts";
import {
  ChevronDownIcon,
  GitBranchIcon,
  LayoutGridIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import { SidebarSummaryStateLabel } from "../sidebar-v2/SidebarStatusPresentations";
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
import {
  type BoardBadgeVariant,
  buildPositionSegments,
  cardFailureNote,
  cardOperationPresentation,
  cardSidebarSummaryState,
  cardStatusLine,
  cardWorktreeLabel,
  currentSegmentVariant,
} from "./BoardRunTable.logic";
import { useSidebarRelativeTimeTick } from "./useSidebarRelativeTimeTick";

const SEGMENT_FILL: Record<BoardBadgeVariant, string> = {
  info: "bg-info",
  warning: "bg-warning",
  error: "bg-destructive",
  success: "bg-success",
  secondary: "bg-muted-foreground",
};

function RelativeCardStatusLine({
  card,
  stepNames,
  boardName,
}: {
  readonly card: OrchestrationCard;
  readonly stepNames: ReadonlyArray<string>;
  readonly boardName: string | null;
}) {
  const nowMs = useSidebarRelativeTimeTick();
  return (
    <>
      {cardStatusLine(card, stepNames, nowMs)}
      {boardName === null ? null : (
        <span className="text-sidebar-muted-foreground/60"> · {boardName}</span>
      )}
    </>
  );
}

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
 * One badge, one vocabulary: an operation the server is running outranks the
 * card's resting state, so a row never reads Done while it is being deleted.
 */
export function CardStateBadge({ card }: { readonly card: OrchestrationCard }) {
  const operation = cardOperation(card);
  if (operation === "deleting") {
    return (
      <span className="inline-flex h-4 shrink-0 items-center gap-1 font-medium text-[10px] text-destructive-foreground leading-none">
        <Trash2Icon aria-hidden className="size-3.5 shrink-0" />
        <span role="status" className="leading-none">
          Deleting
        </span>
      </span>
    );
  }
  if (operation !== null && operation !== "starting") {
    return (
      <span className="inline-flex h-4 shrink-0 items-center gap-1 font-medium text-[10px] text-sidebar-muted-foreground leading-none">
        <Spinner className="size-3 shrink-0" />
        <span role="status" className="leading-none">
          {cardOperationPresentation(operation).label}
        </span>
      </span>
    );
  }
  return <SidebarSummaryStateLabel state={cardSidebarSummaryState(card)} className="text-[10px]" />;
}

/**
 * The worktree a card runs in, on the row that owns it. Cards that have never
 * been released have none, so the line simply isn't there; once released it
 * stays put through Done and Settled, because the checkout does too.
 */
export function CardWorktree({
  card,
  className,
}: {
  readonly card: OrchestrationCard;
  readonly className?: string;
}) {
  const worktree = cardWorktreeLabel(card);
  if (worktree === null) return null;
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1 text-[11px] text-sidebar-muted-foreground/70",
        className,
      )}
      title={worktree.title}
    >
      <GitBranchIcon aria-hidden className="size-3 shrink-0" />
      <span className="min-w-0 truncate font-mono">{worktree.label}</span>
    </span>
  );
}

/** The reason a card came back from an operation it was supposed to leave on. */
export function CardFailureNote({ card }: { readonly card: OrchestrationCard }) {
  const note = cardFailureNote(card);
  if (note === null) return null;
  return (
    <p className="truncate px-2 pb-1 text-[11px] text-destructive-foreground" title={note}>
      {note}
    </p>
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
  const segments = buildPositionSegments(card, stepNames);
  const variant = currentSegmentVariant(card);
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
          <span
            aria-hidden
            className={cn("size-1.5 shrink-0 rounded-full", SEGMENT_FILL[variant])}
          />
          <span className="min-w-0 flex-1 truncate font-medium text-[13px] text-sidebar-foreground">
            {card.title}
          </span>
          <CardStateBadge card={card} />
        </span>
        <span className="flex items-center gap-2 pl-3.5">
          <span aria-hidden className="flex w-14 shrink-0 items-center gap-0.5">
            {segments.map((segment) => (
              <span
                key={segment.index}
                className={cn(
                  "h-1 flex-1 rounded-full transition-colors duration-300 ease-out",
                  segment.state === "complete"
                    ? "bg-success"
                    : segment.state === "current"
                      ? SEGMENT_FILL[variant]
                      : "bg-sidebar-muted-foreground/25",
                )}
              />
            ))}
          </span>
          <span className="min-w-0 truncate text-[11px] text-sidebar-muted-foreground tabular-nums">
            <RelativeCardStatusLine card={card} stepNames={stepNames} boardName={boardName} />
          </span>
          <CardWorktree card={card} />
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
      <CardFailureNote card={card} />
    </div>
  );
}
