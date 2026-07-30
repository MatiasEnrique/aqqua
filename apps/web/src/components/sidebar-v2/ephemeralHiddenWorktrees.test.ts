import { describe, expect, it } from "vite-plus/test";
import type { SidebarWorktreeGroup } from "../Sidebar.worktreeGroups";
import {
  addEphemeralHiddenWorktreeKey,
  nextEphemeralHiddenWorktreeKeys,
  removeEphemeralHiddenWorktreeKey,
} from "./ephemeralHiddenWorktrees";

const settledOnly = {
  key: "local:/worktrees/ciber/dev-22",
  drafts: [],
  active: [],
  snoozed: [],
} as unknown as SidebarWorktreeGroup;

describe("ephemeral hidden worktrees", () => {
  it("adds and removes hide keys without mutating the previous set", () => {
    const empty = new Set<string>();
    const withKey = addEphemeralHiddenWorktreeKey(empty, settledOnly.key);
    expect(withKey).not.toBe(empty);
    expect([...withKey]).toEqual([settledOnly.key]);
    expect(addEphemeralHiddenWorktreeKey(withKey, settledOnly.key)).toBe(withKey);

    const cleared = removeEphemeralHiddenWorktreeKey(withKey, settledOnly.key);
    expect(cleared).not.toBe(withKey);
    expect(cleared.size).toBe(0);
  });

  it("clears a hide when the group disappears from the projection", () => {
    const hidden = new Set([settledOnly.key]);
    expect(nextEphemeralHiddenWorktreeKeys(hidden, [])).toEqual(new Set());
  });

  it("clears a hide when visible children reappear on the same path", () => {
    const hidden = new Set([settledOnly.key]);
    const recreated = {
      ...settledOnly,
      active: [{}],
    } as unknown as SidebarWorktreeGroup;
    expect(nextEphemeralHiddenWorktreeKeys(hidden, [recreated])).toEqual(new Set());
  });

  it("keeps a hide while a settled-only group still projects", () => {
    const hidden = new Set([settledOnly.key]);
    expect(nextEphemeralHiddenWorktreeKeys(hidden, [settledOnly])).toBeNull();
  });

  it("covers successful delete → brief residual projection → disappear → same-path reuse", () => {
    // 1) Delete succeeds while the old settled-only projection is still visible.
    let hidden = addEphemeralHiddenWorktreeKey(new Set(), settledOnly.key);
    expect(nextEphemeralHiddenWorktreeKeys(hidden, [settledOnly])).toBeNull();

    // 2) Authoritative projection drops the group — hide clears (request-local).
    const afterDisappear = nextEphemeralHiddenWorktreeKeys(hidden, []);
    expect(afterDisappear).toEqual(new Set());
    hidden = afterDisappear!;

    // 3) Later, the same path reappears as settled-only history — must not stay hidden.
    expect(nextEphemeralHiddenWorktreeKeys(hidden, [settledOnly])).toBeNull();
    expect(hidden.has(settledOnly.key)).toBe(false);

    // 4) A fresh hide is only applied by a new successful delete, not by history.
    const reusedWithActivity = {
      ...settledOnly,
      active: [{}],
    } as unknown as SidebarWorktreeGroup;
    const staleHide = addEphemeralHiddenWorktreeKey(new Set(), settledOnly.key);
    expect(nextEphemeralHiddenWorktreeKeys(staleHide, [reusedWithActivity])).toEqual(new Set());
  });
});
