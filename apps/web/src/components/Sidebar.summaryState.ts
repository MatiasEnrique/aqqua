export {
  classifyThreadPresentation,
  hasUnseenCompletion,
  resolveSidebarConversationSummaryState,
  resolveSidebarV2Status,
  toConversationSummaryState,
  toSidebarV2Status,
  type SidebarConversationSummaryState,
  type SidebarV2Status,
  type ThreadPresentationInput,
  type ThreadPresentationPhase,
  type ThreadPresentationState,
} from "./sidebar-v2/threadPresentationState";

export interface SidebarConversationStateCounts {
  working: number;
  needsInput: number;
  done: number;
  stale: number;
  settled: number;
}

export type SidebarConversationCountedState = keyof SidebarConversationStateCounts;

export function createEmptySidebarConversationStateCounts(): SidebarConversationStateCounts {
  return {
    working: 0,
    needsInput: 0,
    done: 0,
    stale: 0,
    settled: 0,
  };
}

export function resolveRegularSidebarSubAgentStateCounts(input: {
  groupingMode: "flat" | "worktree";
  threadKey: string;
  countsByThreadKey: ReadonlyMap<string, SidebarConversationStateCounts>;
}): SidebarConversationStateCounts | null {
  if (input.groupingMode !== "flat") return null;
  const counts = input.countsByThreadKey.get(input.threadKey);
  if (counts === undefined) return null;
  return Object.values(counts).some((count) => count > 0) ? counts : null;
}
