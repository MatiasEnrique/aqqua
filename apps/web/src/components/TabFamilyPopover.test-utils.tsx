import type { ReactElement, ReactNode } from "react";

interface MockPopoverItem {
  readonly key: string;
  readonly label: string;
  readonly leading: ReactNode;
  readonly trailing?: ReactNode;
  readonly active: boolean;
}

interface MockCountTriggerProps {
  readonly label: string;
  readonly count: number;
  readonly active: boolean;
  readonly markerAttributes: Readonly<
    Record<`data-${string}`, string | number | boolean | undefined>
  >;
}

export function createTabFamilyPopoverMock() {
  const TabFamilyCountIcon = () => <span aria-hidden>family</span>;
  return {
    TabFamilyCountIcon,
    TabFamilyCountTrigger: (props: MockCountTriggerProps) => (
      <button
        type="button"
        aria-label={props.label}
        data-tab-family-count-active={props.active}
        {...props.markerAttributes}
      >
        <TabFamilyCountIcon />
        {props.count}
      </button>
    ),
    TabFamilyPopover: (props: {
      readonly trigger: ReactElement;
      readonly items: readonly MockPopoverItem[];
    }) => (
      <>
        {props.trigger}
        <div data-tab-family-popover>
          {props.items.map((item) => (
            <span
              key={item.key}
              data-tab-family-popover-item={item.key}
              aria-current={item.active ? "page" : undefined}
            >
              {item.leading}
              {item.label}
              {item.trailing === undefined ? null : (
                <span data-tab-family-item-trailing>{item.trailing}</span>
              )}
            </span>
          ))}
        </div>
      </>
    ),
  };
}
