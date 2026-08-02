import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@aqqua/client-runtime/environment";
import type { ScopedProjectRef } from "@aqqua/contracts";
import { buildTemporaryWorktreeBranchName } from "@aqqua/shared/git";
import { GitBranchPlusIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { randomHex } from "~/lib/utils";
import { useProjects } from "~/state/entities";
import { useBranches } from "~/state/queries";
import { primaryServerSettingsAtom } from "~/state/server";
import {
  buildSetupActionOptions,
  normalizeWorktreeBranchName,
  resolveDefaultBaseBranch,
  resolveDefaultSetupActionValue,
  validateWorktreeBranchName,
} from "./NewWorktreeThreadDialog.logic";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";

interface NewWorktreeThreadDialogProps {
  open: boolean;
  /** Project to preselect, usually the one the palette was opened from. */
  initialProjectRef: ScopedProjectRef | null;
  /** Existing worktree branch to preselect when opened contextually. */
  initialBaseBranch: string | null;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: {
    projectRef: ScopedProjectRef;
    baseBranch: string;
    worktreeBranchName: string;
    worktreeSetupScriptId: string;
    startFromOrigin: boolean;
  }) => Promise<void> | void;
}

export function NewWorktreeThreadDialog({
  open,
  initialProjectRef,
  initialBaseBranch,
  onOpenChange,
  onCreate,
}: NewWorktreeThreadDialogProps) {
  const projects = useProjects();
  const primaryServerSettings = useAtomValue(primaryServerSettingsAtom);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [projectKey, setProjectKey] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [baseBranch, setBaseBranch] = useState<string | null>(null);
  const [setupScriptId, setSetupScriptId] = useState<string | null>(null);
  const [startFromOrigin, setStartFromOrigin] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const projectOptions = useMemo(
    () =>
      projects.map((project) => ({
        key: `${project.environmentId}:${project.id}`,
        project,
      })),
    [projects],
  );
  const activeProject = projectOptions.find((option) => option.key === projectKey)?.project ?? null;

  // Every field resets on open so a dialog reopened after a cancel does not
  // resurrect the previous run's name or branch.
  useEffect(() => {
    if (!open) return;
    const preselectedKey = initialProjectRef
      ? `${initialProjectRef.environmentId}:${initialProjectRef.projectId}`
      : null;
    const resolvedKey =
      (preselectedKey && projectOptions.some((option) => option.key === preselectedKey)
        ? preselectedKey
        : null) ??
      projectOptions[0]?.key ??
      null;
    const contextualProjectSelected = preselectedKey !== null && resolvedKey === preselectedKey;
    setProjectKey(resolvedKey);
    setName(buildTemporaryWorktreeBranchName(randomHex));
    setBaseBranch(contextualProjectSelected ? initialBaseBranch : null);
    setSetupScriptId(null);
    setStartFromOrigin(primaryServerSettings.newWorktreesStartFromOrigin);
    setHasAttemptedSubmit(false);
    setIsCreating(false);
    const frame = window.requestAnimationFrame(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
    // `projectOptions` is deliberately excluded: a project list refresh while
    // the dialog is open must not wipe what the user already typed.
  }, [
    open,
    initialBaseBranch,
    initialProjectRef,
    primaryServerSettings.newWorktreesStartFromOrigin,
  ]);

  const branches = useBranches({
    environmentId: open && activeProject ? activeProject.environmentId : null,
    cwd: open && activeProject ? activeProject.workspaceRoot : null,
  });
  const refs = useMemo(() => branches.data?.refs ?? [], [branches.data]);
  const localRefs = useMemo(() => refs.filter((ref) => ref.isRemote !== true), [refs]);
  const existingBranchNames = useMemo(() => refs.map((ref) => ref.name), [refs]);
  const effectiveBaseBranch = baseBranch ?? resolveDefaultBaseBranch(refs);

  const setupActionOptions = useMemo(
    () => buildSetupActionOptions(activeProject?.scripts ?? []),
    [activeProject?.scripts],
  );
  const effectiveSetupScriptId =
    setupScriptId ?? resolveDefaultSetupActionValue(activeProject?.scripts ?? []);

  const nameError = validateWorktreeBranchName({ value: name, existingBranchNames });
  const showNameError = hasAttemptedSubmit && nameError !== null;
  const canSubmit =
    !isCreating && activeProject !== null && effectiveBaseBranch !== null && nameError === null;

  const handleSubmit = async () => {
    setHasAttemptedSubmit(true);
    if (!canSubmit || !activeProject || !effectiveBaseBranch) {
      return;
    }
    setIsCreating(true);
    try {
      await onCreate({
        projectRef: scopeProjectRef(activeProject.environmentId, activeProject.id),
        baseBranch: effectiveBaseBranch,
        worktreeBranchName: normalizeWorktreeBranchName(name),
        worktreeSetupScriptId: effectiveSetupScriptId,
        startFromOrigin,
      });
    } finally {
      setIsCreating(false);
    }
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isCreating) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranchPlusIcon className="size-4" />
            New worktree
          </DialogTitle>
          <DialogDescription>
            Start a thread in a dedicated worktree. The branch is created from the base branch when
            you send your first message.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {projectOptions.length > 1 ? (
            <label className="grid gap-1.5">
              <span className="font-medium text-foreground text-xs">Project</span>
              <Select
                value={projectKey ?? ""}
                onValueChange={(value) => {
                  setProjectKey(typeof value === "string" ? value : null);
                  // Branch and script lists belong to the old project.
                  setBaseBranch(null);
                  setSetupScriptId(null);
                }}
              >
                <SelectTrigger size="sm" className="w-full" aria-label="Project">
                  <SelectValue>{activeProject?.title ?? "Select a project"}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="start" alignItemWithTrigger={false}>
                  {projectOptions.map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                      {option.project.title}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </label>
          ) : null}

          <label className="grid gap-1.5">
            <span className="font-medium text-foreground text-xs">Worktree name</span>
            <Input
              ref={nameInputRef}
              size="sm"
              placeholder="fix-login"
              value={name}
              aria-invalid={showNameError}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                void handleSubmit();
              }}
            />
            {showNameError ? (
              <span className="text-[11px] text-destructive">{nameError}</span>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                Used as the branch name, and for the worktree directory.
              </span>
            )}
          </label>

          <label className="grid gap-1.5">
            <span className="font-medium text-foreground text-xs">Base branch</span>
            <Select
              value={effectiveBaseBranch ?? ""}
              onValueChange={(value) => setBaseBranch(typeof value === "string" ? value : null)}
            >
              <SelectTrigger size="sm" className="w-full" aria-label="Base branch">
                <SelectValue>
                  {effectiveBaseBranch ??
                    (branches.isPending ? "Loading branches..." : "No branches found")}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="start" alignItemWithTrigger={false}>
                {localRefs.map((ref) => (
                  <SelectItem key={ref.name} value={ref.name}>
                    {ref.name}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </label>

          <label className="grid gap-1.5">
            <span className="font-medium text-foreground text-xs">Run when created</span>
            <Select
              value={effectiveSetupScriptId}
              onValueChange={(value) => setSetupScriptId(typeof value === "string" ? value : null)}
            >
              <SelectTrigger size="sm" className="w-full" aria-label="Action to run when created">
                <SelectValue>
                  {setupActionOptions.find((option) => option.value === effectiveSetupScriptId)
                    ?.label ?? "No action"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="start" alignItemWithTrigger={false}>
                {setupActionOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            <span className="text-[11px] text-muted-foreground">
              Applies to this worktree only — the project's default is unchanged.
            </span>
          </label>

          <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm dark:border-transparent dark:bg-white/[0.035]">
            <span>Start from origin</span>
            <Switch
              checked={startFromOrigin}
              onCheckedChange={(checked) => setStartFromOrigin(Boolean(checked))}
            />
          </label>
        </DialogPanel>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isCreating}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              void handleSubmit();
            }}
            disabled={isCreating || activeProject === null || effectiveBaseBranch === null}
          >
            {isCreating ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
