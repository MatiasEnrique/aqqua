import { ThreadId } from "@aqqua/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  listActiveThreadsForWorktreePath,
  selectTopLevelThreadsForBatchAction,
  type WorktreeMemberThread,
} from "./threadDeletion.ts";

const asThreadId = (value: string): ThreadId => ThreadId.make(value);

function member(input: {
  readonly id: string;
  readonly worktreePath: string | null;
  readonly parentThreadId?: string | null;
  readonly deletedAt?: string | null;
  readonly archivedAt?: string | null;
}): WorktreeMemberThread {
  return {
    id: asThreadId(input.id),
    parentThreadId:
      input.parentThreadId === undefined || input.parentThreadId === null
        ? null
        : asThreadId(input.parentThreadId),
    worktreePath: input.worktreePath,
    deletedAt: input.deletedAt ?? null,
    archivedAt: input.archivedAt ?? null,
  };
}

describe("listActiveThreadsForWorktreePath", () => {
  it("includes live and archived members for the canonical path", () => {
    const threads = [
      member({ id: "live", worktreePath: "/tmp/worktrees/feature-a" }),
      member({
        id: "archived",
        worktreePath: "/tmp/worktrees/feature-a/",
        archivedAt: "2026-01-02T00:00:00.000Z",
      }),
      member({ id: "other", worktreePath: "/tmp/worktrees/feature-b" }),
      member({
        id: "deleted",
        worktreePath: "/tmp/worktrees/feature-a",
        deletedAt: "2026-01-03T00:00:00.000Z",
      }),
    ];

    expect(
      listActiveThreadsForWorktreePath(threads, "/tmp/worktrees/feature-a").map(
        (thread) => thread.id,
      ),
    ).toEqual([asThreadId("live"), asThreadId("archived")]);
  });
});

describe("selectTopLevelThreadsForBatchAction", () => {
  it("keeps only roots so one family command owns the cascade", () => {
    const parent = member({ id: "parent", worktreePath: "/wt" });
    const child = member({ id: "child", worktreePath: "/wt", parentThreadId: "parent" });
    const independent = member({ id: "independent", worktreePath: "/wt" });

    expect(
      selectTopLevelThreadsForBatchAction([parent, child, independent]).map((thread) => thread.id),
    ).toEqual([asThreadId("parent"), asThreadId("independent")]);
  });
});
