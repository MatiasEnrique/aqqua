import type { WorkspacePanelRef } from "@aqqua/client-runtime/environment";
import type {
  EnvironmentId,
  GitChangeRequestCommit,
  ScopedThreadRef,
  VcsStatusResult,
} from "@aqqua/contracts";
import { GitPullRequestIcon, RefreshCwIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { useOpenPrLink } from "~/lib/openPullRequestLink";
import { gitEnvironment } from "~/state/git";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment } from "~/state/vcs";

import type { DraftId } from "../composerDraftStore";
import { GitHubIcon } from "./Icons";
import {
  changeRequestStatePresentation,
  pullRequestSectionVisibility,
  shouldRefetchChecks,
} from "./PullRequestPanel.logic";
import { PanelSurfaceHeader } from "./PanelSurfaceHeader";
import { DeleteBranchDialog } from "./pullRequest/DeleteBranchDialog";
import { PullRequestMergeActionsPopover } from "./pullRequest/PullRequestMergeActionsPopover";
import { PullRequestChecksSection } from "./pullRequest/PullRequestChecksSection";
import { PullRequestCommitsSection } from "./pullRequest/PullRequestCommitsSection";
import { PullRequestConversationSection } from "./pullRequest/PullRequestConversationSection";
import { PullRequestDescriptionSection } from "./pullRequest/PullRequestDescriptionSection";
import { PullRequestMetadataRows } from "./pullRequest/PullRequestMetadataRows";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

const DiffPanel = lazy(() => import("./DiffPanel"));

interface PullRequestPanelProps {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly composerDraftTarget: ScopedThreadRef | DraftId;
  readonly workspaceRef: WorkspacePanelRef | null;
  readonly cwd: string;
  readonly status: VcsStatusResult | null;
  readonly statusError: string | null;
  readonly statusPending: boolean;
}

