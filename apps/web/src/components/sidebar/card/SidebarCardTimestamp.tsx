import { cn } from "~/lib/utils";

/**
 * When a row last moved. The label is pre-formatted by the caller so the
 * component never re-derives "now" — rows that tick do it through their own
 * subscription, and rows that don't stay pure.
 *
 * Hidden on a narrow sidebar: the status and the description outrank it.
 */
export function SidebarCardUpdatedAt(props: {
  readonly label: string;
  /** Omit for a bare timestamp (the settled tail, where the row is history). */
  readonly prefix?: string | null;
  readonly className?: string;
}) {
  const prefix = props.prefix === undefined ? "Updated" : props.prefix;
  return (
    <span
      className={cn(
        "shrink-0 leading-none text-muted-foreground/45 tabular-nums @max-[300px]/sidebar-conversations:hidden",
        props.className,
      )}
    >
      {prefix === null ? props.label : `${prefix} ${props.label}`}
    </span>
  );
}

/** When a snoozed row comes back. Same slot, different clock. */
export function SidebarCardWakesAt(props: { readonly label: string }) {
  return (
    <span className="shrink-0 text-[11px] text-info-foreground/75 @max-[300px]/sidebar-conversations:hidden">
      Wakes {props.label}
    </span>
  );
}
