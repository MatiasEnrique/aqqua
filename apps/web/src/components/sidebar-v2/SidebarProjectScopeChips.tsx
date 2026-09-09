import { ChevronDownIcon, FolderIcon } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { cn } from "~/lib/utils";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { ProjectFavicon } from "../ProjectFavicon";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/menu";

export function projectKeysFromScopeSelection(
  projects: readonly SidebarProjectSnapshot[],
): readonly string[] {
  return projects.map((project) => project.projectKey);
}

export function toggleProjectScopeKey(
  currentKeys: readonly string[],
  projectKey: string,
  checked: boolean,
): readonly string[] {
  const alreadySelected = currentKeys.includes(projectKey);
  if (checked) return alreadySelected ? currentKeys : [...currentKeys, projectKey];
  return alreadySelected ? currentKeys.filter((key) => key !== projectKey) : currentKeys;
}

export function projectScopeLabel(
  scopedProjectGroups: readonly SidebarProjectSnapshot[],
  hasUnavailableSelection = false,
): string {
  if (scopedProjectGroups.length === 0)
    return hasUnavailableSelection ? "Selected projects unavailable" : "All projects";
  if (scopedProjectGroups.length === 1)
    return scopedProjectGroups[0]?.displayName ?? "All projects";
  return `${scopedProjectGroups.length} projects`;
}

export function SidebarProjectScopePopup(props: {
  readonly projectGroups: readonly SidebarProjectSnapshot[];
  readonly scopedProjectGroups: readonly SidebarProjectSnapshot[];
  readonly selectedProjectKeys: readonly string[];
  readonly onSelectionChange: (projectKeys: readonly string[]) => void;
  readonly onProjectContextMenu: (event: ReactMouseEvent, project: SidebarProjectSnapshot) => void;
}) {
  const selectedProjectKeys = props.selectedProjectKeys;

  return (
    // Matching the trigger width keeps the menu visually anchored to the field
    // instead of floating as a narrower box beside long project names.
    <DropdownMenuContent align="start" className="w-(--anchor-width) min-w-60">
      <DropdownMenuCheckboxItem
        checked={selectedProjectKeys.length === 0}
        closeOnClick
        label="All projects"
        onCheckedChange={() => props.onSelectionChange([])}
      >
        All projects
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator />
      {props.projectGroups.map((project) => (
        <DropdownMenuCheckboxItem
          key={project.projectKey}
          checked={selectedProjectKeys.includes(project.projectKey)}
          label={project.displayName}
          onCheckedChange={(checked) =>
            props.onSelectionChange(
              toggleProjectScopeKey(selectedProjectKeys, project.projectKey, checked),
            )
          }
          onContextMenu={(event) => props.onProjectContextMenu(event, project)}
        >
          <span className="flex min-w-0 items-center gap-2">
            <ProjectFavicon
              environmentId={project.environmentId}
              cwd={project.workspaceRoot}
              className="size-4 shrink-0 rounded-sm"
            />
            <span className="truncate">{project.displayName}</span>
          </span>
        </DropdownMenuCheckboxItem>
      ))}
    </DropdownMenuContent>
  );
}

/**
 * A compact multi-project filter. Empty means every project.
 *
 * Search belongs to the sidebar's top search field. This menu only lists the
 * available choices and keeps multi-selection visible as a short summary.
 */
export function SidebarProjectScopeChips(props: {
  /** What the filter narrows on this surface. Defaults to the thread list. */
  readonly ariaLabel?: string | undefined;
  readonly projectGroups: readonly SidebarProjectSnapshot[];
  readonly scopedProjectGroups: readonly SidebarProjectSnapshot[];
  readonly selectedProjectKeys: readonly string[];
  readonly onSelectionChange: (projectKeys: readonly string[]) => void;
  readonly onProjectContextMenu: (event: ReactMouseEvent, project: SidebarProjectSnapshot) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={props.ariaLabel ?? "Filter threads by project"}
        className={cn(
          "flex min-h-8 w-full cursor-pointer items-center gap-1.5 rounded-md px-1 text-left text-[13px] font-medium leading-5 text-sidebar-foreground outline-none",
          "transition-colors hover:bg-sidebar-row-hover data-popup-open:bg-sidebar-row-hover",
          "focus-visible:ring-2 focus-visible:ring-ring",
        )}
        data-testid="sidebar-project-scope-chips"
      >
        <FolderIcon aria-hidden className="size-3.5 shrink-0 text-sidebar-muted-foreground/80" />
        <span className="min-w-0 flex-1 truncate">
          {projectScopeLabel(
            props.scopedProjectGroups,
            props.selectedProjectKeys.length > 0 && props.scopedProjectGroups.length === 0,
          )}
        </span>
        <ChevronDownIcon
          aria-hidden
          className="size-3.5 shrink-0 text-sidebar-muted-foreground/70"
        />
      </DropdownMenuTrigger>
      <SidebarProjectScopePopup
        projectGroups={props.projectGroups}
        scopedProjectGroups={props.scopedProjectGroups}
        selectedProjectKeys={props.selectedProjectKeys}
        onSelectionChange={props.onSelectionChange}
        onProjectContextMenu={props.onProjectContextMenu}
      />
    </DropdownMenu>
  );
}
