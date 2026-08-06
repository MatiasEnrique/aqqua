import { squashAtomCommandFailure } from "@aqqua/client-runtime/state/runtime";

/**
 * Turns a failed change-request command into a message for inline display.
 * Provider errors carry their own detail, so the fallback only covers a
 * non-Error defect.
 */
export function changeRequestFailureMessage(
  result: { readonly cause: Parameters<typeof squashAtomCommandFailure>[0]["cause"] },
  fallback: string,
): string {
  const cause = squashAtomCommandFailure(result);
  return cause instanceof Error ? cause.message : fallback;
}
