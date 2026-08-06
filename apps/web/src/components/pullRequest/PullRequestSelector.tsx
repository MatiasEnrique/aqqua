import type { EnvironmentId } from "@aqqua/contracts";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useState } from "react";

import { gitEnvironment } from "~/state/git";
import { useEnvironmentQuery } from "~/state/query";

import { selectablePullRequests, type PanelPullRequest } from "../PullRequestPanel.logic";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Skeleton } from "../ui/skeleton";

interface PullRequestSelectorProps {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly branchPr: PanelPullRequest | null;
  readonly activePr: PanelPullRequest | null;
  readonly onSelect: (pr: PanelPullRequest | null) => void;
}

function PullRequestItem(props: {
  readonly pr: PanelPullRequest;
  readonly active: boolean;
  readonly hint?: string;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-start text-sm text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
      onClick={props.onSelect}
    >
      <span className="shrink-0 text-xs tabular-nums">#{props.pr.number}</span>
      <span className="min-w-0 flex-1 truncate">{props.pr.title}</span>
      {props.hint ? (
        <span className="shrink-0 text-xs text-muted-foreground">{props.hint}</span>
      ) : null}
      {props.active ? <CheckIcon className="size-3.5 shrink-0" aria-hidden /> : null}
    </button>
  );
}

export function PullRequestSelector({
  environmentId,
  cwd,
  branchPr,
  activePr,
  onSelect,
}: PullRequestSelectorProps) {
  const [openFor, setOpenFor] = useState<{
    readonly environmentId: EnvironmentId;
    readonly cwd: string;
  } | null>(null);
  const [requestedFor, setRequestedFor] = useState<{
    readonly environmentId: EnvironmentId;
    readonly cwd: string;
  } | null>(null);
  const matchesTarget = (
    target: { readonly environmentId: EnvironmentId; readonly cwd: string } | null,
  ) => target?.environmentId === environmentId && target.cwd === cwd;
  const open = matchesTarget(openFor);
  const hasOpened = matchesTarget(requestedFor);
  const query = useEnvironmentQuery(
    hasOpened
      ? gitEnvironment.repositoryChangeRequests({
          environmentId,
          input: { cwd },
        })
      : null,
  );
  const pullRequests = selectablePullRequests(branchPr, query.data);
  const trackingBranch = branchPr !== null && activePr?.number === branchPr.number;

  if (query.data?.supported === false && branchPr === null) return null;

  const select = (pr: PanelPullRequest | null) => {
    onSelect(pr);
    setOpenFor(null);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpenFor(nextOpen ? { environmentId, cwd } : null);
        if (nextOpen) setRequestedFor({ environmentId, cwd });
      }}
    >
      {activePr === null ? (
        <p className="mb-2 text-xs text-muted-foreground">Or view an open pull request…</p>
      ) : null}
      <div
        className={
          activePr === null ? "flex items-center justify-center gap-2" : "flex items-center gap-2"
        }
      >
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="xs"
              aria-label={
                activePr === null
                  ? "Select pull request"
                  : `Select pull request, currently #${activePr.number}`
              }
            />
          }
        >
          {activePr === null ? "Select pull request" : `#${activePr.number}`}
          <ChevronDownIcon aria-hidden />
        </PopoverTrigger>
        {trackingBranch ? (
          <span className="text-xs text-muted-foreground">current branch</span>
        ) : null}
      </div>
      <PopoverPopup
        align="start"
        className="min-w-64"
        viewportClassName="py-1.5 [--viewport-inline-padding:--spacing(1.5)]"
      >
        <div className="space-y-0.5">
          {branchPr ? (
            <PullRequestItem
              pr={branchPr}
              active={trackingBranch}
              hint="Current branch"
              onSelect={() => select(null)}
            />
          ) : null}
          {query.isPending
            ? [0, 1, 2].map((key) => (
                <Skeleton key={key} className="mx-1 h-8 w-[calc(100%-0.5rem)]" />
              ))
            : null}
          {query.error ? (
            <p className="px-2.5 py-2 text-xs text-muted-foreground">
              Could not load pull requests.{" "}
              <Button variant="link" size="xs" onClick={() => void query.refresh()}>
                Retry
              </Button>
            </p>
          ) : null}
          {!query.isPending && !query.error
            ? pullRequests.map((pr) => (
                <PullRequestItem
                  key={pr.number}
                  pr={pr}
                  active={activePr?.number === pr.number}
                  onSelect={() => select(pr)}
                />
              ))
            : null}
          {query.data?.supported &&
          !query.isPending &&
          !query.error &&
          branchPr === null &&
          pullRequests.length === 0 ? (
            <p className="px-2.5 py-2 text-xs text-muted-foreground">No open pull requests</p>
          ) : null}
        </div>
        {query.data?.supported && query.data.truncated ? (
          <p className="mx-1 mt-1.5 border-t border-border/70 px-1.5 pt-2 text-xs text-muted-foreground">
            Showing first 30 open pull requests
          </p>
        ) : null}
      </PopoverPopup>
    </Popover>
  );
}
