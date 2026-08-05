import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@aqqua/client-runtime/state/runtime";
import type {
  GitChangeRequestMergeMethod,
  ScopedThreadRef,
  VcsStatusResult,
} from "@aqqua/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
} from "./GitActionsControl.logic";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Radio, RadioGroup } from "./ui/radio-group";
import { stackedThreadToast, toastManager } from "./ui/toast";

interface ManagePullRequestDialogProps {
  readonly threadRef: ScopedThreadRef;
  readonly cwd: string;
  readonly changeRequest: NonNullable<VcsStatusResult["pr"]>;
  readonly sourceControlProvider: VcsStatusResult["sourceControlProvider"];
}

export function ManagePullRequestDialog({
  threadRef,
  cwd,
  changeRequest,
  sourceControlProvider,
}: ManagePullRequestDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedMergeMethod, setSelectedMergeMethod] =
    useState<GitChangeRequestMergeMethod>("merge");
  const [autoMergeEnabled, setAutoMergeEnabled] = useState<boolean | null>(null);
  const [mutation, setMutation] = useState<"merge" | "auto-merge" | "state" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasUserSelectedMergeMethod = useRef(false);
  const threadToastData = useMemo(() => ({ threadRef }), [threadRef]);
  const presentation = useMemo(
    () => getSourceControlPresentation(sourceControlProvider),
    [sourceControlProvider],
  );
  const terminology = presentation.terminology;
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
  const setAutoMerge = useAtomCommand(gitEnvironment.setAutoMerge, {
    reportFailure: false,
  });
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
    hasUserSelectedMergeMethod.current = false;
    setAutoMergeEnabled(null);
    setError(null);
  }, [changeRequest.number]);

  useEffect(() => {
    const options = mergeOptionsQuery.data;
    if (options && !hasUserSelectedMergeMethod.current) {
      setSelectedMergeMethod(options.defaultMethod);
    }
  }, [changeRequest.number, mergeOptionsQuery.data]);

  const openExistingPr = useCallback(async () => {
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
          title: "Unable to open pull request link",
          description: cause instanceof Error ? cause.message : "An error occurred.",
          data: threadToastData,
        }),
      );
    });
  }, [changeRequest.url, threadToastData]);

  const failureMessage = (result: {
    readonly cause: Parameters<typeof squashAtomCommandFailure>[0]["cause"];
  }): string => {
    const cause = squashAtomCommandFailure(result);
    return cause instanceof Error ? cause.message : "The change request action failed.";
  };

  const runMergeChangeRequest = () => {
    if (management.mergeDisabledReason !== null) return;
    setMutation("merge");
    setError(null);
    void (async () => {
      const result = await mergeChangeRequest({
        environmentId: threadRef.environmentId,
        input: {
          cwd,
          reference: String(changeRequest.number),
          method: selectedMergeMethod,
        },
      });
      setMutation(null);
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return;
        setError(failureMessage(result));
        return;
      }
      setIsOpen(false);
      toastManager.add({
        type: "success",
        title: `${terminology.shortLabel} merged`,
        description: `${changeRequest.title} was merged with ${changeRequestMergeMethodLabel(selectedMergeMethod).toLowerCase()}.`,
        data: threadToastData,
      });
    })();
  };

  const runAutoMergeChange = (enabled: boolean) => {
    if (management.autoMergeDisabledReason !== null) return;
    setMutation("auto-merge");
    setError(null);
    void (async () => {
      const result = await setAutoMerge({
        environmentId: threadRef.environmentId,
        input: enabled
          ? {
              cwd,
              reference: String(changeRequest.number),
              enabled: true,
              method: selectedMergeMethod,
            }
          : {
              cwd,
              reference: String(changeRequest.number),
              enabled: false,
            },
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

  const runChangeRequestStateAction = () => {
    if (management.stateActionDisabledReason !== null) return;
    const nextState = management.stateAction === "close" ? "closed" : "open";
    setMutation("state");
    setError(null);
    void (async () => {
      const result = await updateChangeRequestState({
        environmentId: threadRef.environmentId,
        input: {
          cwd,
          reference: String(changeRequest.number),
          state: nextState,
        },
      });
      setMutation(null);
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return;
        setError(failureMessage(result));
        return;
      }
      setIsOpen(false);
      toastManager.add({
        type: "success",
        title: `${terminology.shortLabel} ${nextState === "open" ? "reopened" : "closed"}`,
        data: threadToastData,
      });
    })();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && mutation !== null) return;
        setIsOpen(open);
        if (!open) setError(null);
      }}
    >
      <Button
        variant="ghost"
        size="xs"
        disabled={mutation !== null}
        onClick={() => {
          setError(null);
          setIsOpen(true);
        }}
      >
        Manage
      </Button>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Manage {terminology.shortLabel} #{changeRequest.number}
          </DialogTitle>
          <DialogDescription>{changeRequest.title}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-5">
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Merge method</p>
            <RadioGroup
              value={selectedMergeMethod}
              onValueChange={(value) => {
                hasUserSelectedMergeMethod.current = true;
                setSelectedMergeMethod(value as GitChangeRequestMergeMethod);
              }}
              className="space-y-2"
              disabled={management.mergeDisabledReason !== null}
            >
              {mergeOptionsQuery.data
                ? orderChangeRequestMergeMethods(mergeOptionsQuery.data).map((method) => (
                    <label
                      key={method}
                      className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
                    >
                      <Radio value={method} />
                      {changeRequestMergeMethodLabel(method)}
                      {method === mergeOptionsQuery.data?.defaultMethod ? (
                        <span className="ms-auto text-xs text-muted-foreground">Default</span>
                      ) : null}
                    </label>
                  ))
                : null}
            </RadioGroup>
            {management.mergeDisabledReason ? (
              <p className="text-xs text-muted-foreground">{management.mergeDisabledReason}</p>
            ) : null}
          </div>

          <label className="flex items-start gap-2 rounded-md border border-border px-3 py-2">
            <Checkbox
              checked={autoMergeEnabled ?? false}
              indeterminate={autoMergeEnabled === null}
              disabled={management.autoMergeDisabledReason !== null}
              onCheckedChange={(checked) => runAutoMergeChange(checked === true)}
            />
            <span className="space-y-0.5 text-sm">
              <span className="block font-medium">Auto-merge</span>
              <span className="block text-xs text-muted-foreground">
                {management.autoMergeDisabledReason ??
                  (mutation === "auto-merge"
                    ? "Updating auto-merge..."
                    : autoMergeEnabled === null
                      ? "Current setting is not reported. Select to enable auto-merge."
                      : autoMergeEnabled
                        ? "Enabled. Clear to disable auto-merge."
                        : "Disabled. Select to enable auto-merge.")}
              </span>
            </span>
          </label>

          {error ? (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter className="sm:flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            disabled={mutation !== null}
            onClick={() => void openExistingPr()}
          >
            <ExternalLinkIcon />
            View on provider
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={management.stateActionDisabledReason !== null}
            title={management.stateActionDisabledReason ?? undefined}
            onClick={runChangeRequestStateAction}
          >
            {management.stateAction === "close"
              ? `Close ${terminology.shortLabel}`
              : `Reopen ${terminology.shortLabel}`}
          </Button>
          <Button
            size="sm"
            disabled={management.mergeDisabledReason !== null}
            title={management.mergeDisabledReason ?? undefined}
            onClick={runMergeChangeRequest}
          >
            {mutation === "merge" ? "Merging..." : `Merge ${terminology.shortLabel}`}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
