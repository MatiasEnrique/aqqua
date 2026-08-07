import type { ConversationStateKey } from "./conversationStatePresentation";
import { CONVERSATION_STATE_PRESENTATIONS } from "./conversationStatePresentation";
import { cn } from "~/lib/utils";
import type { ReactNode } from "react";

const LIVE_STATES: ReadonlySet<ConversationStateKey> = new Set([
  "working",
  "approval",
  "input",
  "needsInput",
  "planReady",
]);

/**
 * The one status glyph used across conversations, worktrees, flow cards,
 * flow-step tabs, and live timeline rows.
 *
 * Active states use the app's stepped opacity pulse. It updates infrequently
 * instead of continuously rotating/repainting, which keeps a busy sidebar
 * cheap on high-refresh displays.
 */
export function StatusIndicator(props: {
  readonly state?: ConversationStateKey;
  readonly size?: string;
  readonly className?: string;
  readonly label?: string;
  readonly showLabel?: boolean;
  readonly pulse?: boolean;
  readonly glyph?: ReactNode;
}) {
  const presentation =
    props.state === undefined ? null : CONVERSATION_STATE_PRESENTATIONS[props.state];
  const label = props.label ?? presentation?.label ?? "Status";
  const pulse = props.pulse ?? (props.state === undefined ? false : LIVE_STATES.has(props.state));

  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 items-center gap-1",
        presentation?.className,
        props.className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "shrink-0",
          props.glyph === undefined && "rounded-full bg-current",
          props.glyph === undefined ? (props.size ?? "size-2") : undefined,
          pulse && "animate-status-pulse motion-reduce:animate-none",
        )}
      >
        {props.glyph}
      </span>
      {props.showLabel ? (
        <span aria-hidden className="leading-none">
          {label}
        </span>
      ) : null}
    </span>
  );
}
