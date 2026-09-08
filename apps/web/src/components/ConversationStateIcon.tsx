import { CircleAlertIcon, CircleCheckIcon, CircleIcon, Clock3Icon } from "lucide-react";

import type { ConversationStateKey } from "./conversationStatePresentation";

/** The same conversation status glyph in the sidebar and its open tab. */
export function ConversationStateIcon({
  state,
  snoozed = false,
}: {
  state: ConversationStateKey;
  snoozed?: boolean;
}) {
  const Icon =
    snoozed || state === "working"
      ? Clock3Icon
      : state === "done"
        ? CircleCheckIcon
        : state === "failed" || state === "approval" || state === "input" || state === "needsInput"
          ? CircleAlertIcon
          : CircleIcon;
  return <Icon aria-hidden className="size-3.5 shrink-0" />;
}
