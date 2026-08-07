import type { EnvironmentId, ProjectId } from "@aqqua/contracts";
import {
  Children,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";

vi.mock("../ProjectFavicon", () => ({
  ProjectFavicon: ({ cwd }: { cwd: string }) => <span data-project-favicon={cwd} />,
}));

const { projectKeysFromScopeSelection, SidebarProjectScopeChips, SidebarProjectScopePopup } =
  await import("./SidebarProjectScopeChips");

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

const render = (selected: readonly string[]) =>
  renderToStaticMarkup(
    <SidebarProjectScopeChips
      projectGroups={projectGroups}
      scopedProjectGroups={projectGroups.filter((group) => selected.includes(group.projectKey))}
      onSelectionChange={() => {}}
      onProjectActions={() => {}}
      onProjectContextMenu={() => {}}
    />,
  );

const renderPopup = (input?: {
  readonly selected?: readonly SidebarProjectSnapshot[];
  readonly onSelectionChange?: (projectKeys: readonly string[]) => void;
  readonly onProjectActions?: (
    event: ReactMouseEvent<HTMLButtonElement>,
    project: SidebarProjectSnapshot,
  ) => void;
  readonly onRequestClose?: () => void;
}) =>
  SidebarProjectScopePopup({
    scopedProjectGroups: input?.selected ?? [projectGroups[0]!],
    onSelectionChange: input?.onSelectionChange ?? (() => {}),
    onProjectActions: input?.onProjectActions ?? (() => {}),
    onRequestClose: input?.onRequestClose ?? (() => {}),
  }) as ReactElement<{ readonly children: ReactNode }>;

function popupChildren(input?: Parameters<typeof renderPopup>[0]) {
  return Children.toArray(renderPopup(input).props.children) as ReadonlyArray<
    ReactElement<{ readonly children: ReactNode }>
  >;
}

describe("SidebarProjectScopeChips", () => {
  it("reads as every project when nothing is selected", () => {
    const markup = render([]);

    expect(markup).toContain("All projects");
    expect(markup).not.toContain("sidebar-project-scope-chip-");
  });

  it("carries one dismissible chip per selected project", () => {
    const markup = render(["aqqua-web", "marketing"]);

    expect(markup).toContain('data-testid="sidebar-project-scope-chip-aqqua-web"');
    expect(markup).toContain('data-testid="sidebar-project-scope-chip-marketing"');
    // Each chip names its project, so its "Remove" button is distinguishable
    // from the one on the chip beside it.
    expect(markup).toContain('aria-label="aqqua-web"');
    expect(markup).toContain('data-slot="combobox-chip-remove"');
    // Selecting some projects is a filter, not a mode — the placeholder goes.
    expect(markup).not.toContain("All projects");
  });

  it("keeps a chip for every selection, not just the first", () => {
    const markup = render(["aqqua-web", "marketing", "docs"]);

    expect(markup.match(/data-testid="sidebar-project-scope-chip-/g)).toHaveLength(3);
  });

  it("renders each chip's favicon from the project workspace", () => {
    expect(render(["docs"])).toContain('data-project-favicon="/repos/docs"');
  });

  it("keeps the picker reachable so a filtered sidebar can be widened again", () => {
    expect(render(["aqqua-web"])).toContain('aria-label="Filter threads by project"');
  });

  it("offers the placeholder only while the scope is every project", () => {
    expect(render([])).toContain('placeholder="All projects"');
    expect(render(["docs"])).toContain('placeholder=""');
  });

  it("carries a folder icon as the row's fixed landmark", () => {
    // Present whether or not any project is picked — chips and placeholder
    // both move, so the icon is the only stable thing to scan for.
    expect(render([])).toContain("lucide-folder");
    expect(render(["docs"])).toContain("lucide-folder");
  });

  it("maps combobox value changes to project keys", () => {
    expect(projectKeysFromScopeSelection([projectGroups[2]!, projectGroups[0]!])).toEqual([
      "docs",
      "aqqua-web",
    ]);
  });

  it("clears a non-empty project scope from the popup", () => {
    const onSelectionChange = vi.fn();
    const clearRow = popupChildren({ onSelectionChange })[0]!;
    const clearButton = Children.toArray(clearRow.props.children)[0] as ReactElement<{
      readonly onClick: () => void;
    }>;

    clearButton.props.onClick();

    expect(onSelectionChange).toHaveBeenCalledWith([]);
    expect(popupChildren({ selected: [] })).toHaveLength(2);
  });

  it("closes the popup before opening project actions", () => {
    const calls: string[] = [];
    const stopPropagation = vi.fn();
    const list = popupChildren({
      onRequestClose: () => calls.push("close"),
      onProjectActions: () => calls.push("actions"),
    })[2]!;
    const renderItem = list.props.children as unknown as (
      project: SidebarProjectSnapshot,
    ) => ReactElement<{ readonly children: ReactNode }>;
    const item = renderItem(projectGroups[0]!);
    const actionButton = Children.toArray(item.props.children)[2] as ReactElement<{
      readonly onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
    }>;

    actionButton.props.onClick({
      stopPropagation,
    } as unknown as ReactMouseEvent<HTMLButtonElement>);

    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(calls).toEqual(["close", "actions"]);
  });
});
