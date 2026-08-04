import { describe, expect, it } from "vite-plus/test";

import {
  requestSidebarSurfaceNavigation,
  resolveConversationSurfaceTarget,
  resolveDisplayedSidebarSurface,
} from "./SidebarSurfaceSwitcher.logic";

describe("SidebarSurfaceSwitcher navigation", () => {
  it.each([
    ["threads", "flows"],
    ["flows", "threads"],
  ] as const)(
    "shows %s before starting navigation away from %s",
    (requestedSurface, routeSurface) => {
      const events: string[] = [];
      const scheduledNavigation: { current: (() => void) | null } = { current: null };

      requestSidebarSurfaceNavigation({
        surface: requestedSurface,
        setPendingSurface: (surface) => events.push(`surface:${surface}`),
        afterPaint: (navigate) => {
          scheduledNavigation.current = navigate;
        },
        navigate: () => events.push("navigate"),
      });

      expect(events).toEqual([`surface:${requestedSurface}`]);
      expect(resolveDisplayedSidebarSurface(routeSurface, requestedSurface)).toBe(requestedSurface);

      if (scheduledNavigation.current === null) throw new Error("Navigation was not scheduled.");
      scheduledNavigation.current();
      expect(events).toEqual([`surface:${requestedSurface}`, "navigate"]);
    },
  );

  it("keeps the current conversation as the direct return target while flows are open", () => {
    const conversation = resolveConversationSurfaceTarget(
      {
        isBoard: false,
        params: { environmentId: "environment-1", threadId: "thread-1" },
      },
      { kind: "index" },
    );

    expect(
      resolveConversationSurfaceTarget(
        {
          isBoard: true,
          params: { environmentId: "environment-1" },
        },
        conversation,
      ),
    ).toEqual({
      kind: "thread",
      environmentId: "environment-1",
      threadId: "thread-1",
    });
  });

  it("keeps a draft as the direct return target while flows are open", () => {
    const conversation = resolveConversationSurfaceTarget(
      { isBoard: false, params: { draftId: "draft-1" } },
      { kind: "index" },
    );

    expect(
      resolveConversationSurfaceTarget(
        {
          isBoard: true,
          params: { environmentId: "environment-1" },
        },
        conversation,
      ),
    ).toEqual({ kind: "draft", draftId: "draft-1" });
  });

  it("falls back to the conversations landing page when flows were opened directly", () => {
    expect(
      resolveConversationSurfaceTarget(
        {
          isBoard: true,
          params: { environmentId: "environment-1" },
        },
        { kind: "index" },
      ),
    ).toEqual({ kind: "index" });
  });
});
