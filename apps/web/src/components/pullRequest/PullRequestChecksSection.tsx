import type { GitGetChangeRequestChecksResult } from "@aqqua/contracts";
import { ExternalLinkIcon } from "lucide-react";

import { useOpenPrLink } from "~/lib/openPullRequestLink";
import { cn } from "~/lib/utils";
import type { EnvironmentQueryView } from "~/state/query";

import {
  checkPresentation,
  keyChangeRequestChecks,
  statusToneClassName,
} from "../PullRequestPanel.logic";
import { ChangeRequestStatusIcon } from "../ChangeRequestChecksBadge";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { PullRequestSection } from "./PullRequestSection";

export function PullRequestChecksSection(props: {
  readonly query: EnvironmentQueryView<GitGetChangeRequestChecksResult>;
}) {
  const openPrLink = useOpenPrLink();
  const checks = props.query.data?.checks ?? [];
  return (
    <PullRequestSection title="Checks" defaultOpen>
      {props.query.data?.supported === false ? (
        <p className="px-4 pb-4 text-xs text-muted-foreground">
          Per-check details are not supported by this provider.
        </p>
      ) : props.query.error && props.query.data === null ? (
        <div className="px-4 pb-4 text-xs text-muted-foreground">
          Could not load checks.{" "}
          <Button variant="link" size="xs" onClick={() => void props.query.refresh()}>
            Retry
          </Button>
        </div>
      ) : props.query.isPending && props.query.data === null ? (
        <div className="space-y-2 px-4 pb-4">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-8 w-full" />
          ))}
        </div>
      ) : checks.length === 0 ? (
        <p className="px-4 pb-4 text-xs text-muted-foreground">
          No checks are reported for this pull request.
        </p>
      ) : (
        <ul className="pb-2">
          {keyChangeRequestChecks(checks).map(({ check, key }) => {
            const presentation = checkPresentation(check.status);
            return (
              <li
                key={key}
                className="flex min-h-9 items-center gap-2 px-4 py-1.5 hover:bg-accent/30"
              >
                <ChangeRequestStatusIcon
                  presentation={presentation}
                  className={statusToneClassName(presentation.tone)}
                />
                <span className="min-w-0 flex-1 truncate text-xs" title={check.name}>
                  {check.name}
                </span>
                <span className={cn("text-[11px]", statusToneClassName(presentation.tone))}>
                  {presentation.label}
                </span>
                {check.detailsUrl ? (
                  <a
                    href={check.detailsUrl}
                    aria-label={`Open details for ${check.name}`}
                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    onClick={(event) => openPrLink(event, check.detailsUrl!)}
                  >
                    <ExternalLinkIcon className="size-3.5" />
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </PullRequestSection>
  );
}
