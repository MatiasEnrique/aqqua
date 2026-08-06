import { isAtomCommandInterrupted } from "@aqqua/client-runtime/state/runtime";
import type {
  ChangeRequestComment,
  ChangeRequestReviewThread,
  GitGetChangeRequestConversationResult,
  ScopedThreadRef,
} from "@aqqua/contracts";
import { ChevronRightIcon, ExternalLinkIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { useOpenPrLink } from "~/lib/openPullRequestLink";
import type { EnvironmentQueryView } from "~/state/query";
import { gitEnvironment } from "~/state/git";
import { useAtomCommand } from "~/state/use-atom-command";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import ChatMarkdown from "../ChatMarkdown";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { changeRequestFailureMessage } from "./changeRequestFailureMessage";
import { PullRequestCommentComposer } from "./PullRequestCommentComposer";
import {
  orderChangeRequestComments,
  orderPullRequestConversation,
  reviewThreadLocation,
} from "./PullRequestConversationSection.logic";
import { PullRequestSection } from "./PullRequestSection";

function CommentCard(props: {
  readonly comment: ChangeRequestComment;
  readonly cwd: string;
  readonly threadRef: ScopedThreadRef;
}) {
  const login = props.comment.author?.login ?? "Ghost";
  return (
    <article className="rounded-lg border border-border/70 bg-card p-3">
      <header className="mb-2 flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold uppercase text-muted-foreground">
          {login.slice(0, 2)}
        </span>
        <span className="text-xs font-medium">{login}</span>
        {props.comment.createdAt ? (
          <span className="text-[11px] text-muted-foreground">
            {formatRelativeTimeLabel(props.comment.createdAt)}
          </span>
        ) : null}
      </header>
      <ChatMarkdown
        className="text-sm"
        text={props.comment.body}
        cwd={props.cwd}
        threadRef={props.threadRef}
      />
    </article>
  );
}

function ReviewThreadCard(props: {
  readonly thread: ChangeRequestReviewThread;
  readonly cwd: string;
  readonly threadRef: ScopedThreadRef;
  readonly resolving: boolean;
  readonly onResolve: () => Promise<string | null>;
  readonly onReply: (body: string) => Promise<string | null>;
}) {
  const [expanded, setExpanded] = useState(!props.thread.isResolved);
  const [resolveError, setResolveError] = useState<string | null>(null);
  return (
    <article className="rounded-lg border border-border bg-card">
      <header className="flex min-h-9 items-center gap-2 px-3 py-2">
        <Button
          variant="ghost"
          size="icon-xs"
          className="-ms-1"
          aria-label={expanded ? "Collapse review thread" : "Expand review thread"}
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronRightIcon
            className={`size-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
          />
        </Button>
        <span className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
          {reviewThreadLocation(props.thread)}
        </span>
        {props.thread.isOutdated ? (
          <Badge size="sm" variant="secondary">
            Outdated
          </Badge>
        ) : null}
        {props.thread.isResolved ? (
          <Badge size="sm" variant="success">
            Resolved
          </Badge>
        ) : null}
        <Button
          className="ms-auto"
          variant="link"
          size="xs"
          disabled={props.resolving}
          onClick={() => void props.onResolve().then(setResolveError)}
        >
          {props.thread.isResolved ? "Unresolve" : "Resolve"}
        </Button>
      </header>
      {resolveError ? (
        <p role="alert" className="border-t border-border/70 px-3 py-2 text-xs text-destructive">
          {resolveError}
        </p>
      ) : null}
      {expanded ? (
        <div className="space-y-3 border-t border-border/70 p-3">
          {orderChangeRequestComments(props.thread.comments).map((comment) => (
            <CommentCard
              key={comment.id}
              comment={comment}
              cwd={props.cwd}
              threadRef={props.threadRef}
            />
          ))}
          {props.thread.commentsTruncated ? (
            <p className="text-[11px] text-muted-foreground">Earlier replies are not shown.</p>
          ) : null}
          <PullRequestCommentComposer
            compact
            placeholder="Reply…"
            buttonLabel="Reply"
            onSubmit={props.onReply}
          />
        </div>
      ) : null}
    </article>
  );
}

export function PullRequestConversationSection(props: {
  readonly environmentId: ScopedThreadRef["environmentId"];
  readonly threadRef: ScopedThreadRef;
  readonly cwd: string;
  readonly reference: string;
  readonly prUrl: string;
  readonly query: EnvironmentQueryView<GitGetChangeRequestConversationResult>;
}) {
  const addComment = useAtomCommand(gitEnvironment.addChangeRequestComment, {
    reportFailure: false,
  });
  const reply = useAtomCommand(gitEnvironment.replyToChangeRequestThread, { reportFailure: false });
  const setResolved = useAtomCommand(gitEnvironment.setChangeRequestThreadResolved, {
    reportFailure: false,
  });
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const openPrLink = useOpenPrLink();
  const commandFailure = (result: Awaited<ReturnType<typeof addComment>>) =>
    result._tag === "Failure" && !isAtomCommandInterrupted(result)
      ? changeRequestFailureMessage(result, "The pull request action failed.")
      : null;
  const timeline = useMemo(
    () => (props.query.data ? orderPullRequestConversation(props.query.data) : []),
    [props.query.data],
  );
  const viewMore = Boolean(
    props.query.data?.commentsTruncated || props.query.data?.reviewThreadsTruncated,
  );

  return (
    <PullRequestSection title="Comments" defaultOpen>
      <div className="space-y-3 px-4 pb-4">
        {props.query.isPending && props.query.data === null ? (
          [0, 1].map((key) => <Skeleton key={key} className="h-24 w-full" />)
        ) : props.query.error && props.query.data === null ? (
          <div className="text-xs text-muted-foreground">
            Could not load comments.{" "}
            <Button variant="link" size="xs" onClick={() => void props.query.refresh()}>
              Retry
            </Button>
          </div>
        ) : props.query.data?.supported === false ? (
          <p className="text-xs text-muted-foreground">
            Conversation details are not supported by this provider.
          </p>
        ) : timeline.length === 0 ? (
          <p className="text-xs text-muted-foreground">No comments yet.</p>
        ) : (
          timeline.map((item) =>
            item.kind === "comment" ? (
              <CommentCard
                key={`comment:${item.comment.id}`}
                comment={item.comment}
                cwd={props.cwd}
                threadRef={props.threadRef}
              />
            ) : (
              <ReviewThreadCard
                key={`thread:${item.thread.id}:${item.thread.isResolved}`}
                thread={item.thread}
                cwd={props.cwd}
                threadRef={props.threadRef}
                resolving={resolvingId === item.thread.id}
                onResolve={async () => {
                  setResolvingId(item.thread.id);
                  const result = await setResolved({
                    environmentId: props.environmentId,
                    input: {
                      cwd: props.cwd,
                      reference: props.reference,
                      threadId: item.thread.id,
                      resolved: !item.thread.isResolved,
                    },
                  });
                  setResolvingId(null);
                  return result._tag === "Failure" && !isAtomCommandInterrupted(result)
                    ? changeRequestFailureMessage(result, "The pull request action failed.")
                    : null;
                }}
                onReply={async (body) => {
                  const result = await reply({
                    environmentId: props.environmentId,
                    input: {
                      cwd: props.cwd,
                      reference: props.reference,
                      threadId: item.thread.id,
                      body,
                    },
                  });
                  return result._tag === "Failure" && !isAtomCommandInterrupted(result)
                    ? changeRequestFailureMessage(result, "The pull request action failed.")
                    : null;
                }}
              />
            ),
          )
        )}
        {viewMore ? (
          <a
            href={props.prUrl}
            className="flex items-center justify-center gap-1 rounded-md py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={(event) => openPrLink(event, props.prUrl)}
          >
            View more on GitHub <ExternalLinkIcon className="size-3" />
          </a>
        ) : null}
        {props.query.data?.supported !== false ? (
          <div className="border-t border-border/70 pt-3">
            <PullRequestCommentComposer
              placeholder="Leave a comment…"
              buttonLabel="Comment"
              onSubmit={async (body) =>
                commandFailure(
                  await addComment({
                    environmentId: props.environmentId,
                    input: { cwd: props.cwd, reference: props.reference, body },
                  }),
                )
              }
            />
          </div>
        ) : null}
      </div>
    </PullRequestSection>
  );
}
