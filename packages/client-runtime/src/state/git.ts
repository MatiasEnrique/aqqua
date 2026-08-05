import { type EnvironmentId, WS_METHODS } from "@aqqua/contracts";
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
              reference: target.input.reference,
            },
          };
          registry.refresh(changeRequestChecks(queryTarget));
          registry.refresh(changeRequestMergeOptions(queryTarget));
        }),
      ),
    );

  return {
    pullRequestResolution: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git:resolve-pull-request",
      tag: WS_METHODS.gitResolvePullRequest,
    }),
    changeRequestChecks,
    changeRequestMergeOptions,
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
    preparePullRequestThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git:prepare-pull-request-thread",
      tag: WS_METHODS.gitPreparePullRequestThread,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
    }),
  };
}
