import { Fragment, type ReactNode, useState } from "react";

import { cn } from "~/lib/utils";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxPopup,
  ComboboxValue,
} from "../ui/combobox";

/**
 * Shared sidebar scope control used by both project and flow filters. Empty
 * selection means "all"; callers own only the item-specific chip and popup
 * content so the field's interaction and visual treatment cannot drift.
 */
export function SidebarScopePicker<Item>(props: {
  readonly items: readonly Item[];
  readonly chosenItems: readonly Item[];
  readonly itemKey: (item: Item) => string;
  readonly itemLabel: (item: Item) => string;
  readonly icon: ReactNode;
  readonly testId: string;
  readonly inputLabel: string;
  readonly allItemsLabel: string;
  readonly onSelectionChange: (items: readonly Item[]) => void;
  readonly renderChip: (item: Item) => ReactNode;
  readonly renderPopup: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Combobox<Item, true>
      multiple
      autoHighlight
      open={open}
      onOpenChange={setOpen}
      items={[...props.items]}
      itemToStringLabel={props.itemLabel}
      value={[...props.chosenItems]}
      onValueChange={props.onSelectionChange}
    >
      <ComboboxChips
        data-testid={props.testId}
        className={cn(
          "min-h-8 gap-1 rounded-md border-transparent bg-transparent p-1.5 shadow-none",
          "transition-colors hover:bg-sidebar-row-hover",
          "sm:min-h-8 dark:not-has-disabled:bg-transparent dark:hover:not-has-disabled:bg-sidebar-row-hover",
          "before:hidden focus-within:border-transparent focus-within:ring-2 focus-within:ring-ring",
        )}
      >
        <span
          aria-hidden
          className="flex shrink-0 items-center ps-1 pe-1 text-sidebar-muted-foreground/80"
        >
          {props.icon}
        </span>
        <ComboboxValue>
          {(chosenItems: Item[]) => (
            <Fragment>
              {chosenItems.map((item) => (
                <ComboboxChip
                  key={props.itemKey(item)}
                  aria-label={props.itemLabel(item)}
                  className="flex items-center gap-[5px] rounded-md bg-sidebar-control-surface ps-1 text-xs font-medium text-sidebar-foreground outline-none [&_svg:not([class*='size-'])]:size-3"
                >
                  {props.renderChip(item)}
                </ComboboxChip>
              ))}
              <ComboboxChipsInput
                aria-label={props.inputLabel}
                placeholder={chosenItems.length === 0 ? props.allItemsLabel : ""}
                className="min-w-16 bg-transparent ps-1 text-sm font-medium text-sidebar-foreground placeholder:text-sidebar-muted-foreground/80 sm:text-sm"
              />
            </Fragment>
          )}
        </ComboboxValue>
      </ComboboxChips>
      <ComboboxPopup className="bg-popover backdrop-blur-none">
        {props.renderPopup(() => setOpen(false))}
      </ComboboxPopup>
    </Combobox>
  );
}
