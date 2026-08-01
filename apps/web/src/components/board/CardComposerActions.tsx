import type {
  CardActionAvailability,
  CardOperationKind,
} from "@t3tools/client-runtime/state/boards";
import { ArrowRightIcon, BanIcon, CheckIcon, ChevronDownIcon, RotateCcwIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";

/**
 * Card actions in the composer's primary-action slot, reusing the split-button
 * pattern `ComposerPrimaryActions` already has for `Implement ⌄`. Typing turns
 * the primary into `Send & resume` — chat-to-resume is server-side, so sending
 * is all the client has to do.
 */
export interface CardComposerActionsProps {
  readonly promptHasText: boolean;
  readonly disabled: boolean;
  readonly availability: CardActionAvailability;
  /**
   * The operation the card is under — the server's once it has projected one,
   * this client's own click until then. Every action waits on it, so a card
   * cannot be advanced, retried, or reset twice from one intent.
   */
  readonly operation: CardOperationKind | null;
  /** A paused step can advance from Resume without sending a message. */
  readonly canResumeWithoutMessage: boolean;
  /** `Resume step`: continue a paused card, otherwise put the caret in the composer. */
  readonly onResume: () => void;
  readonly onRetry: () => void;
  readonly onMarkDone: () => void;
  readonly onReset: () => void;
  /** The last step's gate lands in Done rather than the next column. */
  readonly isLastStep: boolean;
}

/** What the primary button says while the card is busy. */
const OPERATION_LABELS: Record<CardOperationKind, string> = {
  starting: "Starting…",
  advancing: "Resuming…",
  retrying: "Retrying…",
  resetting: "Resetting…",
  deleting: "Deleting…",
};

export function CardComposerActions({
  promptHasText,
  disabled,
  availability,
  operation,
  canResumeWithoutMessage,
  onResume,
  onRetry,
  onMarkDone,
  onReset,
  isLastStep,
}: CardComposerActionsProps) {
  const busy = operation !== null;

  if (promptHasText) {
    return (
      <Button
        type="submit"
        size="sm"
        className="h-9 rounded-full px-4 sm:h-8"
        disabled={disabled || busy}
      >
        Send &amp; resume
      </Button>
    );
  }

  return (
    <div data-board-card-actions="true" className="flex items-center justify-end">
      <Button
        type="button"
        size="sm"
        className="h-9 rounded-l-full rounded-r-none px-4 sm:h-8"
        disabled={disabled || busy || !canResumeWithoutMessage}
        onClick={onResume}
      >
        {operation === null ? "Resume" : OPERATION_LABELS[operation]}
      </Button>
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="sm"
              variant="default"
              className="h-9 rounded-l-none rounded-r-full border-l-white/12 px-2 sm:h-8"
              aria-label="Card actions"
              disabled={disabled || busy}
            />
          }
        >
          <ChevronDownIcon className="size-3.5" />
        </MenuTrigger>
        <MenuPopup align="end" side="top" className="w-58">
          <MenuItem onClick={onResume} disabled={busy || !canResumeWithoutMessage}>
            <ArrowRightIcon />
            Resume step
          </MenuItem>
          <MenuItem onClick={onRetry} disabled={busy || !availability.canRetry}>
            <RotateCcwIcon />
            Retry step fresh
          </MenuItem>
          <MenuItem onClick={onMarkDone} disabled={busy || !availability.canContinue}>
            <CheckIcon />
            {isLastStep ? "Mark done, go to Done" : "Mark step done, advance"}
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            variant="destructive"
            onClick={onReset}
            disabled={busy || !availability.canReset}
          >
            <BanIcon />
            Reset card
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  );
}
