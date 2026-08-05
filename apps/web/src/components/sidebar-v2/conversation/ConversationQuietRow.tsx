import { AlarmClockIcon } from "lucide-react";
import { memo } from "react";
import { SidebarCardHoverActionSlot, SidebarCardSettleButton } from "../../sidebar/card";
import { threadTimeLabel } from "../rowTimeLabels";
import { ConversationCompactRow } from "./ConversationCompactRow";
import { useConversationRow, type ConversationRowProps } from "./useConversationRow";

/**
 * A conversation you've already seen that is still open: quiet, but not
 * history. It shows when it last moved and offers the one thing left to do —
 * settle it — so the inbox drains without a trip to the context menu.
 */
export const ConversationQuietRow = memo(function ConversationQuietRow(
  props: ConversationRowProps,
) {
  const row = useConversationRow(props);
  return (
    <ConversationCompactRow
      row={row}
      conversation={props}
      testId="sidebar-v2-row-slim"
      trailing={
        <SidebarCardHoverActionSlot
          reserveWidth
          resting={
            row.isWoke ? (
              // A wake can land straight in the settled tail (e.g. PR merged
              // while snoozed); the signal must survive the trip.
              <span
                role="img"
                aria-label="Woke from snooze"
                className="inline-flex items-center gap-1 text-warning-foreground text-xs font-medium"
              >
                <AlarmClockIcon aria-hidden className="size-3" />
                Woke
              </span>
            ) : (
              <span className="text-xs text-muted-foreground/55">
                {threadTimeLabel(props.thread)}
              </span>
            )
          }
          actions={
            props.settlementSupported ? (
              <SidebarCardSettleButton
                description={props.thread.title}
                onSettle={row.handleSettleClick}
                shape="inline"
              />
            ) : null
          }
        />
      }
    />
  );
});
