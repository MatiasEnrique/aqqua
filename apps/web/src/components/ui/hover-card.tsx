import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card";

import { cn } from "~/lib/utils";

const HoverCard = PreviewCardPrimitive.Root;

function HoverCardTrigger(props: PreviewCardPrimitive.Trigger.Props) {
  return <PreviewCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />;
}

function HoverCardPopup({
  children,
  className,
  viewportClassName,
  side = "right",
  align = "start",
  sideOffset = 8,
  alignOffset = 0,
  ...props
}: PreviewCardPrimitive.Popup.Props & {
  viewportClassName?: string;
  side?: PreviewCardPrimitive.Positioner.Props["side"];
  align?: PreviewCardPrimitive.Positioner.Props["align"];
  sideOffset?: PreviewCardPrimitive.Positioner.Props["sideOffset"];
  alignOffset?: PreviewCardPrimitive.Positioner.Props["alignOffset"];
}) {
  return (
    <PreviewCardPrimitive.Portal>
      <PreviewCardPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        className="z-[60] h-(--positioner-height) w-(--positioner-width) max-w-(--available-width) transition-transform data-instant:transition-none"
        data-slot="hover-card-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <PreviewCardPrimitive.Popup
          className={cn(
            "dropdown-glass relative flex h-(--popup-height,auto) w-(--popup-width,auto) origin-(--transform-origin) rounded-xl text-popover-foreground outline-none shadow-xl shadow-black/25 transition-[width,height,scale,opacity] data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0",
            className,
          )}
          data-slot="hover-card-popup"
          {...props}
        >
          <PreviewCardPrimitive.Viewport
            className={cn(
              "relative size-full max-h-(--available-height) overflow-clip p-3 data-instant:transition-none",
              viewportClassName,
            )}
            data-slot="hover-card-viewport"
          >
            {children}
          </PreviewCardPrimitive.Viewport>
        </PreviewCardPrimitive.Popup>
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  );
}

export { HoverCard, HoverCardPopup, HoverCardTrigger };