export function PullRequestPanel({
  environmentId,
  threadRef,
  composerDraftTarget,
  workspaceRef,
  cwd,
  status,
  statusError,
  statusPending,
}: PullRequestPanelProps) {
  const pr = status?.pr ?? null;
  const providerKind = status?.sourceControlProvider?.kind ?? null;
  const isGitHub = providerKind === "github";
  const reference = pr === null ? null : String(pr.number);
  const checksQuery = useEnvironmentQuery(
    pr === null
      ? null
      : gitEnvironment.changeRequestChecks({
          environmentId,
          input: { cwd, reference: String(pr.number) },
        }),
  );
  const conversationQuery = useEnvironmentQuery(
    pr === null || !isGitHub
      ? null
      : gitEnvironment.changeRequestConversation({
          environmentId,
          input: { cwd, reference: String(pr.number) },
        }),
  );
  const [commitsRequestedFor, setCommitsRequestedFor] = useState<number | null>(null);
  const commitsRequested = pr !== null && commitsRequestedFor === pr.number;
  const commitsQuery = useEnvironmentQuery(
    pr === null || !isGitHub || !commitsRequested
      ? null
      : gitEnvironment.changeRequestCommits({
          environmentId,
          input: { cwd, reference: String(pr.number) },
        }),
  );
  const refreshStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });
  const previousPrRef = useRef(pr);
  const [refreshPending, setRefreshPending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedCommit, setSelectedCommit] = useState<GitChangeRequestCommit | null>(null);
  const openPrLink = useOpenPrLink();

  useEffect(() => {
    const previous = previousPrRef.current;
    previousPrRef.current = pr;
    if (!shouldRefetchChecks(previous, pr)) return;
    void checksQuery.refresh().catch(() => undefined);
  }, [checksQuery.refresh, pr]);

  useEffect(() => {
    setSelectedCommit(null);
  }, [pr?.number]);

  const handleRefresh = async () => {
    if (refreshPending) return;
    setRefreshPending(true);
    try {
      await refreshStatus({ environmentId, input: { cwd } });
      await Promise.all([
        checksQuery.refresh().catch(() => undefined),
        conversationQuery.refresh().catch(() => undefined),
        commitsQuery.refresh().catch(() => undefined),
      ]);
    } finally {
      setRefreshPending(false);
    }
  };

  const panelHeader = (
    <PanelSurfaceHeader
      icon={GitPullRequestIcon}
      title="Pull request"
      actions={
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Refresh pull request details"
          title={refreshPending ? "Refreshing pull request" : "Refresh pull request"}
          disabled={refreshPending}
          onClick={() => void handleRefresh()}
        >
          <RefreshCwIcon className={refreshPending ? "animate-spin" : undefined} aria-hidden />
        </Button>
      }
    />
  );

  if (status === null && statusPending) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {panelHeader}
        <div className="space-y-3 p-4">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-10 w-full" />
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

  if (selectedCommit) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        {panelHeader}
        <div className="min-h-0 flex-1">
          <Suspense
            fallback={
              <div className="space-y-3 p-4">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-64 w-full" />
              </div>
            }
          >
            <DiffPanel
              mode="embedded"
              composerDraftTarget={composerDraftTarget}
              initialGitScope="branch"
              threadRef={threadRef}
              workspaceRef={workspaceRef}
              fallbackCwd={cwd}
              commitTarget={{
                environmentId,
                cwd,
                commitId: selectedCommit.oid,
                label: selectedCommit.messageHeadline || selectedCommit.oid.slice(0, 7),
                onBack: () => setSelectedCommit(null),
              }}
            />
          </Suspense>
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
  const visibility = pullRequestSectionVisibility(providerKind, pr.state);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {panelHeader}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-border">
          <div className="flex items-start gap-3 px-4 pb-3 pt-4">
            <h1 className="min-w-0 flex-1 text-balance text-sm font-semibold leading-snug text-foreground">
              {pr.title}
            </h1>
            <div className="flex shrink-0 items-center gap-1.5">
              <Badge size="sm" variant={stateVariant}>
                {statePresentation.label}
              </Badge>
              {isGitHub ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Open pull request on GitHub"
                  title="Open on GitHub"
                  onClick={(event) => openPrLink(event, pr.url)}
                >
                  <GitHubIcon className="size-4" />
                </Button>
              ) : null}
            </div>
          </div>
          <PullRequestMetadataRows
            pr={pr}
            conversation={conversationQuery.data}
            conversationPending={conversationQuery.isPending}
          />
          <div className="flex gap-2 px-4 pb-4">
            {visibility.merge || visibility.manage ? (
              <PullRequestMergeActionsPopover
                threadRef={threadRef}
                cwd={cwd}
                changeRequest={pr}
                sourceControlProvider={status?.sourceControlProvider}
              />
            ) : visibility.deleteBranch ? (
              <Button
                className="w-full"
                variant="destructive-outline"
                onClick={() => setDeleteOpen(true)}
              >
                Delete branch
              </Button>
            ) : null}
          </div>
        </div>

        {visibility.description ? (
          <PullRequestDescriptionSection
            cwd={cwd}
            threadRef={threadRef}
            conversation={conversationQuery.data}
            pending={conversationQuery.isPending}
            error={conversationQuery.error}
            onRetry={() => void conversationQuery.refresh()}
          />
        ) : null}
        <PullRequestChecksSection query={checksQuery} />
        {visibility.commits ? (
          <PullRequestCommitsSection
            query={commitsQuery}
            prUrl={pr.url}
            onFirstOpen={() => setCommitsRequestedFor(pr.number)}
            onSelect={setSelectedCommit}
          />
        ) : null}
        {visibility.comments && reference ? (
          <PullRequestConversationSection
            environmentId={environmentId}
            threadRef={threadRef}
            cwd={cwd}
            reference={reference}
            prUrl={pr.url}
            query={conversationQuery}
          />
        ) : null}
      </div>

      {visibility.deleteBranch && reference && deleteOpen ? (
        <DeleteBranchDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          environmentId={environmentId}
          threadRef={threadRef}
          cwd={cwd}
          reference={reference}
          headRef={pr.headRef}
        />
      ) : null}
    </div>
  );
}
