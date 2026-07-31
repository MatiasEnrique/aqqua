import type {
  EnvironmentId,
  GitHistoryCommitSummary,
  GitHistoryFileChange,
} from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { FileDiff } from "@pierre/diffs/react";
import {
  ArrowLeft,
  Check,
  Copy,
  GitBranch,
  GitCommitHorizontal,
  LoaderCircle,
  RefreshCw,
  Tag,
} from "lucide-react";
import { useMemo, useState } from "react";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useClientSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import { getRenderablePatch, resolveDiffThemeName } from "../../lib/diffRendering";
import { cn } from "../../lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { vcsEnvironment } from "../../state/vcs";
import { formatChatTimestampTooltip, formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Skeleton } from "../ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { layoutGitHistoryGraph, type GitHistoryGraphRow } from "./gitHistoryGraph";
import { usePaginatedGitHistory } from "./gitHistoryQuery";

const ROW_HEIGHT = 52;
const LANE_WIDTH = 14;
const GRAPH_COLORS = ["#2563eb", "#059669", "#d97706", "#7c3aed", "#e11d48", "#0891b2"];

function graphColor(colorSlot: number): string {
  return GRAPH_COLORS[colorSlot % GRAPH_COLORS.length]!;
}

function laneX(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2 + 2;
}

function GraphCell({ row }: { row: GitHistoryGraphRow }) {
  const width = row.laneCount * LANE_WIDTH + 6;
  const middle = ROW_HEIGHT / 2;
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={ROW_HEIGHT}
      viewBox={`0 0 ${width} ${ROW_HEIGHT}`}
      className="shrink-0"
    >
      {row.edges.map((edge) => {
        const fromX = laneX(edge.fromLane);
        const toX = laneX(edge.toLane);
        const path =
          edge.phase === "incoming"
            ? `M ${fromX} 0 C ${fromX} ${middle / 2}, ${toX} ${middle / 2}, ${toX} ${middle}`
            : edge.phase === "outgoing"
              ? `M ${fromX} ${middle} C ${fromX} ${middle + middle / 2}, ${toX} ${middle + middle / 2}, ${toX} ${ROW_HEIGHT}`
              : `M ${fromX} 0 C ${fromX} ${middle}, ${toX} ${middle}, ${toX} ${ROW_HEIGHT}`;
        return (
          <path
            key={`${edge.phase}:${edge.fromLane}:${edge.toLane}:${edge.colorSlot}`}
            d={path}
            fill="none"
            stroke={graphColor(edge.colorSlot)}
            strokeWidth="2"
            strokeLinecap="round"
          />
        );
      })}
      <circle
        cx={laneX(row.nodeLane)}
        cy={middle}
        r="4.5"
        fill="var(--color-background)"
        stroke={graphColor(row.nodeColorSlot)}
        strokeWidth="2.5"
      />
    </svg>
  );
}

function RefBadge({ refName, kind }: { refName: string; kind: string }) {
  const RefIcon = kind === "tag" ? Tag : GitBranch;
  const kindLabel =
    kind === "local_branch" ? "Local branch" : kind === "remote_branch" ? "Remote branch" : "Tag";
  return (
    <span
      className={cn(
        "inline-flex max-w-36 items-center gap-1 truncate rounded px-1.5 py-0.5 text-[10px] font-medium",
        kind === "local_branch" && "bg-blue-500/12 text-blue-700 dark:text-blue-300",
        kind === "remote_branch" && "bg-violet-500/12 text-violet-700 dark:text-violet-300",
        kind === "tag" && "bg-amber-500/14 text-amber-800 dark:text-amber-300",
      )}
      title={`${kindLabel}: ${refName}`}
    >
      <RefIcon className="size-2.5 shrink-0" aria-hidden />
      <span className="truncate">{refName}</span>
    </span>
  );
}

