import { EllipsisIcon, FolderIcon } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Fragment, useState } from "react";
import { cn } from "~/lib/utils";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { ProjectFavicon } from "../ProjectFavicon";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxValue,
} from "../ui/combobox";

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
  // Owned here rather than in the sidebar model: the only thing outside this
  // component that ever needed to close the list was the project actions
  // dialog, and that now closes it on the way out below.
  const [open, setOpen] = useState(false);

  return (
    <Combobox<SidebarProjectSnapshot, true>
      multiple
      autoHighlight
      open={open}
      onOpenChange={setOpen}
      items={props.projectGroups}
      itemToStringLabel={(project) => project.displayName}
      value={props.scopedProjectGroups as SidebarProjectSnapshot[]}
      onValueChange={(next) => {
        props.onSelectionChange(next.map((project) => project.projectKey));
      }}
    >
      <ComboboxChips
        data-testid="sidebar-project-scope-chips"
        className={cn(
          // Sits in the same stack as the search row, so it wears the search
          // row's clothes: transparent until hovered, one radius, one height.
          // A filled band here would make the filter the loudest thing in a
          // header whose job is to stay quiet.
          "min-h-8 gap-1 rounded-md border-transparent bg-transparent p-1.5 shadow-none",
          "transition-colors hover:bg-sidebar-row-hover",
          "sm:min-h-8 dark:not-has-disabled:bg-transparent dark:hover:not-has-disabled:bg-sidebar-row-hover",
          // `before:` paints an inset top highlight to make form fields look
          // raised. Nothing here is raised.
          "before:hidden",
          // The field's own focus treatment is a 3px ring plus a border colour
          // change; the sidebar rings at 2px and never moves a border.
          "focus-within:border-transparent focus-within:ring-2 focus-within:ring-ring",
        )}
      >
        {/* The row's only fixed landmark. Chips and placeholder both move as
            the scope changes, so without it there is nothing to aim at when
            scanning the header for "where do I pick projects". Sized and inset
            to sit in the search icon's lane. */}
        <span
          aria-hidden
          className="flex shrink-0 items-center ps-1 pe-1 text-sidebar-muted-foreground/80"
        >
          <FolderIcon className="size-4" />
        </span>
        <ComboboxValue>
          {(projects: SidebarProjectSnapshot[]) => (
            <Fragment>
              {projects.map((project) => (
                <ComboboxChip
                  key={project.projectKey}
                  // The shared chip's remove button is labelled just "Remove",
                  // so the chip has to carry the project name for the button to
                  // be distinguishable from the one on the next chip.
                  aria-label={project.displayName}
                  data-testid={`sidebar-project-scope-chip-${project.projectKey}`}
                  // The chip carries the fill now that the row behind it is
                  // transparent — otherwise a selected project would be
                  // indistinguishable from the placeholder.
                  className="flex items-center gap-[5px] rounded-md bg-sidebar-control-surface ps-1 text-xs font-medium text-sidebar-foreground outline-none [&_svg:not([class*='size-'])]:size-3"
                  onContextMenu={(event: ReactMouseEvent) =>
                    props.onProjectContextMenu(event, project)
                  }
                >
                  <ProjectFavicon
                    environmentId={project.environmentId}
                    cwd={project.workspaceRoot}
                    className="size-4 shrink-0 rounded-sm"
                  />
                  <span className="min-w-0 truncate">{project.displayName}</span>
                </ComboboxChip>
              ))}
              <ComboboxChipsInput
                aria-label="Filter threads by project"
                placeholder={projects.length === 0 ? "All projects" : ""}
                // `ps-1` against the row's own `p-1.5` puts the placeholder at
                // the same 10px inset as the search row's icon, so the two
                // controls share a left edge.
                className="min-w-16 bg-transparent ps-1 text-sm font-medium text-sidebar-foreground placeholder:text-sidebar-muted-foreground/80 sm:text-sm"
              />
            </Fragment>
          )}
        </ComboboxValue>
      </ComboboxChips>
      {/* Solid, not glass: the popup opens straight over the registry, and a
          blurred translucent panel smears the branch names underneath it into
          the project names on top. Elevation still comes from the border and
          drop shadow `dropdown-glass` provides. */}
      <ComboboxPopup className="bg-popover backdrop-blur-none">
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
                  setOpen(false);
                  void props.onProjectActions(event, project);
                }}
              >
                <EllipsisIcon className="size-3.5" />
              </button>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
