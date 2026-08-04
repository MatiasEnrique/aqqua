import type { ComponentType } from "react";
import { AqquaBreathingStateIcon, AqquaRestingStateIcon } from "./AqquaWave";

export type ConversationStateKey =
  | "working"
  | "approval"
  | "input"
  | "needsInput"
  | "planReady"
  | "done"
  | "failed"
  | "stale"
  | "settled";

export type ConversationStateIcon = ComponentType<{
  readonly className?: string;
  readonly "aria-hidden"?: boolean;
}>;

export interface ConversationStatePresentation {
  readonly label: string;
  readonly description: string;
  readonly icon: ConversationStateIcon;
  readonly className: string;
}

export const CONVERSATION_STATE_PRESENTATIONS: Record<
  ConversationStateKey,
  ConversationStatePresentation
> = {
  working: {
    label: "Working",
    description: "An agent session is running.",
    icon: AqquaBreathingStateIcon,
    className: "text-sky-600 dark:text-sky-400",
  },
  approval: {
    label: "Pending Approval",
    description: "A tool call is waiting for your approval.",
    icon: AqquaBreathingStateIcon,
    className: "text-amber-600 dark:text-amber-300",
  },
  input: {
    label: "Awaiting Input",
    description: "The agent asked a question and is waiting for your reply.",
    icon: AqquaBreathingStateIcon,
    className: "text-indigo-600 dark:text-indigo-300",
  },
  needsInput: {
    label: "Needs input",
    description: "Waiting for your reply or approval.",
    icon: AqquaBreathingStateIcon,
    className: "text-amber-600 dark:text-amber-300",
  },
  planReady: {
    label: "Plan Ready",
    description: "A proposed plan is ready for you to act on.",
    icon: AqquaBreathingStateIcon,
    className: "text-violet-600 dark:text-violet-300",
  },
  done: {
    label: "Done",
    description: "Completed or ready, still in the active list.",
    icon: AqquaRestingStateIcon,
    className: "text-emerald-600 dark:text-emerald-300",
  },
  failed: {
    label: "Failed",
    description: "The session or its latest turn errored or was interrupted.",
    icon: AqquaRestingStateIcon,
    className: "text-red-600 dark:text-red-400",
  },
  stale: {
    label: "Stale",
    description: "A draft, interrupted turn, or failed session.",
    icon: AqquaRestingStateIcon,
    className: "text-muted-foreground/60",
  },
  settled: {
    label: "Settled",
    description: "Stored in the shared Settled section.",
    icon: AqquaRestingStateIcon,
    className: "text-yellow-600 dark:text-yellow-300",
  },
};

export function conversationStatePresentation(
  state: ConversationStateKey,
): ConversationStatePresentation {
  return CONVERSATION_STATE_PRESENTATIONS[state];
}
