import { scopeProjectRef } from "@aqqua/client-runtime/environment";
import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@aqqua/contracts";
import type { DraftThreadEnvMode } from "../composerDraftStore";

interface ThreadContextLike {
  environmentId: EnvironmentId;
  projectId: ProjectId;
}

interface NewThreadHandler {
  (
    projectRef: ScopedProjectRef,
    options?: {
      branch?: string | null;
      worktreePath?: string | null;
      envMode?: DraftThreadEnvMode;
      startFromOrigin?: boolean;
    },
  ): Promise<void>;
}

type NewThreadOptions = NonNullable<Parameters<NewThreadHandler>[1]>;

interface ConversationTabWorktreeContext extends ThreadContextLike {
  readonly isProjectCheckout: boolean;
  readonly label: string;
  readonly workspaceRoot: string | null;
}

export type ConversationTabNewThreadAction =
  | {
      readonly _tag: "create";
      readonly projectRef: ScopedProjectRef;
      readonly options?: NewThreadOptions;
    }
  | { readonly _tag: "choose-project" };

export interface ChatThreadActionContext {
  readonly activeDraftThread: ThreadContextLike | null;
  readonly activeThread: ThreadContextLike | undefined;
  readonly defaultProjectRef: ScopedProjectRef | null;
  readonly handleNewThread: NewThreadHandler;
}

export function resolveNewDraftStartFromOrigin(input: {
  envMode: DraftThreadEnvMode;
  newWorktreesStartFromOrigin: boolean;
}): boolean {
  return input.envMode === "worktree" && input.newWorktreesStartFromOrigin;
}

export function resolveThreadActionProjectRef(
  context: ChatThreadActionContext,
): ScopedProjectRef | null {
  if (context.activeThread) {
    return scopeProjectRef(context.activeThread.environmentId, context.activeThread.projectId);
  }
  if (context.activeDraftThread) {
    return scopeProjectRef(
      context.activeDraftThread.environmentId,
      context.activeDraftThread.projectId,
    );
  }
  return context.defaultProjectRef;
}

/**
 * Resolve the tab strip's `+` from the workspace selection itself.
 *
 * The worktree wins over the routed conversation because a worktree can be
 * selected before it contains a conversation. Falling back to the routed
 * project preserves the same behavior outside a selected worktree, while the
 * final state deliberately asks instead of creating an unscoped draft.
 */
export function resolveConversationTabNewThreadAction(input: {
  readonly activeProjectRef: ScopedProjectRef | null;
  readonly activeWorktree: ConversationTabWorktreeContext | null;
}): ConversationTabNewThreadAction {
  if (input.activeWorktree) {
    const projectRef = scopeProjectRef(
      input.activeWorktree.environmentId,
      input.activeWorktree.projectId,
    );
    if (!input.activeWorktree.isProjectCheckout && input.activeWorktree.workspaceRoot === null) {
      return { _tag: "create", projectRef };
    }
    return {
      _tag: "create",
      projectRef,
      options: {
        branch: input.activeWorktree.label,
        worktreePath: input.activeWorktree.isProjectCheckout
          ? null
          : input.activeWorktree.workspaceRoot,
        envMode: input.activeWorktree.isProjectCheckout ? "local" : "worktree",
        startFromOrigin: false,
      },
    };
  }
  if (input.activeProjectRef) {
    return { _tag: "create", projectRef: input.activeProjectRef };
  }
  return { _tag: "choose-project" };
}

// New threads inherit only the *project* from the current context. Branch,
// worktree, and env mode always come from the user's configured defaults —
// carrying them over from the viewed thread meant "new thread" silently
// reused checkouts and branches. Explicit affordances (branch toolbar's
// "new thread in this worktree") pass those options to handleNewThread
// directly instead.
export async function startNewThreadFromContext(
  context: ChatThreadActionContext,
): Promise<boolean> {
  const projectRef = resolveThreadActionProjectRef(context);
  if (!projectRef) {
    return false;
  }

  await context.handleNewThread(projectRef);
  return true;
}
