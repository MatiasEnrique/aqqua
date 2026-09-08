import { EnvironmentId, ThreadId } from "@aqqua/contracts";
import { describe, expect, it } from "vite-plus/test";
import { buildSidebarThreadFamilies, sidebarThreadKey } from "./sidebarThreadFamilies";

function thread(id: string, parent: string | null = null, environment = "local") {
  return {
    id: ThreadId.make(id),
    parentThreadId: parent === null ? null : ThreadId.make(parent),
    environmentId: EnvironmentId.make(environment),
  };
}

describe("sidebar thread families", () => {
  it("keeps descendants in a picker instead of adding nested sidebar rows", () => {
    const parent = thread("parent");
    const child = thread("child", "parent");
    const grandchild = thread("grandchild", "child");
    const family = buildSidebarThreadFamilies([child, parent, grandchild]);
    expect(family.roots).toEqual([parent]);
    expect(family.descendantsByRoot.get(sidebarThreadKey(parent))).toEqual([child, grandchild]);
  });
  it("keeps missing parents and another environment's conversations reachable", () => {
    const parent = thread("parent");
    const orphan = thread("child", "parent", "remote");
    expect(buildSidebarThreadFamilies([parent, orphan]).roots).toEqual([parent, orphan]);
  });
  it("does not lose conversations with cyclic parent links", () => {
    const first = thread("first", "second");
    const second = thread("second", "first");
    expect(buildSidebarThreadFamilies([first, second]).roots).toEqual([first, second]);
  });
});
