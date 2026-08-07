type SidebarTreeThread = {
  readonly id: string;
  readonly parentThreadId?: string | null | undefined;
};

export type SidebarThreadSection = "active" | "snoozed" | "settled";

/** Settling an orchestrator moves its active descendants with it. */
export function inheritSettledFromOrchestrators<T extends SidebarTreeThread>(input: {
  threads: readonly T[];
  classify: (thread: T) => SidebarThreadSection;
}): Map<string, SidebarThreadSection> {
  const { classify, threads } = input;
  const byId = new Map(threads.map((thread) => [thread.id, thread] as const));
  const ownSection = new Map(threads.map((thread) => [thread.id, classify(thread)] as const));
  const resolved = new Map<string, SidebarThreadSection>();

  const resolve = (thread: T): SidebarThreadSection => {
    const cached = resolved.get(thread.id);
    if (cached !== undefined) return cached;
    const own = ownSection.get(thread.id) ?? "active";
    resolved.set(thread.id, own);
    if (own !== "active") return own;

    const parentId = thread.parentThreadId ?? null;
    const parent = parentId === null || parentId === thread.id ? undefined : byId.get(parentId);
    const section = parent !== undefined && resolve(parent) === "settled" ? "settled" : own;
    resolved.set(thread.id, section);
    return section;
  };

  for (const thread of threads) resolve(thread);
  return resolved;
}
