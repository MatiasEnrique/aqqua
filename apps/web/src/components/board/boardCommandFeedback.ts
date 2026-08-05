import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@aqqua/client-runtime/state/runtime";

import { stackedThreadToast, toastManager } from "../ui/toast";

export function boardCommandFailureDescription(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (typeof error === "string" && error.trim().length > 0) return error;
  if (typeof error === "object" && error !== null) {
    const message = (error as { readonly message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) return message;
    const detail = (error as { readonly detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim().length > 0) return detail;
  }
  return "The server rejected the command without a reason.";
}

/** Report a typed command failure and tell the caller whether it may close its dialog. */
export function reportBoardCommandResult<A, E>(
  result: AtomCommandResult<A, E>,
  failureTitle: string,
): boolean {
  if (result._tag === "Success") return true;
  const description = isAtomCommandInterrupted(result)
    ? "The command was interrupted before it completed. Try again."
    : boardCommandFailureDescription(squashAtomCommandFailure(result));
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title: failureTitle,
      description,
    }),
  );
  return false;
}
