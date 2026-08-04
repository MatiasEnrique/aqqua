import type { SidebarConversationStateCounts } from "../Sidebar.summaryState";
import { ConversationCardRow } from "./conversation/ConversationCardRow";
import { ConversationQuietRow } from "./conversation/ConversationQuietRow";
import { ConversationSettledRow } from "./conversation/ConversationSettledRow";
import { ConversationSnoozedRow } from "./conversation/ConversationSnoozedRow";
import { ConversationSubRow } from "./conversation/ConversationSubRow";
import type { ConversationRowProps } from "./conversation/useConversationRow";

export interface SidebarConversationRowProps extends ConversationRowProps {
  /**
   * Which row this thread has earned. "sub" is a card's descendant; "slim" has
   * stepped out of the inbox, and `variantAction` says which way.
   */
  readonly variant: "card" | "slim" | "sub";
  readonly variantAction: "settle" | "unsettle" | "unsnooze";
  readonly subAgentStateCounts: SidebarConversationStateCounts | null;
  readonly reserveExpandGutter: boolean;
  readonly snoozeWakeLabelText: string | null;
}

/**
 * Picks the row a thread gets. Each row below composes the same kit of parts —
 * description, provider, timestamp, sub-threads, actions — so this stays a
 * routing decision rather than one component that branches on itself.
 */
export function SidebarConversationRow(props: SidebarConversationRowProps) {
  if (props.variant === "sub") {
    return <ConversationSubRow {...props} />;
  }
  if (props.variant === "card") {
    return <ConversationCardRow {...props} />;
  }
  if (props.variantAction === "unsettle") {
    return <ConversationSettledRow {...props} />;
  }
  if (props.variantAction === "unsnooze") {
    return <ConversationSnoozedRow {...props} />;
  }
  return <ConversationQuietRow {...props} />;
}
