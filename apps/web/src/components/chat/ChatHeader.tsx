import {
  type EnvironmentId,
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@aqqua/contracts";
import { scopeThreadRef } from "@aqqua/client-runtime/environment";
import { MessageSquareIcon } from "lucide-react";
import { memo, type ReactNode } from "react";
import GitActionsControl from "../GitActionsControl";
import { type DraftId } from "~/composerDraftStore";
import ProjectScriptsControl, {
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
} from "../ProjectScriptsControl";
import { OpenInPicker } from "./OpenInPicker";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAqquaProjectFileScripts } from "~/hooks/useAqquaProjectFileScripts";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Button } from "../ui/button";

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  draftId?: DraftId;
  activeProjectName: string | undefined;
  activeProjectCwd: string | null;
  openInCwd: string | null;
  activeProjectScripts: ReadonlyArray<ProjectScript> | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  rail?: boolean;
  /** Compact workspace tool picker when the activity rail cannot fit. */
  rightPanelSurfaceControls?: ReactNode;
  gitCwd: string | null;
  /** Worktree context shown with the project actions. */
  worktreeLabel?: string;
  /** "3 worktrees · 4 open conversations" — the shape of the workspace, in words. */
  worktreeSummary?: string;
  /** Settle-all / delete for the breadcrumb's worktree. */
  worktreeActions?: ReactNode;
  onOpenPullRequest?: () => void;
  onNewThreadInProject: () => void;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onUpdateProjectScript: (
    scriptId: string,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDeleteProjectScript: (scriptId: string) => Promise<ProjectScriptActionResult>;
}

export function shouldShowOpenInPicker(input: {
  readonly activeProjectName: string | undefined;
  readonly activeThreadEnvironmentId: EnvironmentId;
  readonly primaryEnvironmentId: EnvironmentId | null;
}): boolean {
  return (
    Boolean(input.activeProjectName) &&
    input.primaryEnvironmentId !== null &&
    input.activeThreadEnvironmentId === input.primaryEnvironmentId
  );
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadEnvironmentId,
  activeThreadId,
  draftId,
  activeProjectName,
  activeProjectCwd,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  rail = false,
  rightPanelSurfaceControls,
  gitCwd,
  worktreeLabel,
  worktreeSummary,
  worktreeActions,
  onOpenPullRequest,
  onNewThreadInProject,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
}: ChatHeaderProps) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const fileScripts = useAqquaProjectFileScripts(
    activeThreadEnvironmentId,
    activeProjectScripts ? activeProjectCwd : null,
  );
  const showOpenInPicker = shouldShowOpenInPicker({
    activeProjectName,
    activeThreadEnvironmentId,
    primaryEnvironmentId,
  });
  return (
    <div
      data-chat-header-actions
      role="group"
      aria-label={
        [activeProjectName, worktreeLabel, worktreeSummary].filter(Boolean).join(" · ") ||
        "Project actions"
      }
      className={cn(
        "flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]",
        rail ? "w-10 flex-col gap-0" : "flex-wrap [&_span.sr-only]:not-sr-only",
      )}
    >
      {activeProjectName ? (
        <>
          {showOpenInPicker ? (
            <OpenInPicker
              rail={rail}
              environmentId={activeThreadEnvironmentId}
              keybindings={keybindings}
              availableEditors={availableEditors}
              openInCwd={openInCwd}
            />
          ) : null}
          {activeProjectScripts ? (
            <ProjectScriptsControl
              rail={rail}
              scripts={activeProjectScripts}
              fileScripts={fileScripts}
              keybindings={keybindings}
              preferredScriptId={preferredScriptId}
              onRunScript={onRunProjectScript}
              onAddScript={onAddProjectScript}
              onUpdateScript={onUpdateProjectScript}
              onDeleteScript={onDeleteProjectScript}
            />
          ) : null}
          <GitActionsControl
            rail={rail}
            gitCwd={gitCwd}
            activeThreadRef={scopeThreadRef(activeThreadEnvironmentId, activeThreadId)}
            {...(draftId ? { draftId } : {})}
            {...(onOpenPullRequest ? { onOpenPullRequest } : {})}
          />
          {worktreeActions}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size={rail ? "icon-xs" : "sm"}
                  className={
                    rail
                      ? "size-10! shrink-0 rounded-md border-0 px-0 text-muted-foreground shadow-none hover:text-foreground"
                      : undefined
                  }
                  aria-label="New thread in project"
                  onClick={onNewThreadInProject}
                />
              }
            >
              <MessageSquareIcon aria-hidden className={rail ? "size-[18px]" : "size-3.5"} />
              {rail ? null : "New thread in project"}
            </TooltipTrigger>
            <TooltipPopup side={rail ? "left" : "bottom"}>New thread in project</TooltipPopup>
          </Tooltip>
        </>
      ) : null}
      {rightPanelSurfaceControls}
    </div>
  );
});
