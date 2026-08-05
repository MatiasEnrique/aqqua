import type { EnvironmentId, GitHistoryCommitSummary } from "@aqqua/contracts";
import type { TimestampFormat } from "@aqqua/contracts/settings";
import { GitBranch, GitGraph, LoaderCircle, RefreshCw, Tag } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "../../lib/utils";
import { formatChatTimestampTooltip, formatRelativeTimeLabel } from "../../timestampFormat";
import DiffPanel, { type DiffPanelProps } from "../DiffPanel";
import { PanelSurfaceHeader } from "../PanelSurfaceHeader";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
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

type GitHistoryDiffContext = {
  composerDraftTarget: DiffPanelProps["composerDraftTarget"];
  threadRef: Exclude<DiffPanelProps["threadRef"], undefined>;
  workspaceRef: Exclude<DiffPanelProps["workspaceRef"], undefined>;
};

export function GitHistoryCommitPane(
  props: GitHistoryDiffContext & {
    environmentId: EnvironmentId;
    cwd: string;
    commit: GitHistoryCommitSummary;
    onBack: () => void;
  },
) {
  return (
    <div className="min-h-0 min-w-0 flex-1" data-history-pane="diff">
      <DiffPanel
        mode="embedded"
        composerDraftTarget={props.composerDraftTarget}
        initialGitScope="branch"
        threadRef={props.threadRef}
        workspaceRef={props.workspaceRef}
        fallbackCwd={props.cwd}
        commitTarget={{
          environmentId: props.environmentId,
          cwd: props.cwd,
          commitId: props.commit.id,
          label: props.commit.subject || props.commit.id.slice(0, 7),
          onBack: props.onBack,
        }}
      />
    </div>
  );
}

export function GitHistoryPanel(
  props: GitHistoryDiffContext & {
    environmentId: EnvironmentId;
    cwd: string;
    repositoryRefName?: string | null;
    timestampFormat: TimestampFormat;
  },
) {
  const [includeOrigin, setIncludeOrigin] = useState(false);
  const history = usePaginatedGitHistory({
    environmentId: props.environmentId,
    cwd: props.cwd,
    includeOrigin,
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
  const toggleOrigin = (checked: boolean) => {
    setSelectedCommitId(null);
    setIncludeOrigin(checked);
  };

  return (
    <div className="@container/history flex h-full min-h-0 flex-col bg-background">
      <PanelSurfaceHeader
        icon={GitGraph}
        title="History"
        meta={refName ? `${repositoryName} · ${refName}` : repositoryName}
        actions={
          <>
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
              <Checkbox
                className="size-3.5"
                aria-label="Include origin commits"
                checked={includeOrigin}
                onCheckedChange={(checked) => toggleOrigin(checked === true)}
              />
              <span>Include origin</span>
            </label>
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
          </>
        }
      />

      <div className="@min-[720px]/history:grid @min-[720px]/history:grid-cols-[minmax(0,1fr)_minmax(320px,38%)] flex min-h-0 flex-1">
        {selectedCommit ? (
          <GitHistoryCommitPane
            key={selectedCommit.id}
            environmentId={props.environmentId}
            cwd={props.cwd}
            commit={selectedCommit}
            composerDraftTarget={props.composerDraftTarget}
            threadRef={props.threadRef}
            workspaceRef={props.workspaceRef}
            onBack={() => setSelectedCommitId(null)}
          />
        ) : (
          <div
            className="@max-[719px]/history:hidden hidden min-h-0 items-center justify-center p-6 text-center text-xs text-muted-foreground @min-[720px]/history:flex"
            data-history-pane="diff"
          >
            Select a commit to view its diff.
          </div>
        )}

        <div
          className={cn(
            "min-h-0 min-w-0 flex-1 flex-col @min-[720px]/history:border-l @min-[720px]/history:border-border/60",
            selectedCommit ? "hidden @min-[720px]/history:flex" : "flex",
          )}
          data-history-pane="graph"
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
      </div>
    </div>
  );
}
