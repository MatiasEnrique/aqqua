import type { OrchestrationQueuedMessage } from "@aqqua/contracts";
import { ArrowUpIcon, XIcon } from "lucide-react";
import { memo } from "react";

import { Button } from "../ui/button";
import {
  ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
  LEGACY_IMAGE_ONLY_BOOTSTRAP_PROMPT,
} from "../ChatView.logic";

export const queuedMessagePreview = (message: OrchestrationQueuedMessage) => {
  const text = message.text.trim();
  if (
    text.length > 0 &&
    text !== ATTACHMENT_ONLY_BOOTSTRAP_PROMPT &&
    text !== LEGACY_IMAGE_ONLY_BOOTSTRAP_PROMPT
  ) {
    return text;
  }
  const attachmentCount = message.attachments.length;
  return attachmentCount === 1 ? "1 attachment" : `${attachmentCount} attachments`;
};

export const ComposerMessageQueue = memo(function ComposerMessageQueue(props: {
  messages: ReadonlyArray<OrchestrationQueuedMessage>;
  onDequeue: (messageId: OrchestrationQueuedMessage["messageId"]) => void;
  onSubmit: (messageIds: ReadonlyArray<OrchestrationQueuedMessage["messageId"]>) => void;
  submitSupported: boolean;
}) {
  if (props.messages.length === 0) {
    return null;
  }

  return (
    <div className="rounded-t-[var(--chat-composer-inner-radius,9px)] border-b border-border/65 bg-muted/20 px-3 py-2 sm:px-4">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">
          Queued · {props.messages.length}
        </span>
        {props.submitSupported && props.messages.length > 1 ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => props.onSubmit(props.messages.map((message) => message.messageId))}
          >
            Send all
          </Button>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        {props.messages.map((message) => (
          <div
            key={message.messageId}
            className="flex min-w-0 items-center gap-2 rounded-md border border-border/55 bg-background/65 py-1 pl-2.5 pr-1"
          >
            <span className="min-w-0 flex-1 truncate text-xs">{queuedMessagePreview(message)}</span>
            {props.submitSupported ? (
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => props.onSubmit([message.messageId])}
                aria-label={`Steer with queued message: ${queuedMessagePreview(message)}`}
              >
                <ArrowUpIcon className="size-3" aria-hidden="true" />
              </Button>
            ) : null}
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => props.onDequeue(message.messageId)}
              aria-label={`Remove queued message: ${queuedMessagePreview(message)}`}
            >
              <XIcon className="size-3" aria-hidden="true" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
});
