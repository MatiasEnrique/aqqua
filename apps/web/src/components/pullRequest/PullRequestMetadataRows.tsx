import type { GitGetChangeRequestConversationResult } from "@aqqua/contracts";
import { GitBranchIcon, MessageSquareIcon, ShieldCheckIcon, UsersIcon } from "lucide-react";

import { cn } from "~/lib/utils";

import {
  aggregateChecksPresentation,
  pullRequestMetadata,
  statusToneClassName,
  type PullRequestStatus,
} from "../PullRequestPanel.logic";
import { ChangeRequestStatusIcon } from "../ChangeRequestChecksBadge";
import { Skeleton } from "../ui/skeleton";

export function PullRequestMetadataRows(props: {
  readonly pr: PullRequestStatus;
  readonly conversation: GitGetChangeRequestConversationResult | null;
  readonly conversationPending: boolean;
}) {
  const metadata = pullRequestMetadata(props);
  const checks = aggregateChecksPresentation(props.pr.checksStatus);
  const rows = [
    {
      label: "Branch",
      icon: GitBranchIcon,
      value: (
        <span className="flex min-w-0 flex-wrap justify-end gap-x-2 gap-y-0.5 text-right">
          <span className="min-w-0 break-all font-mono text-[11px]">{metadata.branchLabel}</span>
          {metadata.additions !== null || metadata.deletions !== null ? (
            <span className="shrink-0 font-mono text-[11px]">
              {metadata.additions !== null ? (
                <span className="text-success-foreground">+{metadata.additions}</span>
              ) : null}{" "}
              {metadata.deletions !== null ? (
                <span className="text-destructive-foreground">-{metadata.deletions}</span>
              ) : null}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      label: "Reviewers",
      icon: UsersIcon,
      value:
        props.conversationPending && props.conversation === null ? (
          <Skeleton className="ms-auto h-3 w-20" />
        ) : (
          metadata.reviewersLabel
        ),
    },
    {
      label: "Comments",
      icon: MessageSquareIcon,
      value:
        props.conversationPending && props.conversation === null ? (
          <Skeleton className="ms-auto h-3 w-16" />
        ) : (
          metadata.commentsLabel
        ),
    },
    {
      label: "Checks",
      icon: ShieldCheckIcon,
      value: (
        <span
          className={cn(
            "inline-flex items-center justify-end gap-1.5",
            statusToneClassName(checks.tone),
          )}
        >
          <ChangeRequestStatusIcon presentation={checks} />
          {metadata.checksLabel}
        </span>
      ),
    },
  ];

  return (
    <dl className="space-y-2.5 px-4 py-3 tabular-nums">
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-[6.25rem_minmax(0,1fr)] items-start gap-3 text-xs"
        >
          <dt className="flex items-center gap-2 text-muted-foreground">
            <row.icon className="size-3.5" aria-hidden />
            {row.label}
          </dt>
          <dd className="min-w-0 text-right text-foreground">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
