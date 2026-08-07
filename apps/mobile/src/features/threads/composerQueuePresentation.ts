/**
 * Synthetic prompt the composer substitutes when a message carries only images.
 * It is an instruction to the provider, never something to show the user.
 */
export const IMAGE_ONLY_BOOTSTRAP_PROMPT =
  "[User attached one or more images without additional text. Respond using the conversation context and the attached image(s).]";

export function queuedMessagePreview(message: {
  readonly text: string;
  readonly attachmentCount: number;
}): string {
  const text = message.text.trim();
  if (text.length > 0 && text !== IMAGE_ONLY_BOOTSTRAP_PROMPT) {
    return text;
  }
  return message.attachmentCount === 1 ? "1 image" : `${message.attachmentCount} images`;
}

export interface ComposerPrimaryActionState {
  readonly showStop: boolean;
  readonly showQueue: boolean;
  readonly sendDisabled: boolean;
  readonly queueDisabled: boolean;
  readonly sendLabel: string;
}

/**
 * A running turn keeps its stop control no matter what else is on the bar, and
 * only a running turn can offer "queue" — an idle thread has nothing to queue
 * behind, so the message would just be a send.
 */
export function resolveComposerPrimaryActions(input: {
  /** The thread's provider session is running or starting. */
  readonly turnRunning: boolean;
  /**
   * The thread is occupied from the caller's perspective, which can lead the
   * session status — it is what decides whether a send reads as a steer.
   */
  readonly threadBusy: boolean;
  readonly messageQueueSupported: boolean;
  readonly hasSendableContent: boolean;
}): ComposerPrimaryActionState {
  return {
    showStop: input.turnRunning,
    showQueue: input.turnRunning && input.messageQueueSupported,
    sendDisabled: !input.hasSendableContent,
    queueDisabled: !input.hasSendableContent,
    sendLabel: input.threadBusy ? "Steer" : "Send",
  };
}