function CommitRow(props: {
  commit: GitHistoryCommitSummary;
  graph: GitHistoryGraphRow;
  selected: boolean;
  timestampFormat: TimestampFormat;
  onSelect: () => void;
}) {
  const subject = props.commit.subject || "(no commit message)";
  const refNames = [
    ...(props.commit.isHead ? ["HEAD"] : []),
    ...props.commit.refs.map((ref) => `${ref.kind.replace("_", " ")} ${ref.name}`),
  ].join(", ");
  const relativeTime = formatRelativeTimeLabel(props.commit.authoredAt);
  return (
    <button
      type="button"
      onClick={props.onSelect}
      aria-pressed={props.selected}
      aria-label={`${subject}, ${props.commit.id.slice(0, 7)}${refNames ? `, ${refNames}` : ""}, ${props.commit.authorName}, ${relativeTime}`}
      className={cn(
        "flex h-[52px] min-w-max w-full items-stretch text-left outline-none transition-colors hover:bg-accent/55 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        props.selected && "bg-accent",
      )}
    >
      <GraphCell row={props.graph} />
      <div className="flex min-w-64 flex-1 flex-col justify-center overflow-hidden pr-3">
        <div className="flex min-w-0 items-center gap-1.5">
          {props.commit.isHead ? (
            <span className="rounded bg-foreground px-1.5 py-0.5 text-[10px] font-semibold text-background">
              HEAD
            </span>
          ) : null}
          {props.commit.refs.map((ref) => (
            <RefBadge key={`${ref.kind}:${ref.name}`} refName={ref.name} kind={ref.kind} />
          ))}
          <span className="truncate text-xs font-medium text-foreground">{subject}</span>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-mono">{props.commit.id.slice(0, 7)}</span>
          <span className="truncate">{props.commit.authorName || props.commit.authorEmail}</span>
          <span
            className="shrink-0"
            title={formatChatTimestampTooltip(props.commit.authoredAt, props.timestampFormat)}
          >
            {relativeTime}
          </span>
        </div>
      </div>
    </button>
  );
}

