import type { ReactElement, ReactNode } from "react";
import { useState } from "react";

import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "./ui/popover";
import { cn } from "~/lib/utils";

export interface TabFamilyPopoverItem {
  readonly key: string;
  readonly label: string;
  readonly leading: ReactNode;
  readonly trailing?: ReactNode;
  readonly active: boolean;
  readonly onSelect: () => void;
}

/**
 * The bounded descendant picker shared by conversation and flow
 * tabs. Descendants never enter the horizontal strip; the trigger is their one
 * compact representative and the popover is their scalable navigation surface.
 */
export function TabFamilyPopover(props: {
  readonly title: string;
  readonly trigger: ReactElement;
  readonly items: readonly TabFamilyPopoverItem[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={props.trigger} />
      <PopoverContent
        align="start"
        className="w-72"
        viewportClassName="max-h-72 p-1.5 [--viewport-inline-padding:0px]"
      >
        <PopoverTitle className="px-2 py-1.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground/55">
          {props.title}
        </PopoverTitle>
        <div className="space-y-0.5">
          {props.items.map((item) => (
            <button
              key={item.key}
              type="button"
              data-tab-family-popover-item={item.key}
              aria-current={item.active ? "page" : undefined}
              className={cn(
                "flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring",
                item.active
                  ? "bg-foreground/[0.06] font-semibold text-foreground"
                  : "text-muted-foreground",
              )}
              onClick={() => {
                item.onSelect();
                setOpen(false);
              }}
            >
              {item.leading}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.trailing === undefined ? null : (
                <span className="shrink-0 text-[10px] text-muted-foreground/70 tabular-nums">
                  {item.trailing}
                </span>
              )}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The shared fan-out mark used by both descendant-count triggers. */
export function TabFamilyCountIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="size-[9px] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
    >
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
    </svg>
  );
}
