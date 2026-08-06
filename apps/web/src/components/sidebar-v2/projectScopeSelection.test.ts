import { describe, expect, it } from "vite-plus/test";
import {
  EMPTY_PROJECT_SCOPE_SELECTION,
  projectScopeSelectionFromKeys,
  projectScopeSelectionKey,
  pruneProjectScopeSelection,
  resolveProjectScopeAddition,
  resolveSelectedProjectGroups,
  resolveSoleScopedProjectGroup,
} from "./projectScopeSelection";

const candidates = [
  { projectKey: "aqqua-web", displayName: "aqqua-web" },
  { projectKey: "marketing", displayName: "marketing" },
  { projectKey: "docs", displayName: "docs" },
];

describe("projectScopeSelectionFromKeys", () => {
  it("keeps every key the combobox reports", () => {
    const selection = projectScopeSelectionFromKeys(["aqqua-web", "marketing"]);
    expect([...selection].sort()).toEqual(["aqqua-web", "marketing"]);
  });

  it("reads an emptied selection as every project, not none", () => {
    const selection = projectScopeSelectionFromKeys([]);
    expect(selection.size).toBe(0);
    expect(resolveSelectedProjectGroups(selection, candidates)).toEqual([]);
    expect(projectScopeSelectionKey(selection)).toBe("all");
  });
});

describe("resolveProjectScopeAddition", () => {
  it("names the project that was just added", () => {
    expect(resolveProjectScopeAddition(new Set(["aqqua-web"]), ["aqqua-web", "docs"])).toBe("docs");
  });

  it("names nothing when a project was removed", () => {
    expect(resolveProjectScopeAddition(new Set(["aqqua-web", "docs"]), ["aqqua-web"])).toBeNull();
  });

  it("names nothing when the scope was cleared back to every project", () => {
    expect(resolveProjectScopeAddition(new Set(["aqqua-web"]), [])).toBeNull();
  });

  it("names nothing when several projects arrive at once", () => {
    expect(resolveProjectScopeAddition(EMPTY_PROJECT_SCOPE_SELECTION, ["docs", "marketing"])).toBe(
      null,
    );
  });
});

describe("pruneProjectScopeSelection", () => {
  it("drops keys whose project no longer exists", () => {
    const selection = pruneProjectScopeSelection(new Set(["aqqua-web", "deleted"]), candidates);
    expect([...selection]).toEqual(["aqqua-web"]);
  });

  it("keeps the same set identity when every key is still live", () => {
    const selection = new Set(["aqqua-web", "docs"]);
    expect(pruneProjectScopeSelection(selection, candidates)).toBe(selection);
  });

  it("leaves the all-projects selection alone", () => {
    expect(pruneProjectScopeSelection(EMPTY_PROJECT_SCOPE_SELECTION, [])).toBe(
      EMPTY_PROJECT_SCOPE_SELECTION,
    );
  });
});

describe("resolveSelectedProjectGroups", () => {
  it("returns the selected groups in sidebar order, not click order", () => {
    const selected = resolveSelectedProjectGroups(new Set(["docs", "aqqua-web"]), candidates);
    expect(selected.map((group) => group.projectKey)).toEqual(["aqqua-web", "docs"]);
  });
});

describe("resolveSoleScopedProjectGroup", () => {
  it("names the project when exactly one is selected", () => {
    expect(resolveSoleScopedProjectGroup([candidates[0]!])?.projectKey).toBe("aqqua-web");
  });

  it("refuses to name one when several are selected", () => {
    expect(resolveSoleScopedProjectGroup([candidates[0]!, candidates[1]!])).toBeNull();
  });

  it("refuses to name one when the scope is every project", () => {
    expect(resolveSoleScopedProjectGroup([])).toBeNull();
  });
});

describe("projectScopeSelectionKey", () => {
  it("keys the same set the same way regardless of insertion order", () => {
    expect(projectScopeSelectionKey(new Set(["b", "a"]))).toBe(
      projectScopeSelectionKey(new Set(["a", "b"])),
    );
  });

  it("distinguishes different scopes", () => {
    expect(projectScopeSelectionKey(new Set(["a"]))).not.toBe(
      projectScopeSelectionKey(new Set(["a", "b"])),
    );
  });
});
