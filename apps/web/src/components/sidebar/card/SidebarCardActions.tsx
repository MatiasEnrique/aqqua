import type { LucideIcon } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { cn } from "~/lib/utils";

/**
 * A row-level action. Clicks never reach the row underneath, so pressing
 * Settle can't also navigate; double-clicks are swallowed too, or the row's
 * rename gesture fires through the button.
 */
export function SidebarCardActionButton(props: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly title?: string;
  readonly onClick: (event: MouseEvent) => void;
  readonly disabled?: boolean;
  readonly tone?: "default" | "destructive";
  /** "square" is the card's padded hit target; "inline" the compact hover one. */
  readonly shape?: "square" | "inline";
  readonly className?: string;
}) {
  const Icon = props.icon;
  const isSquare = props.shape === "square";
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.title ?? props.label}
      disabled={props.disabled === true}
      onClick={(event) => {
        event.stopPropagation();
        props.onClick(event);
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md bg-transparent outline-none disabled:cursor-not-allowed disabled:opacity-30",
        isSquare
          ? "size-7 text-muted-foreground/65 transition-[background-color,color,scale] hover:bg-sidebar-row-hover active:scale-[0.96] motion-reduce:transform-none"
          : "px-1.5 text-xs text-muted-foreground",
        props.tone === "destructive"
          ? "hover:text-destructive-foreground"
          : "hover:text-foreground",
        props.className,
      )}
    >
      <Icon aria-hidden className={isSquare ? "size-3.5" : "size-3"} />
    </button>
  );
}

function hasRenderableActions(actions: ReactNode): boolean {
  return actions !== null && actions !== false && actions !== undefined;
}

/**
 * Status at rest, actions on hover, in one grid cell — both layers keep the
 * same position, so a fast pointer never chases a moving action or hits the
 * fading status, and the row never reflows.
 *
 * `pinned` keeps the actions up while a menu they opened is still on screen:
 * the pointer has left the row by then, and without it the menu would be
 * orphaned above a row that already faded its trigger away.
 */
export function SidebarCardStatusSwapSlot(props: {
  readonly resting: ReactNode;
  readonly actions: ReactNode;
  readonly pinned?: boolean;
  readonly className?: string;
}) {
  const hasActions = hasRenderableActions(props.actions);
  return (
    <span
      className={cn(
        "group/v2-status-slot grid h-7 min-w-14 shrink-0 grid-cols-[1fr] items-center justify-items-end",
        props.className,
      )}
    >
      <span
        className={cn(
          "pointer-events-none col-start-1 row-start-1 inline-flex items-center transition-opacity",
          hasActions && "group-focus-within/v2-status-slot:opacity-0 group-hover/v2-row:opacity-0",
          props.pinned === true && "opacity-0",
        )}
      >
        {props.resting}
      </span>
      {hasActions ? (
        <span
          className={cn(
            "pointer-events-none col-start-1 row-start-1 flex h-full items-stretch opacity-0 transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 group-hover/v2-row:pointer-events-auto group-hover/v2-row:opacity-100",
            props.pinned === true && "pointer-events-auto opacity-100",
          )}
        >
          {props.actions}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The compact variant: the resting content fades in place and the actions
 * appear over it. Used where the slot is too narrow to swap without the row
 * jumping — the settled tail and nested sub-agents.
 */
export function SidebarCardHoverActionSlot(props: {
  readonly resting?: ReactNode;
  readonly actions: ReactNode;
  /** Reserve width so a column of rows keeps one right edge. */
  readonly reserveWidth?: boolean;
  readonly className?: string;
}) {
  const hasActions = hasRenderableActions(props.actions);
  return (
    <span
      className={cn(
        "group/v2-hover-slot relative ml-auto flex h-6 shrink-0 items-center justify-end",
        props.reserveWidth === true && "min-w-14",
        props.className,
      )}
    >
      {props.resting === undefined ? null : (
        <span
          className={cn(
            "inline-flex justify-end tabular-nums transition-opacity",
            !hasActions
              ? null
              : "group-focus-within/v2-hover-slot:opacity-0 group-hover/v2-row:opacity-0",
          )}
        >
          {props.resting}
        </span>
      )}
      {hasActions ? (
        <span className="absolute inset-y-0 right-0 flex items-stretch opacity-0 transition-opacity focus-within:opacity-100 group-hover/v2-row:opacity-100">
          {props.actions}
        </span>
      ) : null}
    </span>
  );
}
