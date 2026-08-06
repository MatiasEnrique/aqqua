import { type EnvironmentId, WS_METHODS } from "@aqqua/contracts";
import { normalizeChangeRequestReference } from "@aqqua/shared/sourceControl";
import * as Effect from "effect/Effect";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { request } from "../rpc/client.ts";
import { vcsCommandConcurrency, vcsCommandScheduler } from "./vcsCommandScheduler.ts";

export function createGitEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const changeRequestChecks = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:git:change-request-checks",
    tag: WS_METHODS.gitGetChangeRequestChecks,
    staleTimeMs: 5 * 60_000,
  });
  const changeRequestMergeOptions = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:git:change-request-merge-options",
    tag: WS_METHODS.gitGetChangeRequestMergeOptions,
    staleTimeMs: 5 * 60_000,
  });
  const changeRequestConversation = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:git:change-request-conversation",
    tag: WS_METHODS.gitGetChangeRequestConversation,
    staleTimeMs: 60_000,
  });
  const changeRequestCommits = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:git:change-request-commits",
    tag: WS_METHODS.gitListChangeRequestCommits,
    staleTimeMs: 5 * 60_000,
  });
  const repositoryChangeRequests = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:git:repository-change-requests",
    tag: WS_METHODS.gitListRepositoryChangeRequests,
    staleTimeMs: 60_000,
  });
  const refreshChangeRequestQueries = (
    target: {
      readonly environmentId: EnvironmentId;
      readonly input: { readonly cwd: string; readonly reference: string };
    },
    registry: AtomRegistry.AtomRegistry,
  ) =>
    request(WS_METHODS.vcsRefreshStatus, { cwd: target.input.cwd }).pipe(
      Effect.ignore,
      Effect.andThen(
        Effect.sync(() => {
          const queryTarget = {
            environmentId: target.environmentId,
            input: {
              cwd: target.input.cwd,
              reference: normalizeChangeRequestReference(target.input.reference),
            },
          };
          registry.refresh(changeRequestChecks(queryTarget));
          registry.refresh(changeRequestMergeOptions(queryTarget));
          // Merging, closing, or deleting a branch changes which pull requests
          // are still open, and the selector renders this list unfiltered.
          registry.refresh(
            repositoryChangeRequests({
              environmentId: target.environmentId,
              input: { cwd: target.input.cwd },
            }),
          );
        }),
      ),
    );
  const refreshConversationQuery = (
    target: {
      readonly environmentId: EnvironmentId;
      readonly input: { readonly cwd: string; readonly reference: string };
    },
    registry: AtomRegistry.AtomRegistry,
  ) =>
    Effect.sync(() => {
      registry.refresh(
        changeRequestConversation({
          environmentId: target.environmentId,
          input: {
            cwd: target.input.cwd,
            reference: normalizeChangeRequestReference(target.input.reference),
          },
        }),
      );
    });

  return {
    pullRequestResolution: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git:resolve-pull-request",
      tag: WS_METHODS.gitResolvePullRequest,
    }),
    changeRequestChecks,
    changeRequestMergeOptions,
    changeRequestConversation,
    changeRequestCommits,
    repositoryChangeRequests,
    mergeChangeRequest: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git:merge-change-request",
      tag: WS_METHODS.gitMergeChangeRequest,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
      onSuccess: refreshChangeRequestQueries,
    }),
    setAutoMerge: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git:set-auto-merge",
      tag: WS_METHODS.gitSetAutoMerge,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
      onSuccess: refreshChangeRequestQueries,
    }),
    updateChangeRequestState: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git:update-change-request-state",
      tag: WS_METHODS.gitUpdateChangeRequestState,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
      onSuccess: refreshChangeRequestQueries,
    }),
    addChangeRequestComment: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git:add-change-request-comment",
      tag: WS_METHODS.gitAddChangeRequestComment,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
      onSuccess: refreshConversationQuery,
    }),
    replyToChangeRequestThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git:reply-to-change-request-thread",
      tag: WS_METHODS.gitReplyToChangeRequestThread,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
      onSuccess: refreshConversationQuery,
    }),
    setChangeRequestThreadResolved: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git:set-change-request-thread-resolved",
      tag: WS_METHODS.gitSetChangeRequestThreadResolved,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
      onSuccess: refreshConversationQuery,
    }),
    deleteChangeRequestBranch: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git:delete-change-request-branch",
      tag: WS_METHODS.gitDeleteChangeRequestBranch,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
      onSuccess: refreshChangeRequestQueries,
    }),
    preparePullRequestThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git:prepare-pull-request-thread",
      tag: WS_METHODS.gitPreparePullRequestThread,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
    }),
  };
}
