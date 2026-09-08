import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/models";
import { EnvironmentId, ProjectId, ThreadId } from "@aqqua/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  groupSidebarThreadsByStatus,
  sidebarFamilyStatusGroup,
  visibleStatusGroupThreads,
} from "./SidebarConversationGroups";
import { sidebarThreadKey } from "./sidebarThreadFamilies";

const thread = (
  id: string,
  overrides: Partial<EnvironmentThreadShell> = {},
): EnvironmentThreadShell =>
  ({
    environmentId: EnvironmentId.make("local"),
    id: ThreadId.make(id),
    projectId: ProjectId.make("project"),
    parentThreadId: null,
    title: id,
    updatedAt: "2026-09-08T09:00:00.000Z",
    session: null,
    latestTurn: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  }) as EnvironmentThreadShell;

describe("sidebar family status grouping", () => {
  it("promotes an actionable child above its idle parent", () => {
    const parent = thread("parent");
    const child = thread("child", {
      parentThreadId: parent.id,
      hasPendingApprovals: true,
    });

    expect(
      sidebarFamilyStatusGroup({
        root: parent,
        descendants: [child],
        threadSectionByKey: new Map(),
      }),
    ).toBe("Needs input");
  });

  it("partitions each family once under its highest-priority state", () => {
    const parent = thread("parent");
    const child = thread("child", {
      parentThreadId: parent.id,
      hasPendingUserInput: true,
    });
    const idle = thread("idle");
    const groups = groupSidebarThreadsByStatus({
      threads: [parent, idle],
      descendantsByRoot: new Map([[sidebarThreadKey(parent), [child]]]),
      threadSectionByKey: new Map(),
    });

    expect(groups.get("Needs input")).toEqual([parent]);
    expect(groups.get("Idle")).toEqual([idle]);
  });

  it("keeps a selected thread beyond the first page in sorted position", () => {
    const threads = Array.from({ length: 45 }, (_, index) => thread(`thread-${index}`));

    const visible = visibleStatusGroupThreads({
      threads,
      descendantsByRoot: new Map(),
      selectedThreadKey: sidebarThreadKey(threads[24]!),
      limit: 20,
    });

    expect(visible.threads).toEqual(threads.slice(0, 25));
    expect(visible.limit).toBe(25);
  });
});
