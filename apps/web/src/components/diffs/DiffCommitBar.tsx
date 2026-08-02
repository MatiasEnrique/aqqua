import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@aqqua/client-runtime/state/runtime";
import type { EnvironmentId, GitActionProgressEvent, GitStackedAction } from "@aqqua/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { useOpenPrLink } from "~/lib/openPullRequestLink";
import { useGitStackedAction, useSourceControlActionRunning } from "~/lib/sourceControlActions";
import { randomUUID } from "~/lib/utils";

import { buildGitActionProgressStages } from "../GitActionsControl.logic";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { setAllCommitFilesIncluded, summarizeCommitSelection } from "./diffCommitSelection";
import type { DiffCommitFile } from "./diffCommitSelection";

const DIFF_COMMIT_ACTIONS = [
  { action: "commit", label: "Commit", variant: "default" },
  { action: "commit_push", label: "Commit & push", variant: "outline" },
  { action: "commit_push_pr", label: "Commit, push & PR", variant: "outline" },
] as const satisfies ReadonlyArray<{
  action: GitStackedAction;
  label: string;
  variant: "default" | "outline";
}>;

const RUNNING_SOURCE_CONTROL_ACTIONS = ["runStackedAction", "pull", "publishRepository"] as const;

interface DiffCommitProgress {
  readonly label: string;
  readonly detail: string | null;
}

interface DiffCommitOutcome {
  readonly title: string;
  readonly description: string | null;
  readonly pullRequestUrl: string | null;
}

interface DiffCommitBarProps {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  files: ReadonlyArray<DiffCommitFile>;
  excludedPaths: ReadonlySet<string>;
  onExcludedPathsChange: (excludedPaths: ReadonlySet<string>) => void;
  /** Called after an action succeeds so the panel can refetch the diff. */
  onActionCompleted: () => void;
}

export function DiffCommitBar({
  environmentId,
  cwd,
  files,
  excludedPaths,
  onExcludedPathsChange,
  onActionCompleted,
}: DiffCommitBarProps) {
  const scope = useMemo(() => ({ environmentId, cwd }), [cwd, environmentId]);
  const gitAction = useGitStackedAction(scope);
  const isSourceControlBusy = useSourceControlActionRunning(scope, RUNNING_SOURCE_CONTROL_ACTIONS);
  const openPrLink = useOpenPrLink();

  const [commitMessage, setCommitMessage] = useState("");
  const [runningAction, setRunningAction] = useState<GitStackedAction | null>(null);
  const [progress, setProgress] = useState<DiffCommitProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<DiffCommitOutcome | null>(null);

  const summary = summarizeCommitSelection(files, excludedPaths);
  const hasFiles = summary.totalCount > 0;
  const isBusy = runningAction !== null || isSourceControlBusy;
  const canRun = !isBusy && hasFiles && !summary.noneIncluded;

  const applyProgressEvent = useCallback((event: GitActionProgressEvent) => {
    switch (event.kind) {
      case "phase_started":
        setProgress({ label: event.label, detail: null });
        return;
      case "hook_started":
        setProgress((current) => ({
          label: current?.label ?? "Running git action...",
          detail: `Running ${event.hookName}...`,
        }));
        return;
      case "hook_output":
        setProgress((current) => ({
          label: current?.label ?? "Running git action...",
          detail: event.text,
        }));
        return;
      case "hook_finished":
        setProgress((current) => (current ? { label: current.label, detail: null } : current));
        return;
      case "action_started":
      case "action_finished":
      case "action_failed":
        // The settled command publishes the final state below.
        return;
    }
  }, []);

  const runAction = useCallback(
    (action: GitStackedAction) => {
      if (isBusy || !hasFiles || summary.noneIncluded) return;
      const trimmedMessage = commitMessage.trim();
      const stages = buildGitActionProgressStages({
        action,
        hasCustomCommitMessage: trimmedMessage.length > 0,
        hasWorkingTreeChanges: files.length > 0,
      });
      setRunningAction(action);
      setError(null);
      setOutcome(null);
      setProgress({ label: stages[0] ?? "Running git action...", detail: null });

      void (async () => {
        const result = await gitAction.run({
          actionId: randomUUID(),
          action,
          ...(trimmedMessage ? { commitMessage: trimmedMessage } : {}),
          ...(summary.filePaths ? { filePaths: summary.filePaths } : {}),
          onProgress: applyProgressEvent,
        });
        setRunningAction(null);
        setProgress(null);

        if (result._tag === "Failure") {
          if (isAtomCommandInterrupted(result)) return;
          const failure = squashAtomCommandFailure(result);
          setError(failure instanceof Error ? failure.message : "The git action failed.");
          return;
        }

        const actionResult = result.value;
        setCommitMessage("");
        setOutcome({
          title: actionResult.toast.title,
          description: actionResult.toast.description ?? null,
          pullRequestUrl: actionResult.pr.url ?? null,
        });
        onActionCompleted();
      })();
    },
    [
      applyProgressEvent,
      commitMessage,
      files.length,
      gitAction,
      hasFiles,
      isBusy,
      onActionCompleted,
      summary.filePaths,
      summary.noneIncluded,
    ],
  );

  return (
    <div className="shrink-0 space-y-2 border-t border-border bg-background px-3 py-2">
      <div className="flex items-center gap-2">
        {hasFiles ? (
          <>
            <Checkbox
              aria-label={
                summary.allIncluded
                  ? "Exclude all files from commit"
                  : "Include all files in commit"
              }
              checked={summary.allIncluded}
              className="size-3.5"
              disabled={isBusy}
              indeterminate={!summary.allIncluded && !summary.noneIncluded}
              onCheckedChange={() => {
                onExcludedPathsChange(setAllCommitFilesIncluded(files, !summary.allIncluded));
              }}
            />
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {summary.includedCount} of {summary.totalCount}{" "}
              {summary.totalCount === 1 ? "file" : "files"} included
            </span>
          </>
        ) : (
          <span className="text-[11px] text-muted-foreground/80">No uncommitted changes.</span>
        )}
      </div>
      <Textarea
        aria-label="Commit message"
        disabled={isBusy}
        onChange={(event) => setCommitMessage(event.target.value)}
        placeholder="Commit message (generated when empty)"
        size="sm"
        value={commitMessage}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        {DIFF_COMMIT_ACTIONS.map((entry) => (
          <Button
            key={entry.action}
            disabled={!canRun}
            onClick={() => runAction(entry.action)}
            size="xs"
            type="button"
            variant={entry.variant}
          >
            {runningAction === entry.action && <Spinner className="size-3" />}
            {entry.label}
          </Button>
        ))}
      </div>
      {hasFiles && summary.noneIncluded && (
        <p className="text-[11px] text-muted-foreground/80">Include at least one file to commit.</p>
      )}
      {progress && (
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <Spinner className="size-3 shrink-0" />
          <span className="shrink-0">{progress.label}</span>
          {progress.detail && (
            <span className="min-w-0 truncate opacity-70">{progress.detail}</span>
          )}
        </div>
      )}
      {error && (
        <p className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      )}
      {outcome && (
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="min-w-0 truncate">
            {outcome.title}
            {outcome.description ? ` — ${outcome.description}` : ""}
          </span>
          {outcome.pullRequestUrl && (
            <Button
              className="shrink-0"
              onClick={(event) => {
                if (outcome.pullRequestUrl) openPrLink(event, outcome.pullRequestUrl);
              }}
              size="xs"
              type="button"
              variant="ghost"
            >
              <ExternalLinkIcon className="size-3" />
              Open
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
