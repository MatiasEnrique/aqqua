import {
  type EnvironmentId,
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@aqqua/contracts";
import { scopeThreadRef } from "@aqqua/client-runtime/environment";
import { ChevronRightIcon } from "lucide-react";
import { memo, type ReactNode } from "react";
import GitActionsControl from "../GitActionsControl";
import { type DraftId } from "~/composerDraftStore";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, {
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
} from "../ProjectScriptsControl";
import { OpenInPicker } from "./OpenInPicker";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAqquaProjectFileScripts } from "~/hooks/useAqquaProjectFileScripts";
import { ProjectFavicon } from "../ProjectFavicon";
import { cn } from "~/lib/utils";

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  draftId?: DraftId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  activeProjectCwd: string | null;
  openInCwd: string | null;
  activeProjectScripts: ReadonlyArray<ProjectScript> | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  rightPanelOpen: boolean;
  /** Per-surface right-panel icon buttons (Files / Diff / Terminal / Browser). */
  rightPanelSurfaceControls?: ReactNode;
  gitCwd: string | null;
  /**
   * In `worktree-tabs` mode the breadcrumb names the *worktree* and the tab
   * strip below names the conversation, so the thread title would be said
   * twice. Left undefined, the header keeps its original thread breadcrumb.
   */
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
  activeThreadTitle,
  activeProjectName,
  activeProjectCwd,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  rightPanelOpen,
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
    <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
        {/* The project always leads the header: knowing which project a
            thread lives in is priority zero, and the thread title alone
            doesn't answer it. */}
        {activeProjectName ? (
          <span className="inline-flex shrink-0 items-center gap-2">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={`New thread in ${activeProjectName}`}
                    onClick={onNewThreadInProject}
                    className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  />
                }
              >
                <ProjectFavicon
                  environmentId={activeThreadEnvironmentId}
                  cwd={activeProjectCwd ?? ""}
                  className="size-3.5"
                />
                <span className="max-w-40 truncate text-sm font-medium">{activeProjectName}</span>
              </TooltipTrigger>
              <TooltipPopup side="top">New thread in {activeProjectName}</TooltipPopup>
            </Tooltip>
            <ChevronRightIcon aria-hidden className="size-3.5 text-muted-foreground/40" />
          </span>
        ) : null}
        {/* With tabs below, the breadcrumb's job is the *container*: the strip
            already says which conversation is open, and repeating it here
            spends the one line that answers "where am I". */}
        {worktreeLabel === undefined ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <h2
                  aria-label={activeThreadTitle}
                  className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
                >
                  {activeThreadTitle}
                </h2>
              }
            />
            <TooltipPopup side="top">{activeThreadTitle}</TooltipPopup>
          </Tooltip>
        ) : (
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <h2
                    aria-label={`Worktree ${worktreeLabel}`}
                    className="min-w-0 truncate text-sm font-medium text-foreground"
                  >
                    {worktreeLabel}
                  </h2>
                }
              />
              <TooltipPopup side="top">Worktree {worktreeLabel}</TooltipPopup>
            </Tooltip>
            {worktreeSummary ? (
              <span className="hidden min-w-0 shrink truncate text-xs text-muted-foreground/70 @2xl/header-actions:inline">
                {worktreeSummary}
              </span>
            ) : null}
            {worktreeActions}
          </>
        )}
      </div>
      <div
        data-chat-header-actions
        className={cn(
          "flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3",
          // When the panel is closed the terminal-drawer toggle floats over the
          // header as an absolute overlay; leave room for it.
          rightPanelOpen ? "pr-0" : "pr-8",
        )}
      >
        {activeProjectScripts && (
          <ProjectScriptsControl
            scripts={activeProjectScripts}
            fileScripts={fileScripts}
            keybindings={keybindings}
            preferredScriptId={preferredScriptId}
            onRunScript={onRunProjectScript}
            onAddScript={onAddProjectScript}
            onUpdateScript={onUpdateProjectScript}
            onDeleteScript={onDeleteProjectScript}
          />
        )}
        {showOpenInPicker && (
          <OpenInPicker
            environmentId={activeThreadEnvironmentId}
            keybindings={keybindings}
            availableEditors={availableEditors}
            openInCwd={openInCwd}
          />
        )}
        {activeProjectName && (
          <GitActionsControl
            gitCwd={gitCwd}
            activeThreadRef={scopeThreadRef(activeThreadEnvironmentId, activeThreadId)}
            {...(draftId ? { draftId } : {})}
            {...(onOpenPullRequest ? { onOpenPullRequest } : {})}
          />
        )}
        {rightPanelSurfaceControls}
      </div>
    </div>
  );
});
