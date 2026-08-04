import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { SourceControlProviderError, type ChangeRequest } from "@aqqua/contracts";

import * as BitbucketApi from "./BitbucketApi.ts";
import type { NormalizedBitbucketPullRequestRecord } from "./bitbucketPullRequests.ts";
import * as SourceControlProvider from "./SourceControlProvider.ts";
import type { SourceControlApiDiscoverySpec } from "./SourceControlProviderDiscovery.ts";

function toChangeRequest(summary: NormalizedBitbucketPullRequestRecord): ChangeRequest {
  return {
    provider: "bitbucket",
    number: summary.number,
    title: summary.title,
    url: summary.url,
    baseRefName: summary.baseRefName,
    headRefName: summary.headRefName,
    state: summary.state,
    updatedAt: summary.updatedAt ?? Option.none(),
    ...(summary.isCrossRepository !== undefined
      ? { isCrossRepository: summary.isCrossRepository }
      : {}),
    ...(summary.headRepositoryNameWithOwner !== undefined
      ? { headRepositoryNameWithOwner: summary.headRepositoryNameWithOwner }
      : {}),
    ...(summary.headRepositoryOwnerLogin !== undefined
      ? { headRepositoryOwnerLogin: summary.headRepositoryOwnerLogin }
      : {}),
  };
}

export const make = Effect.gen(function* () {
  const bitbucket = yield* BitbucketApi.BitbucketApi;

  return SourceControlProvider.SourceControlProvider.of({
    kind: "bitbucket",
    capabilities: { checks: true, merge: true, changeRequestState: true },
    listChecks: (input) =>
      bitbucket.listChecks(input).pipe(
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: "bitbucket",
              operation: "listChecks",
              cwd: input.cwd,
              reference: String(input.changeRequestNumber),
              detail: "Failed to list checks.",
              cause: error,
            }),
        ),
      ),
    getChangeRequestMergeOptions: (input) =>
      bitbucket.getMergeOptions(input).pipe(
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: "bitbucket",
              operation: "getChangeRequestMergeOptions",
              cwd: input.cwd,
              reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                input.reference,
              ),
              detail: "Failed to read the repository merge strategy.",
              cause: error,
            }),
        ),
      ),
    mergeChangeRequest: (input) =>
      bitbucket.mergePullRequest(input).pipe(
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: "bitbucket",
              operation: "mergeChangeRequest",
              cwd: input.cwd,
              reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                input.reference,
              ),
              detail:
                "Bitbucket could not merge this pull request. Check conflicts, required checks, permissions, and branch restrictions.",
              cause: error,
            }),
        ),
      ),
    updateChangeRequestState: (input) =>
      bitbucket.updatePullRequestState(input).pipe(
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: "bitbucket",
              operation: "updateChangeRequestState",
              cwd: input.cwd,
              reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                input.reference,
              ),
              detail: `Bitbucket could not ${input.state === "open" ? "reopen" : "close"} this pull request. Check your permissions and the pull request state.`,
              cause: error,
            }),
        ),
      ),
    listChangeRequests: (input) => {
      const source = SourceControlProvider.sourceControlRefFromInput(input);
      return bitbucket
        .listPullRequests({
          cwd: input.cwd,
          ...(input.context ? { context: input.context } : {}),
          headSelector: input.headSelector,
          ...(source ? { source } : {}),
          state: input.state,
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        })
        .pipe(
          Effect.map((items) => items.map(toChangeRequest)),
          Effect.mapError(
            (error) =>
              new SourceControlProviderError({
                provider: "bitbucket",
                operation: "listChangeRequests",
                cwd: input.cwd,
                reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                  input.headSelector,
                ),
                detail: "Failed to list change requests.",
                cause: error,
              }),
          ),
        );
    },
    getChangeRequest: (input) =>
      bitbucket.getPullRequest(input).pipe(
        Effect.map(toChangeRequest),
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: "bitbucket",
              operation: "getChangeRequest",
              cwd: input.cwd,
              reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                input.reference,
              ),
              detail: "Failed to get change request.",
              cause: error,
            }),
        ),
      ),
    createChangeRequest: (input) => {
      const source = SourceControlProvider.sourceControlRefFromInput(input);
      return bitbucket
        .createPullRequest({
          cwd: input.cwd,
          ...(input.context ? { context: input.context } : {}),
          baseBranch: input.baseRefName,
          headSelector: input.headSelector,
          ...(source ? { source } : {}),
          ...(input.target ? { target: input.target } : {}),
          title: input.title,
          bodyFile: input.bodyFile,
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new SourceControlProviderError({
                provider: "bitbucket",
                operation: "createChangeRequest",
                cwd: input.cwd,
                reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                  input.headSelector,
                ),
                detail: "Failed to create change request.",
                cause: error,
              }),
          ),
        );
    },
    getRepositoryCloneUrls: (input) =>
      bitbucket.getRepositoryCloneUrls(input).pipe(
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: "bitbucket",
              operation: "getRepositoryCloneUrls",
              cwd: input.cwd,
              repository: SourceControlProvider.transportSafeSourceControlErrorValue(
                input.repository,
              ),
              detail: "Failed to get repository clone URLs.",
              cause: error,
            }),
        ),
      ),
    createRepository: (input) =>
      bitbucket.createRepository(input).pipe(
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: "bitbucket",
              operation: "createRepository",
              cwd: input.cwd,
              repository: SourceControlProvider.transportSafeSourceControlErrorValue(
                input.repository,
              ),
              detail: "Failed to create repository.",
              cause: error,
            }),
        ),
      ),
    getDefaultBranch: (input) =>
      bitbucket
        .getDefaultBranch({
          cwd: input.cwd,
          ...(input.context ? { context: input.context } : {}),
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new SourceControlProviderError({
                provider: "bitbucket",
                operation: "getDefaultBranch",
                cwd: input.cwd,
                detail: "Failed to get default branch.",
                cause: error,
              }),
          ),
        ),
    checkoutChangeRequest: (input) =>
      bitbucket
        .checkoutPullRequest({
          cwd: input.cwd,
          ...(input.context ? { context: input.context } : {}),
          reference: input.reference,
          ...(input.force !== undefined ? { force: input.force } : {}),
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new SourceControlProviderError({
                provider: "bitbucket",
                operation: "checkoutChangeRequest",
                cwd: input.cwd,
                reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                  input.reference,
                ),
                detail: "Failed to check out change request.",
                cause: error,
              }),
          ),
        ),
  });
});

export const layer = Layer.effect(SourceControlProvider.SourceControlProvider, make);

export const makeDiscovery = Effect.gen(function* () {
  const bitbucket = yield* BitbucketApi.BitbucketApi;

  return {
    type: "api",
    kind: "bitbucket",
    label: "Bitbucket",
    installHint:
      "Set AQQUA_BITBUCKET_EMAIL and AQQUA_BITBUCKET_API_TOKEN on the server (use a Bitbucket API token with pull request and repository scopes).",
    probeAuth: bitbucket.probeAuth,
  } satisfies SourceControlApiDiscoverySpec;
});
