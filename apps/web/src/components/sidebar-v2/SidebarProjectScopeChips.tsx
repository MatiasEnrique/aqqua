import { EllipsisIcon, FolderIcon } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Fragment } from "react";
import { cn } from "~/lib/utils";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { ProjectFavicon } from "../ProjectFavicon";
import { ComboboxEmpty, ComboboxItem, ComboboxList } from "../ui/combobox";
import { SidebarScopePicker } from "./SidebarScopePicker";

export function projectKeysFromScopeSelection(
  projects: readonly SidebarProjectSnapshot[],
): readonly string[] {
  return projects.map((project) => project.projectKey);
}

export function SidebarProjectScopePopup(props: {
  readonly scopedProjectGroups: readonly SidebarProjectSnapshot[];
  readonly onSelectionChange: (projectKeys: readonly string[]) => void;
  readonly onProjectActions: (
    event: ReactMouseEvent<HTMLButtonElement>,
    project: SidebarProjectSnapshot,
  ) => void | Promise<void>;
  readonly onRequestClose: () => void;
}) {
  return (
    <Fragment>
      {/* One control, and only while it would do something. Selecting every
          project and selecting none both show every thread, so a "Select
          all" beside this would just be a second way to say what clearing
          already says — with the added cost of filling the row with a chip
          per project to express the resting state.

          Above the list rather than in it: a row that can be arrowed onto
          and highlighted like a project invites being picked by accident
          when typing narrows the list to one. */}
      {props.scopedProjectGroups.length > 0 ? (
        <div className="border-b border-border/60 p-1">
          <button
            type="button"
            className={cn(
              "w-full cursor-pointer rounded-sm px-2 py-1 text-left text-xs font-medium text-muted-foreground",
              "outline-none transition-colors hover:bg-accent hover:text-foreground",
              "focus-visible:bg-accent focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            )}
            // Stopped so the combobox does not read the press as an outside
            // interaction and close before the click lands.
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => props.onSelectionChange([])}
          >
            Deselect all
          </button>
        </div>
      ) : null}
      <ComboboxEmpty>No projects found.</ComboboxEmpty>
      <ComboboxList>
        {(project: SidebarProjectSnapshot) => (
          <ComboboxItem
            key={project.projectKey}
            value={project}
            className="pe-1"
            contentClassName="flex min-w-0 items-center gap-2"
          >
            <ProjectFavicon
              environmentId={project.environmentId}
              cwd={project.workspaceRoot}
              className="size-4 shrink-0 rounded-sm"
            />
            <span className="min-w-0 flex-1 truncate">{project.displayName}</span>
            <button
              type="button"
              aria-label={`Project actions for ${project.displayName}`}
              title={`Project actions for ${project.displayName}`}
              className={cn(
                "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md",
                "text-muted-foreground/55 outline-none transition-colors hover:bg-accent hover:text-foreground",
                "focus-visible:bg-accent focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              )}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                props.onRequestClose();
                void props.onProjectActions(event, project);
              }}
            >
              <EllipsisIcon className="size-3.5" />
            </button>
          </ComboboxItem>
        )}
      </ComboboxList>
    </Fragment>
  );
}

/**
 * The project filter, as a multi-select combobox.
 *
 * The registry below is a flat list of checkouts, so the filter has to be the
 * thing that says which repositories are in play — and it has to say it while
 * you read the list, not behind a menu. Selected projects stay on screen as
 * removable chips, and typing filters the rest, which is the only affordance
 * that survives someone with thirty repositories.
 *
 * An empty selection means every project. That is the resting state, so it
 * reads as placeholder text rather than a filter that has hidden the list.
 */
export function SidebarProjectScopeChips(props: {
  readonly projectGroups: readonly SidebarProjectSnapshot[];
  readonly scopedProjectGroups: readonly SidebarProjectSnapshot[];
  readonly onSelectionChange: (projectKeys: readonly string[]) => void;
  readonly onProjectActions: (
    event: ReactMouseEvent<HTMLButtonElement>,
    project: SidebarProjectSnapshot,
  ) => void | Promise<void>;
  readonly onProjectContextMenu: (event: ReactMouseEvent, project: SidebarProjectSnapshot) => void;
}) {
  return (
    <SidebarScopePicker
      items={props.projectGroups}
      chosenItems={props.scopedProjectGroups}
      itemKey={(project) => project.projectKey}
      itemLabel={(project) => project.displayName}
      icon={<FolderIcon className="size-4" />}
      testId="sidebar-project-scope-chips"
      inputLabel="Filter threads by project"
      allItemsLabel="All projects"
      onSelectionChange={(projects) =>
        props.onSelectionChange(projectKeysFromScopeSelection(projects))
      }
      renderChip={(project) => (
        <span
          data-testid={`sidebar-project-scope-chip-${project.projectKey}`}
          className="contents"
          onContextMenu={(event: ReactMouseEvent) => props.onProjectContextMenu(event, project)}
        >
          <ProjectFavicon
            environmentId={project.environmentId}
            cwd={project.workspaceRoot}
            className="size-4 shrink-0 rounded-sm"
          />
          <span className="min-w-0 truncate">{project.displayName}</span>
        </span>
      )}
      renderPopup={(close) => (
        <SidebarProjectScopePopup
          scopedProjectGroups={props.scopedProjectGroups}
          onSelectionChange={props.onSelectionChange}
          onProjectActions={props.onProjectActions}
          onRequestClose={close}
        />
      )}
    />
  );
}
