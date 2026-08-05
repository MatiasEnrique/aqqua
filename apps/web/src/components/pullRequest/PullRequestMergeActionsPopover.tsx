import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@aqqua/client-runtime/state/runtime";
import type {
  GitChangeRequestMergeMethod,
  ScopedThreadRef,
  VcsStatusResult,
} from "@aqqua/contracts";
import { ChevronDownIcon, ExternalLinkIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { openPullRequestLink } from "~/lib/openPullRequestLink";
import { readLocalApi } from "~/localApi";
import { getSourceControlPresentation } from "~/sourceControlPresentation";
import { gitEnvironment } from "~/state/git";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

import {
  changeRequestMergeMethodLabel,
  orderChangeRequestMergeMethods,
  resolveChangeRequestManagementState,
} from "../GitActionsControl.logic";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Spinner } from "../ui/spinner";
import { stackedThreadToast, toastManager } from "../ui/toast";

interface PullRequestMergeActionsPopoverProps {
  readonly threadRef: ScopedThreadRef;
  readonly cwd: string;
  readonly changeRequest: NonNullable<VcsStatusResult["pr"]>;
  readonly sourceControlProvider: VcsStatusResult["sourceControlProvider"];
}

function ActionItem(props: {
  readonly children: ReactNode;
  readonly hint?: string | undefined;
  readonly disabled?: boolean;
  readonly disabledReason?: string | null;
  readonly destructive?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-start text-sm outline-none transition-colors hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50 ${props.destructive ? "text-destructive" : "text-foreground"}`}
      disabled={props.disabled || props.disabledReason != null}
      title={props.disabledReason ?? undefined}
      onClick={props.onClick}
    >
      <span className="min-w-0 flex-1 truncate">{props.children}</span>
      {props.hint ? (
        <span className="shrink-0 text-xs text-muted-foreground">{props.hint}</span>
      ) : null}
    </button>
  );
}

export function PullRequestMergeActionsPopover({
  threadRef,
  cwd,
  changeRequest,
  sourceControlProvider,
}: PullRequestMergeActionsPopoverProps) {
  const [open, setOpen] = useState(false);
  const [mutation, setMutation] = useState<"merge" | "auto-merge" | "state" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoMergeEnabled, setAutoMergeEnabled] = useState<boolean | null>(null);
  const mutationRef = useRef(mutation);
  mutationRef.current = mutation;
  const threadToastData = useMemo(() => ({ threadRef }), [threadRef]);
  const terminology = useMemo(
    () => getSourceControlPresentation(sourceControlProvider).terminology,
    [sourceControlProvider],
  );
  const mergeOptionsQuery = useEnvironmentQuery(
    changeRequest.state === "open"
      ? gitEnvironment.changeRequestMergeOptions({
          environmentId: threadRef.environmentId,
          input: { cwd, reference: String(changeRequest.number) },
        })
      : null,
  );
  const mergeChangeRequest = useAtomCommand(gitEnvironment.mergeChangeRequest, {
    reportFailure: false,
  });
  const setAutoMerge = useAtomCommand(gitEnvironment.setAutoMerge, { reportFailure: false });
  const updateChangeRequestState = useAtomCommand(gitEnvironment.updateChangeRequestState, {
    reportFailure: false,
  });
  const management = resolveChangeRequestManagementState({
    state: changeRequest.state,
    options: mergeOptionsQuery.data,
    optionsPending: mergeOptionsQuery.isPending,
    optionsError: mergeOptionsQuery.error,
    mutationPending: mutation !== null,
  });

  useEffect(() => {
    setAutoMergeEnabled(null);
    setError(null);
  }, [changeRequest.number]);

  const failureMessage = (result: {
    readonly cause: Parameters<typeof squashAtomCommandFailure>[0]["cause"];
  }): string => {
    const cause = squashAtomCommandFailure(result);
    return cause instanceof Error ? cause.message : "The change request action failed.";
  };

  const runMerge = (method: GitChangeRequestMergeMethod) => {
    if (management.mergeDisabledReason !== null || mutation !== null) return;
    setMutation("merge");
    setError(null);
    void (async () => {
      const result = await mergeChangeRequest({
        environmentId: threadRef.environmentId,
        input: { cwd, reference: String(changeRequest.number), method },
      });
      setMutation(null);
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return;
        setError(failureMessage(result));
        return;
      }
      setOpen(false);
      toastManager.add({
        type: "success",
        title: `${terminology.shortLabel} merged`,
        description: `${changeRequest.title} was merged with ${changeRequestMergeMethodLabel(method).toLowerCase()}.`,
        data: threadToastData,
      });
    })();
  };

  const runAutoMerge = (enabled: boolean) => {
    if (management.autoMergeDisabledReason !== null || mutation !== null) return;
    const method = mergeOptionsQuery.data?.defaultMethod ?? "merge";
    setMutation("auto-merge");
    setError(null);
    void (async () => {
      const result = await setAutoMerge({
        environmentId: threadRef.environmentId,
        input: enabled
          ? { cwd, reference: String(changeRequest.number), enabled: true, method }
          : { cwd, reference: String(changeRequest.number), enabled: false },
      });
      setMutation(null);
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return;
        setError(failureMessage(result));
        return;
      }
      setAutoMergeEnabled(result.value.enabled);
    })();
  };

  const runStateAction = () => {
    if (management.stateActionDisabledReason !== null || mutation !== null) return;
    const nextState = management.stateAction === "close" ? "closed" : "open";
    setMutation("state");
    setError(null);
    void (async () => {
      const result = await updateChangeRequestState({
        environmentId: threadRef.environmentId,
        input: { cwd, reference: String(changeRequest.number), state: nextState },
      });
      setMutation(null);
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return;
        setError(failureMessage(result));
        return;
      }
      setOpen(false);
      toastManager.add({
        type: "success",
        title: `${terminology.shortLabel} ${nextState === "open" ? "reopened" : "closed"}`,
        data: threadToastData,
      });
    })();
  };

  const openOnProvider = () => {
    const api = readLocalApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Link opening is unavailable.",
        data: threadToastData,
      });
      return;
    }
    void openPullRequestLink(api.shell, changeRequest.url).catch((cause: unknown) => {
      console.error(cause);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Unable to open ${terminology.shortLabel} link`,
          description: cause instanceof Error ? cause.message : "An error occurred.",
          data: threadToastData,
        }),
      );
    });
  };

  const isOpenState = changeRequest.state === "open";
  const methods = mergeOptionsQuery.data
    ? orderChangeRequestMergeMethods(mergeOptionsQuery.data)
    : [];

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && mutationRef.current !== null) return;
        setOpen(nextOpen);
        if (!nextOpen) setError(null);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            className="w-full"
            variant={isOpenState ? "default" : "outline"}
            aria-label={`${terminology.shortLabel} actions`}
          />
        }
      >
        {mutation !== null ? <Spinner className="size-3.5" /> : null}
        {isOpenState
          ? mutation === "merge"
            ? "Merging…"
            : `Merge ${terminology.shortLabel}`
          : "Actions"}
        <ChevronDownIcon className="size-3.5 opacity-70" aria-hidden />
      </PopoverTrigger>
      <PopoverPopup
        align="center"
        className="w-(--anchor-width) min-w-64"
        viewportClassName="py-1.5 [--viewport-inline-padding:--spacing(1.5)]"
      >
        {isOpenState ? (
          <div className="space-y-0.5">
            <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Merge
            </p>
            {management.mergeDisabledReason !== null && methods.length === 0 ? (
              <p className="px-2.5 pb-1.5 text-xs text-muted-foreground">
                {management.mergeDisabledReason}
              </p>
            ) : (
              methods.map((method) => (
                <ActionItem
                  key={method}
                  hint={method === mergeOptionsQuery.data?.defaultMethod ? "Default" : undefined}
                  disabledReason={management.mergeDisabledReason}
                  onClick={() => runMerge(method)}
                >
                  {changeRequestMergeMethodLabel(method)}
                </ActionItem>
              ))
            )}
            <ActionItem
              disabledReason={management.autoMergeDisabledReason}
              hint={mutation === "auto-merge" ? "Updating…" : undefined}
              onClick={() => runAutoMerge(autoMergeEnabled !== true)}
            >
              {autoMergeEnabled === true
                ? "Disable auto-merge"
                : `Enable auto-merge (${changeRequestMergeMethodLabel(
                    mergeOptionsQuery.data?.defaultMethod ?? "merge",
                  ).toLowerCase()})`}
            </ActionItem>
            <div className="mx-1 my-1 border-t border-border/70" />
          </div>
        ) : null}
        <div className="space-y-0.5">
          <ActionItem
            destructive={management.stateAction === "close"}
            disabledReason={management.stateActionDisabledReason}
            onClick={runStateAction}
          >
            {management.stateAction === "close"
              ? `Close ${terminology.shortLabel}`
              : `Reopen ${terminology.shortLabel}`}
          </ActionItem>
          <ActionItem onClick={openOnProvider}>
            <span className="flex items-center gap-1.5">
              View on provider <ExternalLinkIcon className="size-3" aria-hidden />
            </span>
          </ActionItem>
        </div>
        {error ? (
          <p
            role="alert"
            className="mx-1 mb-1 mt-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
          >
            {error}
          </p>
        ) : null}
      </PopoverPopup>
    </Popover>
  );
}
