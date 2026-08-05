import { memo } from "react";
import {
  SidebarCardHoverActionSlot,
  SidebarCardUpdatedAt,
  SidebarCardWakeButton,
  SidebarCardWakesAt,
} from "../../sidebar/card";
import { threadTimeLabel } from "../rowTimeLabels";
import { SidebarSummaryStateLabel } from "../SidebarStatusPresentations";
import { ConversationCompactRow } from "./ConversationCompactRow";
import { useConversationRow, type ConversationRowProps } from "./useConversationRow";

export interface ConversationSnoozedRowProps extends ConversationRowProps {
  /** Compact wake countdown ("2h") for rows in the snoozed shelf. */
  readonly snoozeWakeLabelText: string | null;
}

/**
 * A snoozed conversation: parked, not finished. It keeps both clocks — when it
 * last moved and when it comes back — and the one action that matters, waking
 * it early.
 */
export const ConversationSnoozedRow = memo(function ConversationSnoozedRow(
  props: ConversationSnoozedRowProps,
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
          resting={<SidebarSummaryStateLabel state={row.summaryState} className="text-[11px]" />}
          actions={
            props.snoozeSupported ? (
              <SidebarCardWakeButton onWake={row.handleUnsnoozeClick} />
            ) : null
          }
        />
      }
    >
      <SidebarCardUpdatedAt label={threadTimeLabel(props.thread)} />
      {props.snoozeWakeLabelText === null ? null : (
        <SidebarCardWakesAt label={props.snoozeWakeLabelText} />
      )}
    </ConversationCompactRow>
  );
});
