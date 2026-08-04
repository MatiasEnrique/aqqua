import { WS_METHODS } from "@aqqua/contracts";
import { Atom } from "effect/unstable/reactivity";

import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { vcsCommandConcurrency, vcsCommandScheduler } from "./vcsCommandScheduler.ts";

export function createGitEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    pullRequestResolution: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git:resolve-pull-request",
      tag: WS_METHODS.gitResolvePullRequest,
    }),
    changeRequestMergeOptions: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git:change-request-merge-options",
      tag: WS_METHODS.gitGetChangeRequestMergeOptions,
      staleTimeMs: 5 * 60_000,
    }),
    mergeChangeRequest: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git:merge-change-request",
      tag: WS_METHODS.gitMergeChangeRequest,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
    }),
    setAutoMerge: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git:set-auto-merge",
      tag: WS_METHODS.gitSetAutoMerge,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
    }),
    updateChangeRequestState: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git:update-change-request-state",
      tag: WS_METHODS.gitUpdateChangeRequestState,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
    }),
    preparePullRequestThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git:prepare-pull-request-thread",
      tag: WS_METHODS.gitPreparePullRequestThread,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
    }),
  };
}
