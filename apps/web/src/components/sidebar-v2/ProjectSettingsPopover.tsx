import { CopyIcon, FolderIcon, ServerIcon } from "lucide-react";
import type { ProjectIcon, SidebarProjectGroupingMode } from "@aqqua/contracts";
import { useProjectIcon } from "~/state/entities";
import { ProjectIconPicker } from "../ProjectIconPicker";
import { deriveProjectGroupingOverrideKey } from "../../logicalProject";
import type {
  SidebarProjectGroupMember,
  SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import { Button } from "../ui/button";
import {
  Popover,
  PopoverPopup,
  PopoverTitle,
  PopoverDescription,
  PopoverCreateHandle,
} from "../ui/popover";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { PROJECT_GROUPING_MODE_LABELS } from "./projectGroupingLabels";

/**
 * Icon picker bound to one grouped project entry.
 *
 * Split out so each member subscribes only to its own project's icon.
 */
function ProjectMemberIconPicker(props: {
  readonly member: SidebarProjectGroupMember;
  readonly onChange: (icon: ProjectIcon | null) => void;
}) {
  const icon = useProjectIcon(props.member.environmentId, props.member.workspaceRoot);
  return (
    <ProjectIconPicker
      className="text-xs [&_fieldset>div]:grid-cols-6 [&_input]:h-8 [&_input]:text-[13px] [&_span.text-base]:text-[11px]"
      title={props.member.title}
      workspaceRoot={props.member.workspaceRoot}
      value={icon}
      onChange={props.onChange}
      idPrefix={`project-icon-${props.member.physicalProjectKey}`}
    />
  );
}

export function ProjectSettingsPopover(props: {
  handle: ReturnType<typeof PopoverCreateHandle<SidebarProjectSnapshot>>;
  target: SidebarProjectSnapshot | null;
  onClose: () => void;
  projectGroupingMode: SidebarProjectGroupingMode;
  projectGroupingOverrides: Readonly<Record<string, SidebarProjectGroupingMode>> | undefined;
  copyProjectPath: (text: string, payload: { path: string }) => void;
  renameProjectMember: (member: SidebarProjectGroupMember, title: string) => void | Promise<void>;
  updateProjectMemberIcon: (
    member: SidebarProjectGroupMember,
    icon: ProjectIcon | null,
  ) => void | Promise<void>;
  updateProjectMemberOriginBranch: (
    member: SidebarProjectGroupMember,
    branch: string,
  ) => void | Promise<void>;
  updateProjectGroupingPreference: (
    member: SidebarProjectGroupMember,
    value: "inherit" | SidebarProjectGroupingMode,
  ) => void;
  onRemoveMembers: (
    projectGroup: SidebarProjectSnapshot,
    members: readonly SidebarProjectGroupMember[],
  ) => void | Promise<void>;
}) {
  const target = props.target;
  const close = () => {
    props.handle.close();
    props.onClose();
  };
  return (
    <Popover
      handle={props.handle}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <PopoverPopup
        side="right"
        align="start"
        sideOffset={8}
        className="w-[340px]"
        viewportClassName="max-h-[min(34rem,calc(100dvh-2rem))] p-3"
      >
        <div className="space-y-2 pb-3">
          <PopoverTitle className="text-[13px] font-semibold">{target?.displayName}</PopoverTitle>
          <PopoverDescription className="sr-only">
            Manage project names, worktree defaults, grouping rules, and environments.
          </PopoverDescription>
          <div className="grid gap-1.5 text-[11px] text-muted-foreground">
            {target?.memberProjects.map((member) => (
              <div
                key={member.physicalProjectKey}
                className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"
              >
                <span className="flex min-w-0 items-center gap-1">
                  <FolderIcon className="size-3.5 shrink-0 opacity-60" />
                  <span className="min-w-0 truncate font-mono">{member.workspaceRoot}</span>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="size-4 shrink-0 rounded-sm"
                    aria-label="Copy project path"
                    title="Copy project path"
                    onClick={() =>
                      props.copyProjectPath(member.workspaceRoot, { path: member.workspaceRoot })
                    }
                  >
                    <CopyIcon className="size-3.5" />
                  </Button>
                </span>
                <span className="flex min-w-0 shrink-0 items-center gap-1">
                  <ServerIcon className="size-3.5 shrink-0 opacity-60" />
                  <span className="min-w-0 truncate">
                    {member.environmentLabel ?? "Current environment"}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="divide-y divide-border/60">
            {target?.memberProjects.map((member) => (
              <section key={member.physicalProjectKey} className="grid min-w-0 gap-3 py-3">
                <div className="grid gap-3">
                  <label className="grid min-w-0 gap-1.5">
                    <span className="text-xs font-medium text-foreground">Project name</span>
                    <Input
                      className="h-8 text-[13px]"
                      key={`${member.physicalProjectKey}:${member.title}`}
                      aria-label={`Project name in ${member.environmentLabel ?? "current environment"}`}
                      defaultValue={member.title}
                      onBlur={(event) => {
                        void props.renameProjectMember(member, event.currentTarget.value);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                    />
                  </label>
                  <label className="grid min-w-0 gap-1.5">
                    <span className="text-xs font-medium text-foreground">Grouping rule</span>
                    <Select
                      value={
                        props.projectGroupingOverrides?.[
                          deriveProjectGroupingOverrideKey(member)
                        ] ?? "inherit"
                      }
                      onValueChange={(value) => {
                        if (
                          value === "inherit" ||
                          value === "repository" ||
                          value === "repository_path" ||
                          value === "separate"
                        ) {
                          props.updateProjectGroupingPreference(member, value);
                        }
                      }}
                    >
                      <SelectTrigger
                        className="h-8 w-full text-[13px]"
                        aria-label={`Grouping rule for ${member.environmentLabel ?? "current environment"}`}
                      >
                        <SelectValue>
                          {(() => {
                            const selection =
                              props.projectGroupingOverrides?.[
                                deriveProjectGroupingOverrideKey(member)
                              ] ?? "inherit";
                            return selection === "inherit"
                              ? `Default (${PROJECT_GROUPING_MODE_LABELS[props.projectGroupingMode]})`
                              : PROJECT_GROUPING_MODE_LABELS[selection];
                          })()}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup align="start" alignItemWithTrigger={false}>
                        <SelectItem hideIndicator value="inherit">
                          Use global default
                        </SelectItem>
                        <SelectItem hideIndicator value="repository">
                          {PROJECT_GROUPING_MODE_LABELS.repository}
                        </SelectItem>
                        <SelectItem hideIndicator value="repository_path">
                          {PROJECT_GROUPING_MODE_LABELS.repository_path}
                        </SelectItem>
                        <SelectItem hideIndicator value="separate">
                          {PROJECT_GROUPING_MODE_LABELS.separate}
                        </SelectItem>
                      </SelectPopup>
                    </Select>
                  </label>
                </div>
                <details className="min-w-0 text-xs">
                  <summary className="cursor-pointer py-1 font-medium text-foreground">
                    Project icon
                  </summary>
                  <div className="pt-2">
                    <ProjectMemberIconPicker
                      member={member}
                      onChange={(icon) => void props.updateProjectMemberIcon(member, icon)}
                    />
                  </div>
                </details>
                <label className="grid min-w-0 gap-1.5">
                  <span className="text-xs font-medium text-foreground">
                    Worktree origin branch
                  </span>
                  <Input
                    className="h-8 text-[13px]"
                    key={`${member.physicalProjectKey}:${member.newWorktreesOriginBranch ?? ""}`}
                    aria-label={`Worktree origin branch in ${member.environmentLabel ?? "current environment"}`}
                    defaultValue={member.newWorktreesOriginBranch ?? ""}
                    placeholder="Repository default"
                    spellCheck={false}
                    onBlur={(event) => {
                      void props.updateProjectMemberOriginBranch(member, event.currentTarget.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                  <span className="text-[11px] leading-4 text-muted-foreground">
                    When new worktrees start from origin, they use this branch. Leave empty to use
                    the repository default.
                  </span>
                </label>
                {target && target.memberProjects.length > 1 ? (
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive-foreground hover:bg-destructive/8 hover:text-destructive-foreground"
                      onClick={() => {
                        close();
                        void props.onRemoveMembers(target, [member]);
                      }}
                    >
                      Remove project
                    </Button>
                  </div>
                ) : null}
              </section>
            ))}
          </div>
          {target && target.memberProjects.length > 1 ? (
            <div className="flex flex-col gap-2 border-t border-border/60 py-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground">
                  Remove this project everywhere
                </p>
                <p className="text-[11px] text-pretty text-muted-foreground">
                  Deletes all grouped entries and their conversation history.
                </p>
              </div>
              <Button
                size="sm"
                variant="destructive-outline"
                className="shrink-0"
                onClick={() => {
                  close();
                  void props.onRemoveMembers(target, target.memberProjects);
                }}
              >
                Remove all entries
              </Button>
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border/50 pt-3">
          {target?.memberProjects.length === 1 ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive-foreground"
              onClick={() => {
                close();
                void props.onRemoveMembers(target, target.memberProjects);
              }}
            >
              Remove project
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={close}>
            Close
          </Button>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
