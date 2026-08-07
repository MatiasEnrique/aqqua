import { scopedThreadKey, scopeThreadRef } from "@aqqua/client-runtime/environment";
import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/models";

/**
 * The subset of a worktree group this derivation needs. Narrower than
 * `SidebarWorktreeGroup` so the rule stays testable without building one.
 */
export interface ActiveWorktreeCandidate {
  readonly key: string;
  readonly drafts: readonly { readonly draftId: string }[];
  readonly active: readonly EnvironmentThreadShell[];
  readonly snoozed: readonly EnvironmentThreadShell[];
}

/**
 * Which worktree the workspace is currently pointed at.
 *
 * Derived from the route rather than stored, so deep links, the command
 * palette and notification navigation all select the right card for free —
 * anything that can open a conversation implicitly opens its worktree.
 *
 * The override exists for the one case the route cannot express: clicking a
 * worktree that has nothing to route to yet. It is deliberately weaker than
 * the route, so opening any conversation immediately retires it rather than
 * leaving two competing notions of "selected".
 */
export function resolveActiveWorktreeKey(input: {
  readonly routeThreadKey: string | null;
  readonly routeDraftId: string | null;
  readonly worktreeGroups: readonly ActiveWorktreeCandidate[];
  readonly overrideKey: string | null;
}): string | null {
  const routed = resolveRoutedWorktreeKey(input);
  if (routed !== null) return routed;
  if (input.overrideKey === null) return null;
  // A stale override — its worktree was deleted or settled away — must not
  // keep a card selected that no longer exists.
  return input.worktreeGroups.some((group) => group.key === input.overrideKey)
    ? input.overrideKey
    : null;
}

function resolveRoutedWorktreeKey(input: {
  readonly routeThreadKey: string | null;
  readonly routeDraftId: string | null;
  readonly worktreeGroups: readonly ActiveWorktreeCandidate[];
}): string | null {
  for (const group of input.worktreeGroups) {
    if (
      input.routeDraftId !== null &&
      group.drafts.some((draft) => draft.draftId === input.routeDraftId)
    ) {
      return group.key;
    }
    if (input.routeThreadKey === null) continue;
    const holdsThread = (thread: EnvironmentThreadShell) =>
      scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === input.routeThreadKey;
    if (group.active.some(holdsThread) || group.snoozed.some(holdsThread)) {
      return group.key;
    }
  }
  return null;
}
