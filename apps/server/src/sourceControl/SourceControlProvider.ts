import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type {
  ChangeRequest,
  ChangeRequestComment,
  ChangeRequestDescription,
  ChangeRequestReviewThread,
  ChangeRequestState,
  GitChangeRequestCommit,
  GitChangeRequestMergeMethod,
  GitChangeRequestCheck,
  GitRepositoryChangeRequestSummary,
  SourceControlProviderError,
  SourceControlProviderInfo,
  SourceControlProviderKind,
  SourceControlRepositoryCloneUrls,
  SourceControlRepositoryVisibility,
} from "@aqqua/contracts";

export interface SourceControlProviderContext {
  readonly provider: SourceControlProviderInfo;
  readonly remoteName: string;
  readonly remoteUrl: string;
}

export interface SourceControlRefSelector {
  readonly refName: string;
  readonly owner?: string;
  readonly repository?: string;
}

export type ChangeRequestChecksStatus = "success" | "failure" | "pending" | null;

export interface SourceControlProviderChecksCapability {
  readonly capabilities: {
    readonly checks: true;
  };
  readonly listChecks: (input: {
    readonly cwd: string;
    readonly context?: SourceControlProviderContext;
    readonly changeRequestNumber: number;
  }) => Effect.Effect<ChangeRequestChecksStatus, SourceControlProviderError>;
}

export interface SourceControlProviderCheckDetailsCapability {
  readonly capabilities: {
    readonly checkDetails: true;
  };
  readonly listCheckDetails: (
    input: ChangeRequestOperationInput,
  ) => Effect.Effect<ReadonlyArray<GitChangeRequestCheck>, SourceControlProviderError>;
}

export interface ChangeRequestMergeOptions {
  readonly methods: ReadonlyArray<GitChangeRequestMergeMethod>;
  readonly defaultMethod: GitChangeRequestMergeMethod;
  readonly autoMergeEnabled?: boolean | null;
}

export interface ChangeRequestOperationInput {
  readonly cwd: string;
  readonly context?: SourceControlProviderContext;
  readonly reference: string;
}

export interface ProviderChangeRequestConversation {
  readonly number: number;
  readonly state: ChangeRequestState;
  readonly headRefName: string;
  readonly isCrossRepository: boolean;
  readonly additions: number | null;
  readonly deletions: number | null;
  readonly reviewers: ReadonlyArray<string>;
  readonly description: ChangeRequestDescription;
  readonly comments: ReadonlyArray<ChangeRequestComment>;
  readonly commentsTruncated: boolean;
  readonly reviewThreads: ReadonlyArray<ChangeRequestReviewThread>;
  readonly reviewThreadsTruncated: boolean;
}

export interface SourceControlProviderConversationCapability {
  readonly capabilities: {
    readonly conversation: true;
  };
  readonly getChangeRequestConversation: (
    input: ChangeRequestOperationInput,
  ) => Effect.Effect<ProviderChangeRequestConversation, SourceControlProviderError>;
  readonly addChangeRequestComment: (
    input: ChangeRequestOperationInput & { readonly body: string },
  ) => Effect.Effect<void, SourceControlProviderError>;
  readonly replyToChangeRequestThread: (
    input: ChangeRequestOperationInput & { readonly threadId: string; readonly body: string },
  ) => Effect.Effect<void, SourceControlProviderError>;
  readonly setChangeRequestThreadResolved: (
    input: ChangeRequestOperationInput & { readonly threadId: string; readonly resolved: boolean },
  ) => Effect.Effect<void, SourceControlProviderError>;
}

export interface SourceControlProviderCommitsCapability {
  readonly capabilities: {
    readonly commits: true;
  };
  readonly listChangeRequestCommits: (input: ChangeRequestOperationInput) => Effect.Effect<
    {
      readonly number: number;
      readonly headOid: string | null;
      readonly commits: ReadonlyArray<GitChangeRequestCommit>;
      readonly truncated: boolean;
    },
    SourceControlProviderError
  >;
}

export interface SourceControlProviderChangeRequestListCapability {
  readonly capabilities: {
    readonly changeRequestList: true;
  };
  readonly listRepositoryChangeRequests: (input: {
    readonly cwd: string;
    readonly context?: SourceControlProviderContext;
    readonly limit?: number;
  }) => Effect.Effect<
    {
      readonly changeRequests: ReadonlyArray<GitRepositoryChangeRequestSummary>;
      readonly truncated: boolean;
    },
    SourceControlProviderError
  >;
}

export interface SourceControlProviderBranchDeleteCapability {
  readonly capabilities: {
    readonly branchDelete: true;
  };
  readonly deleteChangeRequestRemoteBranch: (
    input: ChangeRequestOperationInput,
  ) => Effect.Effect<
    { readonly branch: string; readonly remote: "deleted" | "already_missing" },
    SourceControlProviderError
  >;
}

