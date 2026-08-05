import { AlarmClockIcon, CircleCheckIcon } from "lucide-react";
import { memo } from "react";
import { cn } from "~/lib/utils";
import {
  SidebarCardDeleteButton,
  SidebarCardHoverActionSlot,
  SidebarCardSubThreadToggle,
  SidebarCardUnsettleButton,
} from "../../sidebar/card";
import { Checkbox } from "../../ui/checkbox";
import { settledTimeLabel } from "../rowTimeLabels";
import { SIDEBAR_STATE_PRESENTATIONS } from "../SidebarStatusPresentations";
import { ConversationCompactRow } from "./ConversationCompactRow";
import { useConversationRow, type ConversationRowProps } from "./useConversationRow";

/**
 * A settled conversation: history, and the only row you can select in bulk.
 * Settled rows are also where you prune, so delete sits next to un-settle
 * rather than only in the context menu.
 */
export const ConversationSettledRow = memo(function ConversationSettledRow(
  props: ConversationRowProps,
) {
  const row = useConversationRow(props);
  const { thread } = props;
  return (
    <ConversationCompactRow
      row={row}
      conversation={props}
      testId="sidebar-v2-row-slim"
      settledPr
      faviconFallback
      leading={
        <>
          <Checkbox
            data-thread-selection-safe
            aria-label={`Select ${thread.title}`}
            checked={row.isSelected}
            onCheckedChange={row.handleSelectionCheckedChange}
            className="size-4 shrink-0 opacity-65 transition-opacity group-hover/v2-row:opacity-100 data-checked:opacity-100"
          />
          <SidebarCardSubThreadToggle
            count={props.childCount}
            isExpanded={props.isExpanded}
            description={thread.title}
            onToggle={row.handleToggleExpanded}
            testId={`sidebar-v2-subagent-toggle-${thread.id}`}
          />
        </>
      }
      trailing={
        <SidebarCardHoverActionSlot
          reserveWidth
          resting={
            <span
              role="img"
              aria-label={`Settled ${settledTimeLabel(thread)}${row.isWoke ? ", woke from snooze" : ""}`}
              title={row.isWoke ? "Settled · Woke from snooze" : "Settled"}
              className={cn(
                "inline-flex items-center gap-1 text-xs",
                SIDEBAR_STATE_PRESENTATIONS.settled.className,
              )}
            >
              <CircleCheckIcon aria-hidden className="size-3.5" />
              <span className="text-muted-foreground/55">{settledTimeLabel(thread)}</span>
              {row.isWoke ? (
                <AlarmClockIcon aria-hidden className="size-3 text-warning-foreground" />
              ) : null}
            </span>
          }
          actions={
            <>
              {/* Deletion needs no server capability, so it renders even where
                  settlement is unsupported. */}
              <SidebarCardDeleteButton onDelete={row.handleDeleteClick} />
              {props.settlementSupported ? (
                <SidebarCardUnsettleButton onUnsettle={row.handleUnsettleClick} />
              ) : null}
            </>
          }
        />
      }
    />
  );
});
