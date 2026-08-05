import type { ChangeEvent, FocusEvent, KeyboardEvent, MouseEvent } from "react";
import { cn } from "~/lib/utils";

/**
 * How loudly a description speaks. Rows differ in what earns prominence — an
 * unread completion on a card, the active route on a nested row — so the row
 * decides the tone and this component only renders it.
 */
export type SidebarCardDescriptionTone =
  /** Wants you: unread completion, freshly woken, or the row you're on. */
  | "loud"
  | "strong"
  | "normal"
  /** Quiet rows, ordered by how far back they've stepped. */
  | "unread"
  | "quiet"
  | "muted"
  | "faint";

const TONE_CLASS: Record<SidebarCardDescriptionTone, string> = {
  loud: "text-foreground",
  strong: "text-foreground/95",
  normal: "text-foreground/90",
  unread: "text-muted-foreground",
  quiet: "text-muted-foreground/85",
  muted: "text-muted-foreground/80",
  faint: "text-muted-foreground/70",
};

/** What a row is about: the thread title, or a flow card's title. */
export function SidebarCardDescription(props: {
  readonly children: string;
  readonly tone?: SidebarCardDescriptionTone;
  /** Set while the row is quiet: weight, not colour, carries the demotion. */
  readonly muted?: boolean;
  /** Nested and settled rows come back to full contrast under the pointer. */
  readonly brightenOnHover?: boolean;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "min-w-0 flex-1 truncate text-sm",
        props.muted === true ? "font-normal" : "font-medium",
        TONE_CLASS[props.tone ?? "normal"],
        props.brightenOnHover === true && "group-hover/v2-row:text-foreground",
        props.className,
      )}
    >
      {props.children}
    </span>
  );
}

/** The description, mid-rename. Same slot, same metrics, editable. */
export function SidebarCardDescriptionInput(props: {
  readonly value: string;
  readonly label?: string;
  readonly onChange: (value: string) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  readonly onBlur: (event: FocusEvent<HTMLInputElement>) => void;
}) {
  return (
    <input
      autoFocus
      value={props.value}
      aria-label={props.label ?? "Title"}
      onChange={(event: ChangeEvent<HTMLInputElement>) => props.onChange(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={props.onKeyDown}
      onBlur={props.onBlur}
      // The row opens on click and renames on double-click; neither should fire
      // while the pointer is inside the field it already opened.
      onClick={(event: MouseEvent<HTMLInputElement>) => event.stopPropagation()}
      onDoubleClick={(event: MouseEvent<HTMLInputElement>) => event.stopPropagation()}
      className="min-w-0 flex-1 rounded-sm border border-input bg-card px-1 text-sm font-medium text-card-foreground outline-none focus:border-foreground"
    />
  );
}
