import type { GitChangeRequestCommit, GitListChangeRequestCommitsResult } from "@aqqua/contracts";
import { ExternalLinkIcon } from "lucide-react";

import { useOpenPrLink } from "~/lib/openPullRequestLink";
import { cn } from "~/lib/utils";
import type { EnvironmentQueryView } from "~/state/query";

import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { formatPullRequestCommitRow } from "./PullRequestCommitsSection.logic";
import { PullRequestSection } from "./PullRequestSection";

export function PullRequestCommitsSection(props: {
  readonly query: EnvironmentQueryView<GitListChangeRequestCommitsResult>;
  readonly prUrl: string;
  readonly onFirstOpen: () => void;
  readonly onSelect: (commit: GitChangeRequestCommit) => void;
}) {
  const openPrLink = useOpenPrLink();
  const data = props.query.data;
  return (
    <PullRequestSection
      title="Commits"
      defaultOpen={false}
      onOpenChange={(open) => {
        if (open) props.onFirstOpen();
      }}
    >
      {props.query.isPending && data === null ? (
        <div className="space-y-2 px-4 pb-4">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-11 w-full" />
          ))}
        </div>
      ) : props.query.error && data === null ? (
        <div className="px-4 pb-4 text-xs text-muted-foreground">
          Could not load commits.{" "}
          <Button variant="link" size="xs" onClick={() => void props.query.refresh()}>
            Retry
          </Button>
        </div>
      ) : data?.supported === false ? (
        <p className="px-4 pb-4 text-xs text-muted-foreground">
          Commit details are not supported by this provider.
        </p>
      ) : !data || data.commits.length === 0 ? (
        <p className="px-4 pb-4 text-xs text-muted-foreground">No commits were reported.</p>
      ) : (
        <div className="pb-2">
          {data.commits.map((commit) => {
            const row = formatPullRequestCommitRow(commit);
            const content = (
              <>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {row.shortSha}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{row.headline}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {row.author} · {row.relativeTime}
                  </span>
                </span>
              </>
            );
            return (
              <div key={commit.oid} className="flex items-center gap-1 px-2">
                {data.commitsAvailableLocally ? (
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => props.onSelect(commit)}
                  >
                    {content}
                  </button>
                ) : (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <div className="flex min-w-0 flex-1 cursor-not-allowed items-center gap-3 px-2 py-2 opacity-70" />
                      }
                      tabIndex={0}
                      aria-disabled="true"
                    >
                      {content}
                    </TooltipTrigger>
                    <TooltipPopup>Commit not available locally</TooltipPopup>
                  </Tooltip>
                )}
                {!data.commitsAvailableLocally ? (
                  <a
                    href={`${props.prUrl.replace(/\/$/, "")}/commits/${commit.oid}`}
                    aria-label={`Open commit ${row.shortSha} on GitHub`}
                    className={cn(
                      "rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                    onClick={(event) => openPrLink(event, event.currentTarget.href)}
                  >
                    <ExternalLinkIcon className="size-3.5" />
                  </a>
                ) : null}
              </div>
            );
          })}
          {data.truncated ? (
            <p className="px-4 pt-2 text-[11px] text-muted-foreground">
              Only the first commits are shown.
            </p>
          ) : null}
        </div>
      )}
    </PullRequestSection>
  );
}