export interface SourceControlProviderMergeCapability {
  readonly capabilities: {
    readonly merge: true;
  };
  readonly getChangeRequestMergeOptions: (
    input: ChangeRequestOperationInput,
  ) => Effect.Effect<ChangeRequestMergeOptions, SourceControlProviderError>;
  readonly mergeChangeRequest: (
    input: ChangeRequestOperationInput & {
      readonly method: GitChangeRequestMergeMethod;
    },
  ) => Effect.Effect<void, SourceControlProviderError>;
}

export interface SourceControlProviderAutoMergeCapability {
  readonly capabilities: {
    readonly autoMerge: true;
  };
  readonly setAutoMerge: (
    input: ChangeRequestOperationInput &
      (
        | {
            readonly enabled: true;
            readonly method: GitChangeRequestMergeMethod;
          }
        | {
            readonly enabled: false;
          }
      ),
  ) => Effect.Effect<void, SourceControlProviderError>;
}

export interface SourceControlProviderChangeRequestStateCapability {
  readonly capabilities: {
    readonly changeRequestState: true;
  };
  readonly updateChangeRequestState: (
    input: ChangeRequestOperationInput & {
      readonly state: "open" | "closed";
    },
  ) => Effect.Effect<void, SourceControlProviderError>;
}

const MAX_ERROR_TRANSPORT_VALUE_LENGTH = 256;

/**
 * Sanitizes user-provided source-control identifiers before attaching them to
 * contract errors. This is intentionally narrower than request validation: it
 * only strips URL secrets and bounds diagnostic values sent over transport.
 */
export function transportSafeSourceControlErrorValue(value: string): string {
  let printable = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    printable += codePoint !== undefined && (codePoint < 32 || codePoint === 127) ? " " : character;
  }
  const normalized = printable.trim().replace(/\s+/gu, " ");

  let safe = normalized;
  try {
    const url = new URL(normalized);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    safe = url.toString();
  } catch {
    // Plain repository and change-request identifiers are not URLs.
  }

  return safe.slice(0, MAX_ERROR_TRANSPORT_VALUE_LENGTH);
}

export function parseSourceControlOwnerRef(
  headSelector: string,
): SourceControlRefSelector | undefined {
  const match = /^([^:/\s]+):(.+)$/u.exec(headSelector.trim());
  const owner = match?.[1]?.trim();
  const refName = match?.[2]?.trim();
  return owner && refName ? { owner, refName } : undefined;
}

export function normalizeSourceBranch(headSelector: string): string {
  return parseSourceControlOwnerRef(headSelector)?.refName ?? headSelector.trim();
}

export function sourceBranch(input: {
  readonly headSelector: string;
  readonly source?: SourceControlRefSelector;
}): string {
  return input.source?.refName ?? normalizeSourceBranch(input.headSelector);
}

export function sourceControlRefFromInput(input: {
  readonly headSelector: string;
  readonly source?: SourceControlRefSelector;
}): SourceControlRefSelector | undefined {
  return input.source ?? parseSourceControlOwnerRef(input.headSelector);
}

