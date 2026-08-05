import type { EnvironmentId, ScopedThreadRef, VcsStatusResult } from "@aqqua/contracts";
import {
  CircleCheckIcon,
  CircleXIcon,
  Clock3Icon,
  ExternalLinkIcon,
  GitPullRequestIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useOpenPrLink } from "~/lib/openPullRequestLink";
import { cn } from "~/lib/utils";
import { gitEnvironment } from "~/state/git";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment } from "~/state/vcs";

import {
  changeRequestStatePresentation,
  checkPresentation,
  shouldRefetchChecks,
  type StatusPresentation,
} from "./PullRequestPanel.logic";
import { ChangeRequestChecksBadge } from "./ChangeRequestChecksBadge";
import { ManagePullRequestDialog } from "./ManagePullRequestDialog";
import { PanelSurfaceHeader } from "./PanelSurfaceHeader";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

interface PullRequestPanelProps {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly cwd: string;
  readonly status: VcsStatusResult | null;
  readonly statusError: string | null;
  readonly statusPending: boolean;
}

const toneClasses = {
  neutral: "text-muted-foreground",
  pending: "text-warning-foreground",
  success: "text-success-foreground",
  failure: "text-destructive-foreground",
  info: "text-info-foreground",
} as const;

function StatusIcon({ presentation }: { presentation: StatusPresentation }) {
  const Icon =
    presentation.icon === "check"
      ? CircleCheckIcon
      : presentation.icon === "x"
        ? CircleXIcon
        : Clock3Icon;
  return <Icon aria-hidden className={cn("size-4 shrink-0", toneClasses[presentation.tone])} />;
}

export function PullRequestPanel({
  environmentId,
  threadRef,
  cwd,
  status,
  statusError,
  statusPending,
}: PullRequestPanelProps) {
  const pr = status?.pr ?? null;
  const checksQuery = useEnvironmentQuery(
    pr === null
      ? null
      : gitEnvironment.changeRequestChecks({
          environmentId,
          input: { cwd, reference: String(pr.number) },
        }),
  );
  const refreshStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });
  const previousPrRef = useRef(pr);
  const [refreshPending, setRefreshPending] = useState(false);
  const openPrLink = useOpenPrLink();

  useEffect(() => {
    const previous = previousPrRef.current;
    previousPrRef.current = pr;
    if (!shouldRefetchChecks(previous, pr)) return;
    void checksQuery.refresh().catch(() => undefined);
  }, [checksQuery.refresh, pr]);

  const handleRefresh = async () => {
    if (refreshPending) return;
    setRefreshPending(true);
    try {
      await refreshStatus({ environmentId, input: { cwd } });
      await checksQuery.refresh().catch(() => undefined);
    } finally {
      setRefreshPending(false);
    }
  };

  const panelHeader = (
    <PanelSurfaceHeader
      icon={GitPullRequestIcon}
      title="Pull request"
      actions={
        <>
          {pr ? (
            <ManagePullRequestDialog
              threadRef={threadRef}
              cwd={cwd}
              changeRequest={pr}
              sourceControlProvider={status?.sourceControlProvider}
            />
          ) : null}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Refresh pull request status and checks"
            title={refreshPending ? "Refreshing pull request" : "Refresh pull request"}
            disabled={refreshPending}
            onClick={() => void handleRefresh()}
          >
            <RefreshCwIcon aria-hidden />
          </Button>
        </>
      }
    />
  );

  if (status === null && statusPending) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {panelHeader}
        <div className="flex flex-1 items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
          <Clock3Icon className="size-4" aria-hidden />
          Loading pull request status…
        </div>
      </div>
    );
  }

  if (pr === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {panelHeader}
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <div className="max-w-sm">
            <GitPullRequestIcon className="mx-auto size-6 text-muted-foreground" aria-hidden />
            <h2 className="mt-3 text-sm font-medium">No pull request for this branch</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Create one from the Git actions control in the workspace toolbar, then return here to
              watch its status and checks.
            </p>
            {statusError ? <p className="mt-3 text-xs text-destructive">{statusError}</p> : null}
          </div>
        </div>
      </div>
    );
  }

  const statePresentation = changeRequestStatePresentation(pr.state);
  const stateVariant =
    statePresentation.tone === "success"
      ? "success"
      : statePresentation.tone === "info"
        ? "info"
        : "secondary";
  const checks = checksQuery.data?.checks ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {panelHeader}
      <div className="shrink-0 space-y-3 border-b border-border p-4">
        <div className="flex items-start gap-2">
          <span className="shrink-0 text-sm text-muted-foreground">#{pr.number}</span>
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 text-sm font-medium text-foreground underline-offset-4 hover:underline"
            onClick={(event) => openPrLink(event, pr.url)}
          >
            {pr.title}
            <ExternalLinkIcon className="ms-1 inline size-3 align-baseline text-muted-foreground" />
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge size="sm" variant={stateVariant}>
            {statePresentation.label}
          </Badge>
          <ChangeRequestChecksBadge status={pr.checksStatus} />
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
            {pr.baseRef} ← {pr.headRef}
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center border-b border-border px-4 text-xs font-medium text-muted-foreground">
          Checks
        </div>
        {checksQuery.data?.supported === false ? (
          <div className="p-4 text-sm text-muted-foreground">
            Per-check detail is unavailable for this host. The aggregate status above will continue
            to update.
          </div>
        ) : checksQuery.error ? (
          <div className="p-4">
            <p className="text-sm text-destructive">Could not load check details.</p>
            <p className="mt-1 text-xs text-muted-foreground">{checksQuery.error}</p>
          </div>
        ) : checksQuery.isPending && checksQuery.data === null ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Clock3Icon className="size-4" aria-hidden />
            Loading checks…
          </div>
        ) : checks.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            No checks are reported for this pull request.
          </p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {checks.map((check) => {
              const presentation = checkPresentation(check.status);
              return (
                <li
                  key={check.name}
                  className="flex min-h-10 items-center gap-3 border-b border-border/60 px-4 py-2 last:border-b-0"
                >
                  <StatusIcon presentation={presentation} />
                  <span className="min-w-0 flex-1 truncate text-sm" title={check.name}>
                    {check.name}
                  </span>
                  <span className={cn("shrink-0 text-xs", toneClasses[presentation.tone])}>
                    {presentation.label}
                  </span>
                  {check.detailsUrl ? (
                    <a
                      href={check.detailsUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open details for ${check.name}`}
                      title={`Open details for ${check.name}`}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      onClick={(event) => openPrLink(event, check.detailsUrl!)}
                    >
                      <ExternalLinkIcon className="size-3.5" aria-hidden />
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
