import type { EnvironmentId, ProjectId } from "@aqqua/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";

vi.mock("../ProjectFavicon", () => ({
  ProjectFavicon: ({ cwd }: { cwd: string }) => <span data-project-favicon={cwd} />,
}));

const {
  projectKeysFromScopeSelection,
  projectScopeLabel,
  SidebarProjectScopeChips,
  toggleProjectScopeKey,
} = await import("./SidebarProjectScopeChips");

const project = (name: string): SidebarProjectSnapshot =>
  ({
    id: `${name}-id` as ProjectId,
    environmentId: "local" as EnvironmentId,
    projectKey: name,
    displayName: name,
    workspaceRoot: `/repos/${name}`,
    memberProjectRefs: [{ environmentId: "local", projectId: `${name}-id` }],
  }) as unknown as SidebarProjectSnapshot;

const projectGroups = [project("aqqua-web"), project("marketing"), project("docs")];

const render = (selected: readonly string[], selectedProjectKeys = selected) =>
  renderToStaticMarkup(
    <SidebarProjectScopeChips
      projectGroups={projectGroups}
      scopedProjectGroups={projectGroups.filter((group) => selected.includes(group.projectKey))}
      selectedProjectKeys={selectedProjectKeys}
      onSelectionChange={() => {}}
      onProjectContextMenu={() => {}}
    />,
  );

describe("SidebarProjectScopeChips", () => {
  it("uses one simple dropdown with no second search input", () => {
    const markup = render([]);

    expect(markup).toContain("All projects");
    expect(markup).toContain('aria-label="Filter threads by project"');
    expect(markup).not.toContain("<input");
    expect(markup).not.toContain("combobox");
  });

  it("summarizes one or several selected projects in the trigger", () => {
    expect(projectScopeLabel([projectGroups[2]!])).toBe("docs");
    expect(projectScopeLabel([projectGroups[0]!, projectGroups[2]!])).toBe("2 projects");
    expect(render(["docs"])).toContain("docs");
    expect(render(["aqqua-web", "docs"])).toContain("2 projects");
  });

  it("does not describe an unavailable saved scope as all projects", () => {
    expect(projectScopeLabel([], true)).toBe("Selected projects unavailable");
    expect(render([], ["offline:project"])).toContain("Selected projects unavailable");
  });

  it("keeps a folder icon and dropdown affordance as fixed landmarks", () => {
    const markup = render(["docs"]);

    expect(markup).toContain("lucide-folder");
    expect(markup).toContain("lucide-chevron-down");
  });

  it("maps selected projects to stable project keys", () => {
    expect(projectKeysFromScopeSelection([projectGroups[2]!, projectGroups[0]!])).toEqual([
      "docs",
      "aqqua-web",
    ]);
  });

  it("adds and removes projects while treating an empty selection as all projects", () => {
    const one = toggleProjectScopeKey([], "aqqua-web", true);
    const two = toggleProjectScopeKey(one, "docs", true);

    expect(one).toEqual(["aqqua-web"]);
    expect(two).toEqual(["aqqua-web", "docs"]);
    expect(toggleProjectScopeKey(two, "aqqua-web", false)).toEqual(["docs"]);
    expect(toggleProjectScopeKey(["docs"], "docs", false)).toEqual([]);
  });
});
