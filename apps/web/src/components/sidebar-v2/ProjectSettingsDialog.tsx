import { CopyIcon, FolderIcon, ServerIcon, Trash2Icon } from "lucide-react";
import type { SidebarProjectGroupingMode } from "@aqqua/contracts";
import { deriveProjectGroupingOverrideKey } from "../../logicalProject";
import type {
  SidebarProjectGroupMember,
  SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { PROJECT_GROUPING_MODE_LABELS } from "./projectGroupingLabels";

export function ProjectSettingsDialog(props: {
  target: SidebarProjectSnapshot | null;
  onClose: () => void;
  projectGroupingMode: SidebarProjectGroupingMode;
  projectGroupingOverrides: Readonly<Record<string, SidebarProjectGroupingMode>> | undefined;
  copyProjectPath: (text: string, payload: { path: string }) => void;
  renameProjectMember: (member: SidebarProjectGroupMember, title: string) => void | Promise<void>;
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
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader className="gap-3 pb-1!">
          <DialogTitle className="text-balance">Project settings</DialogTitle>
          <DialogDescription className="sr-only">
            Manage project names, grouping rules, and environments.
          </DialogDescription>
          <div className="grid gap-1.5 text-base text-muted-foreground">
            {target?.memberProjects.map((member) => (
              <div key={member.physicalProjectKey} className="flex min-w-0 items-center gap-3">
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
        </DialogHeader>
        <DialogPanel className="p-0">
          <div className="divide-y divide-border/60">
            {target?.memberProjects.map((member) => (
              <section
                key={member.physicalProjectKey}
                className="grid min-w-0 gap-5 px-6 pb-5 pt-2 sm:gap-4 sm:pb-4 sm:pt-2"
              >
                <div className="grid gap-4 sm:grid-cols-2 sm:gap-3">
                  <label className="grid min-w-0 gap-1.5">
                    <span className="font-medium text-foreground">Project name</span>
                    <Input
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
                    <span className="font-medium text-foreground">Grouping rule</span>
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
                        className="w-full sm:min-h-7.5"
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
                {target && target.memberProjects.length > 1 ? (
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive-foreground hover:bg-destructive/8 hover:text-destructive-foreground"
                      onClick={() => {
                        props.onClose();
                        void props.onRemoveMembers(target, [member]);
                      }}
                    >
                      <Trash2Icon />
                      Remove project
                    </Button>
                  </div>
                ) : null}
              </section>
            ))}
          </div>
          {target && target.memberProjects.length > 1 ? (
            <div className="flex flex-col gap-3 border-t border-border/60 bg-muted/32 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-base font-medium text-foreground sm:text-sm">
                  Remove this project everywhere
                </p>
                <p className="text-base text-pretty text-muted-foreground sm:text-sm">
                  Deletes all grouped entries and their conversation history.
                </p>
              </div>
              <Button
                size="sm"
                variant="destructive-outline"
                className="shrink-0"
                onClick={() => {
                  props.onClose();
                  void props.onRemoveMembers(target, target.memberProjects);
                }}
              >
                <Trash2Icon />
                Remove all entries
              </Button>
            </div>
          ) : null}
        </DialogPanel>
        <DialogFooter
          variant="bare"
          className={cn(target?.memberProjects.length === 1 && "sm:justify-between")}
        >
          {target?.memberProjects.length === 1 ? (
            <Button
              variant="destructive-outline"
              onClick={() => {
                props.onClose();
                void props.onRemoveMembers(target, target.memberProjects);
              }}
            >
              <Trash2Icon />
              Remove project
            </Button>
          ) : null}
          <Button onClick={() => props.onClose()}>Close</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