export class SourceControlProvider extends Context.Service<
  SourceControlProvider,
  {
    readonly kind: SourceControlProviderKind;
    readonly capabilities?: {
      readonly checks?: boolean;
      readonly checkDetails?: boolean;
      readonly merge?: boolean;
      readonly autoMerge?: boolean;
      readonly changeRequestState?: boolean;
      readonly conversation?: boolean;
      readonly commits?: boolean;
      readonly changeRequestList?: boolean;
      readonly branchDelete?: boolean;
    };
    readonly listChecks?: SourceControlProviderChecksCapability["listChecks"];
    readonly listCheckDetails?: SourceControlProviderCheckDetailsCapability["listCheckDetails"];
    readonly getChangeRequestMergeOptions?: SourceControlProviderMergeCapability["getChangeRequestMergeOptions"];
    readonly mergeChangeRequest?: SourceControlProviderMergeCapability["mergeChangeRequest"];
    readonly setAutoMerge?: SourceControlProviderAutoMergeCapability["setAutoMerge"];
    readonly updateChangeRequestState?: SourceControlProviderChangeRequestStateCapability["updateChangeRequestState"];
    readonly getChangeRequestConversation?: SourceControlProviderConversationCapability["getChangeRequestConversation"];
    readonly addChangeRequestComment?: SourceControlProviderConversationCapability["addChangeRequestComment"];
    readonly replyToChangeRequestThread?: SourceControlProviderConversationCapability["replyToChangeRequestThread"];
    readonly setChangeRequestThreadResolved?: SourceControlProviderConversationCapability["setChangeRequestThreadResolved"];
    readonly listChangeRequestCommits?: SourceControlProviderCommitsCapability["listChangeRequestCommits"];
    readonly listRepositoryChangeRequests?: SourceControlProviderChangeRequestListCapability["listRepositoryChangeRequests"];
    readonly deleteChangeRequestRemoteBranch?: SourceControlProviderBranchDeleteCapability["deleteChangeRequestRemoteBranch"];
    readonly listChangeRequests: (input: {
      readonly cwd: string;
      readonly context?: SourceControlProviderContext;
      readonly source?: SourceControlRefSelector;
      readonly headSelector: string;
      readonly state: ChangeRequestState | "all";
      readonly limit?: number;
    }) => Effect.Effect<ReadonlyArray<ChangeRequest>, SourceControlProviderError>;
    readonly getChangeRequest: (input: {
      readonly cwd: string;
      readonly context?: SourceControlProviderContext;
      readonly reference: string;
    }) => Effect.Effect<ChangeRequest, SourceControlProviderError>;
    readonly createChangeRequest: (input: {
      readonly cwd: string;
      readonly context?: SourceControlProviderContext;
      readonly source?: SourceControlRefSelector;
      readonly target?: SourceControlRefSelector;
      readonly baseRefName: string;
      readonly headSelector: string;
      readonly title: string;
      readonly bodyFile: string;
    }) => Effect.Effect<void, SourceControlProviderError>;
    readonly getRepositoryCloneUrls: (input: {
      readonly cwd: string;
      readonly context?: SourceControlProviderContext;
      readonly repository: string;
    }) => Effect.Effect<SourceControlRepositoryCloneUrls, SourceControlProviderError>;
    readonly createRepository: (input: {
      readonly cwd: string;
      readonly repository: string;
      readonly visibility: SourceControlRepositoryVisibility;
    }) => Effect.Effect<SourceControlRepositoryCloneUrls, SourceControlProviderError>;
    readonly getDefaultBranch: (input: {
      readonly cwd: string;
      readonly context?: SourceControlProviderContext;
    }) => Effect.Effect<string | null, SourceControlProviderError>;
    readonly checkoutChangeRequest: (input: {
      readonly cwd: string;
      readonly context?: SourceControlProviderContext;
      readonly reference: string;
      readonly force?: boolean;
    }) => Effect.Effect<void, SourceControlProviderError>;
  }
>()("aqqua/sourceControl/SourceControlProvider") {}

export function supportsChangeRequestChecks(
  provider: SourceControlProvider["Service"],
): provider is SourceControlProvider["Service"] & SourceControlProviderChecksCapability {
  return provider.capabilities?.checks === true && provider.listChecks !== undefined;
}

export function supportsChangeRequestCheckDetails(
  provider: SourceControlProvider["Service"],
): provider is SourceControlProvider["Service"] & SourceControlProviderCheckDetailsCapability {
  return provider.capabilities?.checkDetails === true && provider.listCheckDetails !== undefined;
}

export function supportsChangeRequestMerge(
  provider: SourceControlProvider["Service"],
): provider is SourceControlProvider["Service"] & SourceControlProviderMergeCapability {
  return (
    provider.capabilities?.merge === true &&
    provider.getChangeRequestMergeOptions !== undefined &&
    provider.mergeChangeRequest !== undefined
  );
}

export function supportsChangeRequestAutoMerge(
  provider: SourceControlProvider["Service"],
): provider is SourceControlProvider["Service"] & SourceControlProviderAutoMergeCapability {
  return provider.capabilities?.autoMerge === true && provider.setAutoMerge !== undefined;
}

export function supportsChangeRequestStateUpdate(
  provider: SourceControlProvider["Service"],
): provider is SourceControlProvider["Service"] &
  SourceControlProviderChangeRequestStateCapability {
  return (
    provider.capabilities?.changeRequestState === true &&
    provider.updateChangeRequestState !== undefined
  );
}

export function supportsChangeRequestConversation(
  provider: SourceControlProvider["Service"],
): provider is SourceControlProvider["Service"] & SourceControlProviderConversationCapability {
  return (
    provider.capabilities?.conversation === true &&
    provider.getChangeRequestConversation !== undefined &&
    provider.addChangeRequestComment !== undefined &&
    provider.replyToChangeRequestThread !== undefined &&
    provider.setChangeRequestThreadResolved !== undefined
  );
}

export function supportsChangeRequestCommits(
  provider: SourceControlProvider["Service"],
): provider is SourceControlProvider["Service"] & SourceControlProviderCommitsCapability {
  return provider.capabilities?.commits === true && provider.listChangeRequestCommits !== undefined;
}

export function supportsRepositoryChangeRequestList(
  provider: SourceControlProvider["Service"],
): provider is SourceControlProvider["Service"] & SourceControlProviderChangeRequestListCapability {
  return (
    provider.capabilities?.changeRequestList === true &&
    provider.listRepositoryChangeRequests !== undefined
  );
}

export function supportsChangeRequestBranchDelete(
  provider: SourceControlProvider["Service"],
): provider is SourceControlProvider["Service"] & SourceControlProviderBranchDeleteCapability {
  return (
    provider.capabilities?.branchDelete === true &&
    provider.deleteChangeRequestRemoteBranch !== undefined
  );
}