function FileChangeRow(props: {
  file: GitHistoryFileChange;
  selected: boolean;
  onSelect: () => void;
}) {
  const file = props.file;
  const counts = file.binary
    ? "Binary · counts unavailable"
    : `+${file.insertions ?? 0} −${file.deletions ?? 0}`;
  return (
    <button
      type="button"
      onClick={props.onSelect}
      aria-label={`Show diff for ${file.path}`}
      aria-pressed={props.selected}
      className={cn(
        "flex w-full min-w-0 items-center gap-2 border-b border-border/50 px-3 py-2 text-left text-xs outline-none transition-colors last:border-0 hover:bg-accent/55 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        props.selected && "bg-accent",
      )}
    >
      <span className="w-16 shrink-0 capitalize text-muted-foreground">
        {file.kind.replace("_", " ")}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={file.path}>
        {file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
      </span>
      <span className={cn("shrink-0 font-mono", file.binary && "text-muted-foreground")}>
        {counts}
      </span>
    </button>
  );
}

function CommitCodeDiff(props: {
  commitId: string;
  file: GitHistoryFileChange;
  diff: string | undefined;
  truncated: boolean;
  isPending: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const { resolvedTheme } = useTheme();
  const wordWrap = useClientSettings((settings) => settings.wordWrap);
  const renderablePatch = useMemo(
    () => getRenderablePatch(props.diff, `git-history:${props.commitId}`),
    [props.commitId, props.diff],
  );
  const fileDiffs = renderablePatch?.kind === "files" ? renderablePatch.files : [];

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Code diff
        </span>
        <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
          {props.file.path}
        </span>
      </div>
      {props.truncated ? (
        <p className="mb-2 rounded-md border border-amber-500/25 bg-amber-500/8 px-2 py-1.5 text-[11px] text-amber-800 dark:text-amber-200">
          Code diff was truncated because this file exceeded the preview limit.
        </p>
      ) : null}
      {props.isPending && !renderablePatch ? (
        <div className="space-y-2" role="status" aria-label={`Loading diff for ${props.file.path}`}>
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : props.error && !renderablePatch ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
          <p>{props.error}</p>
          <Button className="mt-2" variant="outline" size="xs" onClick={props.onRetry}>
            Retry file diff
          </Button>
        </div>
      ) : fileDiffs.length > 0 ? (
        <div className="diff-render-surface space-y-2 overflow-hidden rounded-md border border-border/60">
          {fileDiffs.map((fileDiff, index) => (
            <FileDiff
              key={fileDiff.cacheKey ?? index}
              fileDiff={fileDiff}
              options={{
                collapsed: false,
                diffStyle: "unified",
                overflow: wordWrap ? "wrap" : "scroll",
                theme: resolveDiffThemeName(resolvedTheme),
              }}
            />
          ))}
        </div>
      ) : renderablePatch?.kind === "raw" ? (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">{renderablePatch.reason}</p>
          <pre className="overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-muted/35 p-3 font-mono text-[11px]">
            {renderablePatch.text}
          </pre>
        </div>
      ) : (
        <div className="rounded-md border border-border/60 p-3 text-xs text-muted-foreground">
          {props.truncated
            ? "Only part of this file's diff is available."
            : props.file.binary
              ? "Binary changes cannot be rendered as code."
              : "No code diff is available for this file."}
        </div>
      )}
    </section>
  );
}

export function GitHistoryCommitDetails(props: {
  environmentId: EnvironmentId;
  cwd: string;
  commit: GitHistoryCommitSummary;
  timestampFormat: TimestampFormat;
  onBack: () => void;
}) {
  const details = useEnvironmentQuery(
    vcsEnvironment.commitDetails({
      environmentId: props.environmentId,
      input: { cwd: props.cwd, commitId: props.commit.id },
    }),
  );
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "commit SHA" });
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const selectedFile =
    details.data?.files.find((file) => file.path === selectedFilePath) ??
    details.data?.files[0] ??
    null;
  const fileDiff = useEnvironmentQuery(
    selectedFile
      ? vcsEnvironment.commitFileDiff({
          environmentId: props.environmentId,
          input: {
            cwd: props.cwd,
            commitId: props.commit.id,
            path: selectedFile.path,
            previousPath: selectedFile.previousPath,
          },
        })
      : null,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col border-l border-border/60 bg-background">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 px-2">
        <Button
          variant="ghost"
          size="icon-xs"
          className="@min-[720px]/history:hidden"
          onClick={props.onBack}
          aria-label="Back to Git history"
        >
          <ArrowLeft />
        </Button>
        <GitCommitHorizontal className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {props.commit.subject || "(no commit message)"}
        </span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          <section>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Commit
            </div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all text-xs">{props.commit.id}</code>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => copyToClipboard(props.commit.id, undefined)}
                aria-label="Copy full commit SHA"
              >
                {isCopied ? <Check /> : <Copy />}
              </Button>
            </div>
          </section>

          {props.commit.refs.length > 0 || props.commit.isHead ? (
            <section>
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                References
              </div>
              <div className="flex flex-wrap gap-1.5">
                {props.commit.isHead ? (
                  <span className="rounded bg-foreground px-1.5 py-0.5 text-[10px] font-semibold text-background">
                    HEAD
                  </span>
                ) : null}
                {props.commit.refs.map((ref) => (
                  <RefBadge key={`${ref.kind}:${ref.name}`} refName={ref.name} kind={ref.kind} />
                ))}
              </div>
            </section>
          ) : null}

          <section className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
            <span className="text-muted-foreground">Author</span>
            <span className="min-w-0 break-words">
              {props.commit.authorName} &lt;{props.commit.authorEmail}&gt;
            </span>
            <span className="text-muted-foreground">Authored</span>
            <span>
              {formatChatTimestampTooltip(props.commit.authoredAt, props.timestampFormat)}
            </span>
            <span className="text-muted-foreground">Committer</span>
            <span className="min-w-0 break-words">
              {details.data
                ? `${details.data.committerName} <${details.data.committerEmail}>`
                : details.error
                  ? "Unavailable"
                  : "Loading…"}
            </span>
            <span className="text-muted-foreground">Committed</span>
            <span>
              {formatChatTimestampTooltip(
                details.data?.committedAt ?? props.commit.committedAt,
                props.timestampFormat,
              )}
            </span>
          </section>

          {props.commit.parentIds.length > 0 ? (
            <section>
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Parents
              </div>
              <div className="space-y-1">
                {props.commit.parentIds.map((parentId) => (
                  <code
                    key={parentId}
                    className="block break-all text-[11px] text-muted-foreground"
                  >
                    {parentId}
                  </code>
                ))}
              </div>
            </section>
          ) : null}

          {details.isPending && !details.data ? (
            <div className="space-y-2" role="status" aria-label="Loading commit details">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : details.error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
              <p>{details.error}</p>
              <Button className="mt-2" variant="outline" size="xs" onClick={details.refresh}>
                Retry
              </Button>
            </div>
          ) : details.data ? (
            <>
              {details.data.body ? (
                <section>
                  <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Message
                  </div>
                  <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/55 p-3 font-sans text-xs">
                    {details.data.body}
                  </pre>
                  {details.data.bodyTruncated ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Commit message was truncated.
                    </p>
                  ) : null}
                </section>
              ) : null}
              <section>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Changed files
                  </span>
                  {details.data.comparisonParentId ? (
                    <span className="text-[10px] text-muted-foreground">
                      Changes against first parent
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">Root commit</span>
                  )}
                </div>
                <div className="overflow-hidden rounded-md border border-border/60">
                  {details.data.files.length > 0 ? (
                    details.data.files.map((file) => (
                      <FileChangeRow
                        key={`${file.previousPath ?? ""}:${file.path}:${file.kind}`}
                        file={file}
                        selected={file.path === selectedFile?.path}
                        onSelect={() => setSelectedFilePath(file.path)}
                      />
                    ))
                  ) : (
                    <div className="p-3 text-xs text-muted-foreground">No file changes.</div>
                  )}
                </div>
                {details.data.filesTruncated ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Changed-file details were truncated.
                  </p>
                ) : null}
              </section>
              {selectedFile ? (
                <CommitCodeDiff
                  commitId={details.data.commitId}
                  file={selectedFile}
                  diff={fileDiff.data?.diff}
                  truncated={fileDiff.data?.truncated ?? false}
                  isPending={fileDiff.isPending}
                  error={fileDiff.error}
                  onRetry={fileDiff.refresh}
                />
              ) : null}
            </>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}

