import type { GitGetChangeRequestConversationResult, ScopedThreadRef } from "@aqqua/contracts";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { PullRequestSection } from "./PullRequestSection";

export function PullRequestDescriptionSection(props: {
  readonly cwd: string;
  readonly threadRef: ScopedThreadRef;
  readonly conversation: GitGetChangeRequestConversationResult | null;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
}) {
  const description = props.conversation?.description ?? null;
  return (
    <PullRequestSection title="Description" defaultOpen>
      <div className="px-4 pb-4">
        {props.pending && props.conversation === null ? (
          <Skeleton className="h-16 w-full" />
        ) : props.error && props.conversation === null ? (
          <div className="text-xs text-muted-foreground">
            Could not load the description.{" "}
            <Button variant="link" size="xs" onClick={props.onRetry}>
              Retry
            </Button>
          </div>
        ) : props.conversation?.supported === false ? (
          <p className="text-xs text-muted-foreground">
            Description details are not supported by this provider.
          </p>
        ) : (
          <>
            {description ? (
              <p className="mb-3 text-[11px] text-muted-foreground">
                {description.author?.login ?? "Unknown author"}
                {description.createdAt
                  ? ` · ${formatRelativeTimeLabel(description.createdAt)}`
                  : ""}
              </p>
            ) : null}
            {description?.body.trim() ? (
              <ChatMarkdown
                className="text-sm"
                text={description.body}
                cwd={props.cwd}
                threadRef={props.threadRef}
              />
            ) : (
              <p className="text-sm text-muted-foreground">No description provided.</p>
            )}
          </>
        )}
      </div>
    </PullRequestSection>
  );
}
