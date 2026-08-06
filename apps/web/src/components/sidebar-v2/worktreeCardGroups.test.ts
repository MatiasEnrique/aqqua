import { describe, expect, it } from "vite-plus/test";
import type { SidebarWorktreeGroup } from "../Sidebar.worktreeGroups";
import { EMPTY_PROJECT_SCOPE_SELECTION } from "./projectScopeSelection";
import { buildWorktreeCardGroups, UNGROUPED_WORKTREE_CARD_GROUP_KEY } from "./worktreeCardGroups";

const worktree = (key: string) => ({ key }) as SidebarWorktreeGroup;

const aqquaMain = worktree("aqqua:main");
const aqquaHeader = worktree("aqqua:header-refactor");
const marketingMain = worktree("marketing:main");
const orphan = worktree("gone:main");

const repositories = [
  { project: { projectKey: "aqqua" }, worktrees: [aqquaMain, aqquaHeader] },
  { project: { projectKey: "marketing" }, worktrees: [marketingMain] },
  { project: { projectKey: "docs" }, worktrees: [] },
];

const keysOf = (groups: ReturnType<typeof buildWorktreeCardGroups>) =>
  groups.map((group) => group.key);

describe("buildWorktreeCardGroups", () => {
  it("puts each project's checkouts under its own folder", () => {
    const groups = buildWorktreeCardGroups({
      repositories,
      worktrees: [aqquaMain, aqquaHeader, marketingMain],
      selection: EMPTY_PROJECT_SCOPE_SELECTION,
    });

    expect(keysOf(groups)).toEqual(["aqqua", "marketing", "docs"]);
    expect(groups[0]?.worktrees).toEqual([aqquaMain, aqquaHeader]);
  });

  it("keeps a project with no checkouts, since the folder is where a new one starts", () => {
    const groups = buildWorktreeCardGroups({
      repositories,
      worktrees: [aqquaMain, aqquaHeader, marketingMain],
      selection: EMPTY_PROJECT_SCOPE_SELECTION,
    });

    expect(groups.find((group) => group.key === "docs")?.worktrees).toEqual([]);
  });

  it("shows only the filtered projects, so the rest are not a run of empty folders", () => {
    const groups = buildWorktreeCardGroups({
      repositories,
      worktrees: [aqquaMain, aqquaHeader, marketingMain],
      selection: new Set(["aqqua", "marketing"]),
    });

    expect(keysOf(groups)).toEqual(["aqqua", "marketing"]);
    expect(groups.every((group) => group.project !== null)).toBe(true);
  });

  it("drops the folder when the filter names a single project", () => {
    const groups = buildWorktreeCardGroups({
      repositories,
      worktrees: [aqquaMain, aqquaHeader],
      selection: new Set(["aqqua"]),
    });

    // The chip above the list already names it; a folder would only restate
    // the filter and offer to collapse the only thing on screen.
    expect(groups).toHaveLength(1);
    expect(groups[0]?.project).toBeNull();
    expect(groups[0]?.worktrees).toEqual([aqquaMain, aqquaHeader]);
  });

  it("keeps the folder when a remainder bucket renders beside the lone project", () => {
    const groups = buildWorktreeCardGroups({
      repositories,
      worktrees: [aqquaMain, orphan],
      selection: new Set(["aqqua"]),
    });

    // Two flat runs of cards would leave no way to tell which is which.
    expect(keysOf(groups)).toEqual(["aqqua", UNGROUPED_WORKTREE_CARD_GROUP_KEY]);
    expect(groups[0]?.project).not.toBeNull();
  });

  it("keeps folders when the sidebar is unfiltered, even with one project", () => {
    const groups = buildWorktreeCardGroups({
      repositories: [repositories[0]!],
      worktrees: [aqquaMain, aqquaHeader],
      selection: EMPTY_PROJECT_SCOPE_SELECTION,
    });

    // Unfiltered, the folder is the only place "new worktree" lives.
    expect(groups[0]?.project).not.toBeNull();
  });

  it("still renders a checkout whose project no group claims", () => {
    const groups = buildWorktreeCardGroups({
      repositories,
      worktrees: [aqquaMain, aqquaHeader, marketingMain, orphan],
      selection: EMPTY_PROJECT_SCOPE_SELECTION,
    });

    const remainder = groups.at(-1);
    expect(remainder?.key).toBe(UNGROUPED_WORKTREE_CARD_GROUP_KEY);
    expect(remainder?.project).toBeNull();
    expect(remainder?.worktrees).toEqual([orphan]);
  });

  it("adds no remainder bucket when every checkout is placed", () => {
    const groups = buildWorktreeCardGroups({
      repositories,
      worktrees: [aqquaMain, aqquaHeader, marketingMain],
      selection: EMPTY_PROJECT_SCOPE_SELECTION,
    });

    expect(keysOf(groups)).not.toContain(UNGROUPED_WORKTREE_CARD_GROUP_KEY);
  });
});