export function GitHistoryPanel(props: {
  environmentId: EnvironmentId;
  cwd: string;
  repositoryRefName?: string | null;
  timestampFormat: TimestampFormat;
}) {
  const history = usePaginatedGitHistory({
    environmentId: props.environmentId,
    cwd: props.cwd,
  });
  const [selectedCommitId, setSelectedCommitId] = useState<string | null>(null);
  const selectedCommit = history.commits.find((commit) => commit.id === selectedCommitId) ?? null;
  const graphRows = useMemo(() => layoutGitHistoryGraph(history.commits), [history.commits]);
  const currentRef = history.commits.flatMap((commit) => commit.refs).find((ref) => ref.current);
  const repositoryName = props.cwd.split(/[\\/]/).findLast((part) => part.length > 0) ?? props.cwd;
  const refName = currentRef?.name ?? props.repositoryRefName;
  const refresh = () => {
    setSelectedCommitId(null);
    history.refresh();
  };

  return (
    <div className="@container/history flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium">History</div>
          <div className="truncate text-[10px] text-muted-foreground">
            {refName ? `${repositoryName} · ${refName}` : repositoryName}
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={refresh}
                disabled={history.isPending}
                aria-label="Refresh Git history"
              >
                <RefreshCw className={cn(history.isPending && "animate-spin")} />
              </Button>
            }
          />
          <TooltipPopup side="bottom">Refresh Git history</TooltipPopup>
        </Tooltip>
      </div>

      <div className="@min-[720px]/history:grid @min-[720px]/history:grid-cols-[minmax(360px,1fr)_minmax(320px,0.8fr)] flex min-h-0 flex-1">
        <div
          className={cn(
            "min-h-0 min-w-0 flex-1 flex-col",
            selectedCommit ? "hidden @min-[720px]/history:flex" : "flex",
          )}
        >
          {history.isPending && !history.data ? (
            <div className="space-y-1 p-2" role="status" aria-label="Loading Git history">
              {Array.from({ length: 7 }, (_, index) => (
                <Skeleton key={index} className="h-[52px] w-full rounded-md" />
              ))}
            </div>
          ) : history.initialError && !history.data ? (
            <div className="m-auto max-w-sm p-6 text-center">
              <p className="text-sm font-medium">Could not load Git history</p>
              <p className="mt-1 text-xs text-muted-foreground">{history.initialError}</p>
              <Button className="mt-3" variant="outline" size="sm" onClick={refresh}>
                Retry
              </Button>
            </div>
          ) : history.data?.isRepo === false ? (
            <div className="m-auto p-6 text-center">
              <p className="text-sm font-medium">Not a Git repository</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Git history is unavailable for this workspace.
              </p>
            </div>
          ) : history.commits.length === 0 ? (
            <div className="m-auto p-6 text-center">
              <p className="text-sm font-medium">No commits yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                The repository has no reachable commits.
              </p>
            </div>
          ) : (
            <>
              {history.initialError ? (
                <div
                  className="flex items-center gap-2 border-b border-destructive/25 bg-destructive/5 px-3 py-2 text-[11px]"
                  role="status"
                >
                  <span className="min-w-0 flex-1 truncate">{history.initialError}</span>
                  <Button variant="outline" size="xs" onClick={refresh}>
                    Retry
                  </Button>
                </div>
              ) : null}
              {history.data?.referencesTruncated ? (
                <div className="border-b border-border/60 bg-amber-500/8 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
                  Some reference labels were omitted because the repository has too many refs.
                </div>
              ) : null}
              <ScrollArea className="min-h-0 flex-1">
                <div className="min-w-max divide-y divide-border/35">
                  {history.commits.map((commit, index) => (
                    <CommitRow
                      key={commit.id}
                      commit={commit}
                      graph={graphRows[index]!}
                      selected={commit.id === selectedCommitId}
                      timestampFormat={props.timestampFormat}
                      onSelect={() => setSelectedCommitId(commit.id)}
                    />
                  ))}
                </div>
                <div className="flex min-h-12 items-center justify-center border-t border-border/50 p-2">
                  {history.olderError ? (
                    <div className="text-center">
                      <p className="text-xs text-destructive">{history.olderError}</p>
                      <Button
                        className="mt-2"
                        variant="outline"
                        size="xs"
                        onClick={history.retryOlder}
                      >
                        Retry older commits
                      </Button>
                    </div>
                  ) : history.data?.nextCursor !== null ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={history.loadOlder}
                      disabled={history.isLoadingOlder}
                    >
                      {history.isLoadingOlder ? <LoaderCircle className="animate-spin" /> : null}
                      Load older commits
                    </Button>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">End of history</span>
                  )}
                </div>
              </ScrollArea>
            </>
          )}
        </div>

        {selectedCommit ? (
          <GitHistoryCommitDetails
            key={selectedCommit.id}
            environmentId={props.environmentId}
            cwd={props.cwd}
            commit={selectedCommit}
            timestampFormat={props.timestampFormat}
            onBack={() => setSelectedCommitId(null)}
          />
        ) : (
          <div className="@max-[719px]/history:hidden hidden min-h-0 items-center justify-center border-l border-border/60 p-6 text-center text-xs text-muted-foreground @min-[720px]/history:flex">
            Select a commit to inspect its details.
          </div>
        )}
      </div>
    </div>
  );
}
