export type ConversationSurfaceTarget =
  | { readonly kind: "index" }
  | {
      readonly kind: "thread";
      readonly environmentId: string;
      readonly threadId: string;
    }
  | { readonly kind: "draft"; readonly draftId: string };

export type SidebarSurface = "threads" | "flows";

export function resolveDisplayedSidebarSurface(
  routeSurface: SidebarSurface,
  pendingSurface: SidebarSurface | null,
): SidebarSurface {
  return pendingSurface ?? routeSurface;
}

export function requestSidebarSurfaceNavigation(input: {
  readonly surface: SidebarSurface;
  readonly setPendingSurface: (surface: SidebarSurface) => void;
  readonly afterPaint: (navigate: () => void) => void;
  readonly navigate: () => void;
}): void {
  input.setPendingSurface(input.surface);
  input.afterPaint(input.navigate);
}

export function resolveConversationSurfaceTarget(
  input: {
    readonly isBoard: boolean;
    readonly params: Partial<Record<"environmentId" | "threadId" | "draftId", string | undefined>>;
  },
  previous: ConversationSurfaceTarget,
): ConversationSurfaceTarget {
  if (input.isBoard) return previous;

  if (input.params.environmentId && input.params.threadId) {
    return {
      kind: "thread",
      environmentId: input.params.environmentId,
      threadId: input.params.threadId,
    };
  }

  if (input.params.draftId) {
    return { kind: "draft", draftId: input.params.draftId };
  }

  return { kind: "index" };
}
