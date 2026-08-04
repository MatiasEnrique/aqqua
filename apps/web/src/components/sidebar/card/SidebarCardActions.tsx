import type { LucideIcon } from "lucide-react";
import { AlarmClockOffIcon, CheckIcon, Trash2Icon, Undo2Icon } from "lucide-react";
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

export function SidebarCardSettleButton(props: {
  readonly onSettle: (event: MouseEvent) => void;
  readonly description: string;
  readonly disabled?: boolean;
  readonly shape?: "square" | "inline";
  readonly className?: string;
}) {
  return (
    <SidebarCardActionButton
      icon={CheckIcon}
      label={`Settle ${props.description}`}
      title={
        props.disabled === true
          ? `${props.description} is still working or needs attention`
          : `Settle ${props.description}`
      }
      {...(props.disabled === undefined ? {} : { disabled: props.disabled })}
      {...(props.shape === undefined ? {} : { shape: props.shape })}
      {...(props.className === undefined ? {} : { className: props.className })}
      onClick={props.onSettle}
    />
  );
}

export function SidebarCardUnsettleButton(props: {
  readonly onUnsettle: (event: MouseEvent) => void;
}) {
  return (
    <SidebarCardActionButton
      icon={Undo2Icon}
      label="Un-settle thread"
      onClick={props.onUnsettle}
      shape="inline"
    />
  );
}

/** Deletion needs no server capability, so it renders wherever it's offered. */
export function SidebarCardDeleteButton(props: {
  readonly onDelete: (event: MouseEvent) => void;
  readonly label?: string;
}) {
  return (
    <SidebarCardActionButton
      icon={Trash2Icon}
      label={props.label ?? "Delete thread"}
      onClick={props.onDelete}
      tone="destructive"
      shape="inline"
    />
  );
}

export function SidebarCardWakeButton(props: { readonly onWake: (event: MouseEvent) => void }) {
  return (
    <SidebarCardActionButton
      icon={AlarmClockOffIcon}
      label="Wake thread now"
      onClick={props.onWake}
      shape="inline"
    />
  );
}

/**
 * Status at rest, actions on hover, in one slot — the actions take the status's
 * place in flow rather than sitting beside it, so a hovered row doesn't reflow.
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
  const hasActions = props.actions !== null && props.actions !== false;
  return (
    <span
      className={cn(
        "group/v2-status-slot relative flex h-7 min-w-14 shrink-0 items-center justify-end",
        props.className,
      )}
    >
      <span
        className={cn(
          "inline-flex items-center transition-opacity",
          hasActions &&
            "group-focus-within/v2-status-slot:absolute group-focus-within/v2-status-slot:right-0 group-hover/v2-row:absolute group-hover/v2-row:right-0 group-hover/v2-row:opacity-0",
          props.pinned === true && "absolute right-0 opacity-0",
        )}
      >
        {props.resting}
      </span>
      {hasActions ? (
        <span
          className={cn(
            "absolute inset-y-0 right-0 flex items-stretch opacity-0 transition-opacity focus-within:static focus-within:opacity-100 group-hover/v2-row:static group-hover/v2-row:opacity-100",
            props.pinned === true && "static opacity-100",
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
            props.actions === null
              ? null
              : "group-focus-within/v2-hover-slot:opacity-0 group-hover/v2-row:opacity-0",
          )}
        >
          {props.resting}
        </span>
      )}
      {props.actions === null ? null : (
        <span className="absolute inset-y-0 right-0 flex items-stretch opacity-0 transition-opacity focus-within:opacity-100 group-hover/v2-row:opacity-100">
          {props.actions}
        </span>
      )}
    </span>
  );
}
