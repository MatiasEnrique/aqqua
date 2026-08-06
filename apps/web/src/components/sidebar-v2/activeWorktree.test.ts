import { describe, expect, it } from "vite-plus/test";
import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/models";

import { resolveActiveWorktreeKey, type ActiveWorktreeCandidate } from "./activeWorktree";

function thread(id: string, updatedAt: string): EnvironmentThreadShell {
  return {
    environmentId: "env",
    id,
    projectId: "project",
    title: id,
    updatedAt,
  } as unknown as EnvironmentThreadShell;
}

function group(
  key: string,
  overrides: Partial<ActiveWorktreeCandidate> = {},
): ActiveWorktreeCandidate {
  return { key, drafts: [], active: [], snoozed: [], ...overrides };
}

describe("resolveActiveWorktreeKey", () => {
  it("selects the worktree holding the routed conversation", () => {
    expect(
      resolveActiveWorktreeKey({
        routeThreadKey: "env:b",
        routeDraftId: null,
        worktreeGroups: [
          group("env:/repo", { active: [thread("a", "2026-01-01T00:00:00.000Z")] }),
          group("env:/repo-wt", { active: [thread("b", "2026-01-01T00:00:00.000Z")] }),
        ],
        overrideKey: null,
      }),
    ).toBe("env:/repo-wt");
  });

  it("finds a routed conversation on the snoozed shelf", () => {
    expect(
      resolveActiveWorktreeKey({
        routeThreadKey: "env:b",
        routeDraftId: null,
        worktreeGroups: [
          group("env:/repo-wt", { snoozed: [thread("b", "2026-01-01T00:00:00.000Z")] }),
        ],
        overrideKey: null,
      }),
    ).toBe("env:/repo-wt");
  });

  it("selects the worktree holding the routed draft", () => {
    expect(
      resolveActiveWorktreeKey({
        routeThreadKey: null,
        routeDraftId: "draft-1",
        worktreeGroups: [
          group("env:/repo"),
          group("env:/repo-wt", { drafts: [{ draftId: "draft-1" }] }),
        ],
        overrideKey: null,
      }),
    ).toBe("env:/repo-wt");
  });

  it("lets the route win over a stale override", () => {
    expect(
      resolveActiveWorktreeKey({
        routeThreadKey: "env:a",
        routeDraftId: null,
        worktreeGroups: [
          group("env:/repo", { active: [thread("a", "2026-01-01T00:00:00.000Z")] }),
          group("env:/empty"),
        ],
        overrideKey: "env:/empty",
      }),
    ).toBe("env:/repo");
  });

  it("falls back to the override when the route names no worktree", () => {
    expect(
      resolveActiveWorktreeKey({
        routeThreadKey: null,
        routeDraftId: null,
        worktreeGroups: [group("env:/empty")],
        overrideKey: "env:/empty",
      }),
    ).toBe("env:/empty");
  });

  it("drops an override whose worktree no longer exists", () => {
    expect(
      resolveActiveWorktreeKey({
        routeThreadKey: null,
        routeDraftId: null,
        worktreeGroups: [group("env:/repo")],
        overrideKey: "env:/deleted",
      }),
    ).toBeNull();
  });

  it("returns null when nothing selects a worktree", () => {
    expect(
      resolveActiveWorktreeKey({
        routeThreadKey: null,
        routeDraftId: null,
        worktreeGroups: [group("env:/repo")],
        overrideKey: null,
      }),
    ).toBeNull();
  });
});
