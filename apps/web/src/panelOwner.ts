/**
 * Explicit thread/workspace ownership for client panel state stores.
 *
 * Workspace ownership is never encoded as a fabricated ThreadId. Canonical keys
 * come from scopedThreadKey / scopedWorkspaceKey so thread and workspace
 * buckets cannot collide.
 */
import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopedWorkspaceKey,
  type WorkspacePanelRef,
} from "@aqqua/client-runtime/environment";
import type { ScopedThreadRef } from "@aqqua/contracts";
import { isWorkspaceTerminalOwnerThreadId } from "@aqqua/shared/terminalOwner";

const LEGACY_WORKSPACE_OWNER_THREAD_PREFIX = "workspace-root:";

/**
 * Explicit owner of a panel state bucket.
 * Distinguishes a real scoped thread from a scoped workspace.
 */
export type PanelOwner =
  | { readonly type: "thread"; readonly threadRef: ScopedThreadRef }
  | { readonly type: "workspace"; readonly workspaceRef: WorkspacePanelRef };

/**
 * Store APIs accept either an explicit owner or a bare ScopedThreadRef (treated
 * as a thread owner) so existing thread-only call sites keep working.
 */
export type PanelStoreOwner = PanelOwner | ScopedThreadRef;

export function threadPanelOwner(threadRef: ScopedThreadRef): PanelOwner {
  return { type: "thread", threadRef };
}

export function workspacePanelOwner(workspaceRef: WorkspacePanelRef | null): PanelOwner | null {
  if (!workspaceRef) return null;
  return { type: "workspace", workspaceRef };
}

export function resolvePanelOwner(owner: PanelStoreOwner): PanelOwner {
  if ("type" in owner && (owner.type === "thread" || owner.type === "workspace")) {
    return owner;
  }
  return { type: "thread", threadRef: owner };
}

/** Canonical storage / lookup key for a panel owner. */
export function panelOwnerKey(owner: PanelStoreOwner): string {
  const resolved = resolvePanelOwner(owner);
  return resolved.type === "thread"
    ? scopedThreadKey(resolved.threadRef)
    : scopedWorkspaceKey(resolved.workspaceRef);
}

export function originThreadIdForOwner(
  owner: PanelOwner,
  originThreadId: string | undefined,
): string | undefined {
  if (originThreadId !== undefined) return originThreadId;
  return owner.type === "thread" ? owner.threadRef.threadId : undefined;
}

/**
 * Rewrite legacy synthetic workspace ThreadId keys
 * (`env:workspace-root:/path`) to canonical workspace owner keys.
 */
export function migratePanelOwnerStorageKey(key: string): string {
  const parsed = parseScopedThreadKey(key);
  if (!parsed || !isWorkspaceTerminalOwnerThreadId(parsed.threadId)) {
    return key;
  }
  const workspaceRoot = parsed.threadId.slice(LEGACY_WORKSPACE_OWNER_THREAD_PREFIX.length);
  return scopedWorkspaceKey({
    environmentId: parsed.environmentId,
    workspaceRoot,
  });
}

/** Remap keys in a persisted record; first write wins on collisions. */
export function migratePanelOwnerKeyRecord<T>(
  record: Record<string, T> | undefined,
): Record<string, T> {
  if (!record || typeof record !== "object") return {};
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    const migratedKey = migratePanelOwnerStorageKey(key);
    if (!(migratedKey in next)) {
      next[migratedKey] = value;
    }
  }
  return next;
}
