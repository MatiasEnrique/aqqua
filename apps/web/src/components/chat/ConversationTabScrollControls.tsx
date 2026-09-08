import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  nudgeConversationTabStrip,
  useConversationTabStripScroll,
} from "./conversationTabStripScroll";

/**
 * The paging arrows for the conversation tab strip.
 *
 * They live in the sidebar's titlebar corner rather than in the strip itself:
 * on desktop the traffic lights already push that row down, leaving the corner
 * free, and the strip's own room is better spent on tabs. Both directions stay
 * under one cursor position, and each arrow dims at the end it can no longer
 * travel toward.
 *
 * The controls render nothing when no strip is mounted — settings and usage
 * have no tabs to page.
 */
export function ConversationTabScrollControls(props: { readonly className?: string }) {
  const strip = useConversationTabStripScroll();
  if (!strip.present) return null;

  return (
    <div className={cn("flex shrink-0 items-center", props.className)}>
      <TabStripArrow
        label="Scroll tabs left"
        icon={<ChevronLeftIcon aria-hidden className="size-4" />}
        disabled={!strip.canScrollStart}
        onClick={() => nudgeConversationTabStrip(-1)}
      />
      <TabStripArrow
        label="Scroll tabs right"
        icon={<ChevronRightIcon aria-hidden className="size-4" />}
        disabled={!strip.canScrollEnd}
        onClick={() => nudgeConversationTabStrip(1)}
      />
    </div>
  );
}

function TabStripArrow(props: {
  readonly label: string;
  readonly icon: ReactNode;
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={props.label}
            disabled={props.disabled}
            onClick={props.onClick}
            className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-(--duration-fast) ease-(--ease-fluid) hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35 [-webkit-app-region:no-drag]"
          />
        }
      >
        {props.icon}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
    </Tooltip>
  );
}
