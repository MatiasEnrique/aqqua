import * as Schema from "effect/Schema";
import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { SourceControlProviderError, SourceControlProviderInfo } from "./sourceControl.ts";
import { VcsDriverKind } from "./vcs.ts";

const TrimmedNonEmptyStringSchema = TrimmedNonEmptyString;
const GIT_LIST_BRANCHES_MAX_LIMIT = 200;
const GIT_LIST_HISTORY_MAX_LIMIT = 200;

// Domain Types

export const GitStackedAction = Schema.Literals([
  "commit",
  "push",
  "create_pr",
  "commit_push",
  "commit_push_pr",
]);
export type GitStackedAction = typeof GitStackedAction.Type;
export const GitActionProgressPhase = Schema.Literals(["branch", "commit", "push", "pr"]);
export type GitActionProgressPhase = typeof GitActionProgressPhase.Type;
export const GitActionProgressKind = Schema.Literals([
  "action_started",
  "phase_started",
  "hook_started",
  "hook_output",
  "hook_finished",
  "action_finished",
  "action_failed",
]);
export type GitActionProgressKind = typeof GitActionProgressKind.Type;
export const GitActionProgressStream = Schema.Literals(["stdout", "stderr"]);
export type GitActionProgressStream = typeof GitActionProgressStream.Type;
const GitCommitStepStatus = Schema.Literals([
  "created",
  "skipped_no_changes",
  "skipped_not_requested",
]);
const GitPushStepStatus = Schema.Literals([
  "pushed",
  "skipped_not_requested",
  "skipped_up_to_date",
]);
const GitBranchStepStatus = Schema.Literals(["created", "skipped_not_requested"]);
const GitPrStepStatus = Schema.Literals(["created", "opened_existing", "skipped_not_requested"]);
const VcsStatusChangeRequestState = Schema.Literals(["open", "closed", "merged"]);
const GitPullRequestReference = TrimmedNonEmptyStringSchema;
const GitPullRequestState = Schema.Literals(["open", "closed", "merged"]);
const GitPreparePullRequestThreadMode = Schema.Literals(["local", "worktree"]);
export const GitChangeRequestMergeMethod = Schema.Literals(["merge", "squash", "rebase"]);
export type GitChangeRequestMergeMethod = typeof GitChangeRequestMergeMethod.Type;
export const GitRunStackedActionToastRunAction = Schema.Struct({
  kind: GitStackedAction,
});
export type GitRunStackedActionToastRunAction = typeof GitRunStackedActionToastRunAction.Type;
const GitRunStackedActionToastCta = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("none"),
  }),
  Schema.Struct({
    kind: Schema.Literal("open_pr"),
    label: TrimmedNonEmptyStringSchema,
    url: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("run_action"),
    label: TrimmedNonEmptyStringSchema,
    action: GitRunStackedActionToastRunAction,
  }),
]);
export type GitRunStackedActionToastCta = typeof GitRunStackedActionToastCta.Type;
const GitRunStackedActionToast = Schema.Struct({
  title: TrimmedNonEmptyStringSchema,
  description: Schema.optional(TrimmedNonEmptyStringSchema),
  cta: GitRunStackedActionToastCta,
});
export type GitRunStackedActionToast = typeof GitRunStackedActionToast.Type;

export const VcsRef = Schema.Struct({
  name: TrimmedNonEmptyStringSchema,
  isRemote: Schema.optional(Schema.Boolean),
  remoteName: Schema.optional(TrimmedNonEmptyStringSchema),
  current: Schema.Boolean,
  isDefault: Schema.Boolean,
  worktreePath: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
});
export type VcsRef = typeof VcsRef.Type;

export const GitObjectId = Schema.String.check(Schema.isPattern(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/));
export type GitObjectId = typeof GitObjectId.Type;

export const GitHistoryRefKind = Schema.Literals(["local_branch", "remote_branch", "tag"]);
export type GitHistoryRefKind = typeof GitHistoryRefKind.Type;

export const GitHistoryRef = Schema.Struct({
  name: TrimmedNonEmptyStringSchema,
  kind: GitHistoryRefKind,
  current: Schema.Boolean,
});
export type GitHistoryRef = typeof GitHistoryRef.Type;

export const GitHistoryCommitSummary = Schema.Struct({
  id: GitObjectId,
  parentIds: Schema.Array(GitObjectId),
  subject: Schema.String,
  authorName: Schema.String,
  authorEmail: Schema.String,
  authoredAt: IsoDateTime,
  committedAt: IsoDateTime,
  isHead: Schema.Boolean,
  refs: Schema.Array(GitHistoryRef),
});
export type GitHistoryCommitSummary = typeof GitHistoryCommitSummary.Type;

export const GitHistoryFileChangeKind = Schema.Literals([
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "type_changed",
  "unmerged",
  "unknown",
]);
export type GitHistoryFileChangeKind = typeof GitHistoryFileChangeKind.Type;

export const GitHistoryFileChange = Schema.Struct({
  path: TrimmedNonEmptyStringSchema,
  previousPath: Schema.NullOr(TrimmedNonEmptyStringSchema),
  kind: GitHistoryFileChangeKind,
  insertions: Schema.NullOr(NonNegativeInt),
  deletions: Schema.NullOr(NonNegativeInt),
  binary: Schema.Boolean,
});
export type GitHistoryFileChange = typeof GitHistoryFileChange.Type;

const VcsWorktree = Schema.Struct({
  path: TrimmedNonEmptyStringSchema,
  refName: TrimmedNonEmptyStringSchema,
});
const GitResolvedPullRequest = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyStringSchema,
  url: Schema.String,
  baseBranch: TrimmedNonEmptyStringSchema,
  headBranch: TrimmedNonEmptyStringSchema,
  state: GitPullRequestState,
});
export type GitResolvedPullRequest = typeof GitResolvedPullRequest.Type;

// RPC Inputs

export const VcsStatusInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export type VcsStatusInput = typeof VcsStatusInput.Type;

export const VcsPullInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export type VcsPullInput = typeof VcsPullInput.Type;

export const GitRunStackedActionInput = Schema.Struct({
  actionId: TrimmedNonEmptyStringSchema,
  cwd: TrimmedNonEmptyStringSchema,
  action: GitStackedAction,
  commitMessage: Schema.optional(TrimmedNonEmptyStringSchema.check(Schema.isMaxLength(10_000))),
  featureBranch: Schema.optional(Schema.Boolean),
  filePaths: Schema.optional(
    Schema.Array(TrimmedNonEmptyStringSchema).check(Schema.isMinLength(1)),
  ),
});
export type GitRunStackedActionInput = typeof GitRunStackedActionInput.Type;

export const VcsListRefsInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  query: Schema.optional(TrimmedNonEmptyStringSchema.check(Schema.isMaxLength(256))),
  cursor: Schema.optional(NonNegativeInt),
  includeMatchingRemoteRefs: Schema.optional(Schema.Boolean),
  refKind: Schema.optional(Schema.Literals(["all", "local", "remote"])),
  refresh: Schema.optional(Schema.Boolean),
  limit: Schema.optional(
    PositiveInt.check(Schema.isLessThanOrEqualTo(GIT_LIST_BRANCHES_MAX_LIMIT)),
  ),
});
export type VcsListRefsInput = typeof VcsListRefsInput.Type;

/** Opaque continuation token for stable Git history pagination. Clients must not interpret it. */
export const VcsListHistoryCursor = TrimmedNonEmptyStringSchema.check(Schema.isMaxLength(65_536));
export type VcsListHistoryCursor = typeof VcsListHistoryCursor.Type;

export const VcsListHistoryInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  cursor: Schema.optional(VcsListHistoryCursor),
  includeOrigin: Schema.optional(Schema.Boolean),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(GIT_LIST_HISTORY_MAX_LIMIT))),
});
export type VcsListHistoryInput = typeof VcsListHistoryInput.Type;

export const VcsGetCommitDetailsInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  commitId: GitObjectId,
});
export type VcsGetCommitDetailsInput = typeof VcsGetCommitDetailsInput.Type;

export const VcsGetCommitDiffInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  commitId: GitObjectId,
});
export type VcsGetCommitDiffInput = typeof VcsGetCommitDiffInput.Type;

const GitHistoryPath = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(16_384));

export const VcsGetCommitFileDiffInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  commitId: GitObjectId,
  path: GitHistoryPath,
  previousPath: Schema.NullOr(GitHistoryPath),
});
export type VcsGetCommitFileDiffInput = typeof VcsGetCommitFileDiffInput.Type;

export const VcsCreateWorktreeInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  refName: TrimmedNonEmptyStringSchema,
  newRefName: Schema.optional(TrimmedNonEmptyStringSchema),
  baseRefName: Schema.optional(TrimmedNonEmptyStringSchema),
  path: Schema.NullOr(TrimmedNonEmptyStringSchema),
});
export type VcsCreateWorktreeInput = typeof VcsCreateWorktreeInput.Type;

export const GitPullRequestRefInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  reference: GitPullRequestReference,
});
export type GitPullRequestRefInput = typeof GitPullRequestRefInput.Type;

export const GitGetChangeRequestMergeOptionsInput = GitPullRequestRefInput;
export type GitGetChangeRequestMergeOptionsInput = typeof GitGetChangeRequestMergeOptionsInput.Type;

export const GitGetChangeRequestChecksInput = GitPullRequestRefInput;
export type GitGetChangeRequestChecksInput = typeof GitGetChangeRequestChecksInput.Type;

// --- Change request conversation (GitHub-only capability; other providers report supported: false)

export const ChangeRequestActor = Schema.Struct({
  login: TrimmedNonEmptyStringSchema,
});
export type ChangeRequestActor = typeof ChangeRequestActor.Type;

export const ChangeRequestComment = Schema.Struct({
  /** Provider node id — reply/resolve anchors. Opaque to clients. */
  id: TrimmedNonEmptyStringSchema,
  /** null = deleted or ghost user */
  author: Schema.NullOr(ChangeRequestActor),
  body: Schema.String,
  createdAt: Schema.NullOr(IsoDateTime),
  url: Schema.String,
});
export type ChangeRequestComment = typeof ChangeRequestComment.Type;

export const ChangeRequestReviewThread = Schema.Struct({
  /** Provider thread node id — target for reply and resolve/unresolve. */
  id: TrimmedNonEmptyStringSchema,
  isResolved: Schema.Boolean,
  isOutdated: Schema.Boolean,
  path: Schema.NullOr(TrimmedNonEmptyStringSchema),
  line: Schema.NullOr(PositiveInt),
  startLine: Schema.NullOr(PositiveInt),
  diffSide: Schema.optional(Schema.Literals(["LEFT", "RIGHT"])),
  comments: Schema.Array(ChangeRequestComment),
  commentsTruncated: Schema.Boolean,
});
export type ChangeRequestReviewThread = typeof ChangeRequestReviewThread.Type;

export const ChangeRequestDescription = Schema.Struct({
  author: Schema.NullOr(ChangeRequestActor),
  body: Schema.String,
  createdAt: Schema.NullOr(IsoDateTime),
  url: Schema.String,
});
export type ChangeRequestDescription = typeof ChangeRequestDescription.Type;

export const GitGetChangeRequestConversationInput = GitPullRequestRefInput;
export type GitGetChangeRequestConversationInput = typeof GitGetChangeRequestConversationInput.Type;

const GitChangeRequestCommentBody = TrimmedNonEmptyStringSchema.check(Schema.isMaxLength(65_536));

export const GitAddChangeRequestCommentInput = Schema.Struct({
  ...GitPullRequestRefInput.fields,
  body: GitChangeRequestCommentBody,
});
export type GitAddChangeRequestCommentInput = typeof GitAddChangeRequestCommentInput.Type;

export const GitReplyToChangeRequestThreadInput = Schema.Struct({
  ...GitPullRequestRefInput.fields,
  threadId: TrimmedNonEmptyStringSchema,
  body: GitChangeRequestCommentBody,
});
export type GitReplyToChangeRequestThreadInput = typeof GitReplyToChangeRequestThreadInput.Type;

export const GitSetChangeRequestThreadResolvedInput = Schema.Struct({
  ...GitPullRequestRefInput.fields,
  threadId: TrimmedNonEmptyStringSchema,
  resolved: Schema.Boolean,
});
export type GitSetChangeRequestThreadResolvedInput =
  typeof GitSetChangeRequestThreadResolvedInput.Type;

// --- Change request commits

export const GitListChangeRequestCommitsInput = GitPullRequestRefInput;
export type GitListChangeRequestCommitsInput = typeof GitListChangeRequestCommitsInput.Type;

// --- Repository change request list

export const GitListRepositoryChangeRequestsInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(50))),
});
export type GitListRepositoryChangeRequestsInput = typeof GitListRepositoryChangeRequestsInput.Type;

// --- Delete change request branch (remote + optional local cleanup)

export const GitDeleteChangeRequestBranchInput = Schema.Struct({
  ...GitPullRequestRefInput.fields,
  /** Also delete the plain local branch (no worktree) tracking the PR head. */
  deleteLocalBranch: Schema.optional(Schema.Boolean),
});
export type GitDeleteChangeRequestBranchInput = typeof GitDeleteChangeRequestBranchInput.Type;

export const GitMergeChangeRequestInput = Schema.Struct({
  ...GitPullRequestRefInput.fields,
  method: GitChangeRequestMergeMethod,
});
export type GitMergeChangeRequestInput = typeof GitMergeChangeRequestInput.Type;

export const GitSetAutoMergeInput = Schema.Union([
  Schema.Struct({
    ...GitPullRequestRefInput.fields,
    enabled: Schema.Literal(true),
    method: GitChangeRequestMergeMethod,
  }),
  Schema.Struct({
    ...GitPullRequestRefInput.fields,
    enabled: Schema.Literal(false),
  }),
]);
export type GitSetAutoMergeInput = typeof GitSetAutoMergeInput.Type;

export const GitUpdateChangeRequestStateInput = Schema.Struct({
  ...GitPullRequestRefInput.fields,
  state: Schema.Literals(["open", "closed"]),
});
export type GitUpdateChangeRequestStateInput = typeof GitUpdateChangeRequestStateInput.Type;

export const GitPreparePullRequestThreadInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  reference: GitPullRequestReference,
  mode: GitPreparePullRequestThreadMode,
  threadId: Schema.optional(ThreadId),
});
export type GitPreparePullRequestThreadInput = typeof GitPreparePullRequestThreadInput.Type;

export const VcsRemoveWorktreeInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  path: TrimmedNonEmptyStringSchema,
  force: Schema.optional(Schema.Boolean),
});
export type VcsRemoveWorktreeInput = typeof VcsRemoveWorktreeInput.Type;

export const VcsInspectWorktreeRemovalInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  path: TrimmedNonEmptyStringSchema,
});
export type VcsInspectWorktreeRemovalInput = typeof VcsInspectWorktreeRemovalInput.Type;

export const VcsInspectWorktreeRemovalResult = Schema.Struct({
  availability: Schema.Literals(["available", "missing", "not_worktree"]),
  refName: Schema.NullOr(TrimmedNonEmptyStringSchema),
  headCommit: Schema.NullOr(TrimmedNonEmptyStringSchema),
  baseRef: Schema.NullOr(TrimmedNonEmptyStringSchema),
  mergeStatus: Schema.Literals(["merged", "unmerged", "unknown"]),
  workingTreeStatus: Schema.Literals(["clean", "dirty", "unknown"]),
});
export type VcsInspectWorktreeRemovalResult = typeof VcsInspectWorktreeRemovalResult.Type;

/**
 * Server-owned worktree deletion: membership, thread cascade, and filesystem
 * removal are decided and executed on the server in one typed operation.
 * Partial progress is explicit so a failed filesystem step can be retried
 * without pretending the multi-resource delete is atomic.
 */
export const VcsDeleteWorktreeInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  path: TrimmedNonEmptyStringSchema,
  force: Schema.optional(Schema.Boolean),
  /** Delete the inspected local branch after its worktree is removed. Remote refs are untouched. */
  deleteBranch: Schema.optional(Schema.Boolean),
});
export type VcsDeleteWorktreeInput = typeof VcsDeleteWorktreeInput.Type;

/**
 * Filesystem outcome for a worktree deletion attempt.
 * - completed: `removed` or `already_missing`
 * - partial: always present so clients can tell whether the tree is still on disk
 *   (`not_attempted` / `failed`) or already gone (`removed`)
 */
export const VcsDeleteWorktreeRemoval = Schema.Literals([
  "not_attempted",
  "failed",
  "removed",
  "already_missing",
]);
export type VcsDeleteWorktreeRemoval = typeof VcsDeleteWorktreeRemoval.Type;

export const VcsDeleteBranchRemoval = Schema.Literals(["removed", "failed", "unavailable"]);
export type VcsDeleteBranchRemoval = typeof VcsDeleteBranchRemoval.Type;

export const VcsDeleteWorktreeResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("completed"),
    /** Live conversation-family roots archived before filesystem removal. */
    archivedThreadIds: Schema.Array(ThreadId),
    worktreeRemoval: Schema.Literals(["removed", "already_missing"]),
    preservedUnverifiedPath: Schema.optional(Schema.Boolean),
    branchRemoval: Schema.optional(VcsDeleteBranchRemoval),
  }),
  Schema.Struct({
    status: Schema.Literal("partial"),
    stage: Schema.Literals(["conversation", "worktree", "branch"]),
    archivedThreadIds: Schema.Array(ThreadId),
    retryable: Schema.Boolean,
    detail: Schema.String,
    worktreeRemoval: Schema.Literals(["not_attempted", "failed", "removed"]),
    branchRemoval: Schema.optional(VcsDeleteBranchRemoval),
  }),
  Schema.Struct({
    status: Schema.Literal("rejected"),
    reason: Schema.Literal("not_worktree"),
  }),
]);
export type VcsDeleteWorktreeResult = typeof VcsDeleteWorktreeResult.Type;

export const VcsCreateRefInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  refName: TrimmedNonEmptyStringSchema,
  switchRef: Schema.optional(Schema.Boolean),
});
export type VcsCreateRefInput = typeof VcsCreateRefInput.Type;

export const VcsCreateRefResult = Schema.Struct({
  refName: TrimmedNonEmptyStringSchema,
});
export type VcsCreateRefResult = typeof VcsCreateRefResult.Type;

export const VcsSwitchRefInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  refName: TrimmedNonEmptyStringSchema,
});
export type VcsSwitchRefInput = typeof VcsSwitchRefInput.Type;

export const VcsInitInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  kind: Schema.optional(VcsDriverKind),
});
export type VcsInitInput = typeof VcsInitInput.Type;

// RPC Results

const VcsStatusChangeRequest = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyStringSchema,
  url: Schema.String,
  baseRef: TrimmedNonEmptyStringSchema,
  headRef: TrimmedNonEmptyStringSchema,
  state: VcsStatusChangeRequestState,
  /** Whether the provider has confirmed that the source and target refs conflict. Omitted when unknown. */
  hasConflicts: Schema.optional(Schema.Boolean),
  checksStatus: Schema.optional(Schema.NullOr(Schema.Literals(["success", "failure", "pending"]))),
});

const VcsStatusLocalShape = {
  isRepo: Schema.Boolean,
  sourceControlProvider: Schema.optional(SourceControlProviderInfo),
  hasPrimaryRemote: Schema.Boolean,
  isDefaultRef: Schema.Boolean,
  refName: Schema.NullOr(TrimmedNonEmptyStringSchema),
  hasWorkingTreeChanges: Schema.Boolean,
  workingTree: Schema.Struct({
    files: Schema.Array(
      Schema.Struct({
        path: TrimmedNonEmptyStringSchema,
        insertions: NonNegativeInt,
        deletions: NonNegativeInt,
      }),
    ),
    insertions: NonNegativeInt,
    deletions: NonNegativeInt,
  }),
};

const VcsStatusRemoteShape = {
  hasUpstream: Schema.Boolean,
  aheadCount: NonNegativeInt,
  behindCount: NonNegativeInt,
  aheadOfDefaultCount: Schema.optional(NonNegativeInt),
  pr: Schema.NullOr(VcsStatusChangeRequest),
};

export const VcsStatusLocalResult = Schema.Struct(VcsStatusLocalShape);
export type VcsStatusLocalResult = typeof VcsStatusLocalResult.Type;

export const VcsStatusRemoteResult = Schema.Struct(VcsStatusRemoteShape);
export type VcsStatusRemoteResult = typeof VcsStatusRemoteResult.Type;

export const VcsStatusResult = Schema.Struct({
  ...VcsStatusLocalShape,
  ...VcsStatusRemoteShape,
});
export type VcsStatusResult = typeof VcsStatusResult.Type;

export const VcsStatusStreamEvent = Schema.Union([
  Schema.TaggedStruct("snapshot", {
    local: VcsStatusLocalResult,
    remote: Schema.NullOr(VcsStatusRemoteResult),
  }),
  Schema.TaggedStruct("localUpdated", {
    local: VcsStatusLocalResult,
  }),
  Schema.TaggedStruct("remoteUpdated", {
    remote: Schema.NullOr(VcsStatusRemoteResult),
  }),
]);
export type VcsStatusStreamEvent = typeof VcsStatusStreamEvent.Type;

export const VcsListRefsResult = Schema.Struct({
  refs: Schema.Array(VcsRef),
  isRepo: Schema.Boolean,
  hasPrimaryRemote: Schema.Boolean,
  nextCursor: NonNegativeInt.pipe(Schema.NullOr),
  totalCount: NonNegativeInt,
});
export type VcsListRefsResult = typeof VcsListRefsResult.Type;

export const VcsListHistoryResult = Schema.Struct({
  commits: Schema.Array(GitHistoryCommitSummary),
  isRepo: Schema.Boolean,
  nextCursor: Schema.NullOr(VcsListHistoryCursor),
  referencesTruncated: Schema.Boolean,
});
export type VcsListHistoryResult = typeof VcsListHistoryResult.Type;

export const VcsGetCommitDetailsResult = Schema.Struct({
  commitId: GitObjectId,
  committerName: Schema.String,
  committerEmail: Schema.String,
  committedAt: IsoDateTime,
  body: Schema.String,
  bodyTruncated: Schema.Boolean,
  comparisonParentId: Schema.NullOr(GitObjectId),
  files: Schema.Array(GitHistoryFileChange),
  filesTruncated: Schema.Boolean,
});
export type VcsGetCommitDetailsResult = typeof VcsGetCommitDetailsResult.Type;

export const VcsGetCommitDiffResult = Schema.Struct({
  commitId: GitObjectId,
  diff: Schema.String,
  truncated: Schema.Boolean,
});
export type VcsGetCommitDiffResult = typeof VcsGetCommitDiffResult.Type;

export const VcsGetCommitFileDiffResult = Schema.Struct({
  commitId: GitObjectId,
  path: GitHistoryPath,
  diff: Schema.String,
  truncated: Schema.Boolean,
});
export type VcsGetCommitFileDiffResult = typeof VcsGetCommitFileDiffResult.Type;

export const VcsCreateWorktreeResult = Schema.Struct({
  worktree: VcsWorktree,
});
export type VcsCreateWorktreeResult = typeof VcsCreateWorktreeResult.Type;

export const GitResolvePullRequestResult = Schema.Struct({
  pullRequest: GitResolvedPullRequest,
});
export type GitResolvePullRequestResult = typeof GitResolvePullRequestResult.Type;

export const GitChangeRequestCheck = Schema.Struct({
  name: TrimmedNonEmptyStringSchema,
  status: Schema.Literals(["pending", "success", "failure", "skipped", "neutral"]),
  detailsUrl: Schema.optional(TrimmedNonEmptyStringSchema),
});
export type GitChangeRequestCheck = typeof GitChangeRequestCheck.Type;

export const GitGetChangeRequestChecksResult = Schema.Struct({
  checks: Schema.Array(GitChangeRequestCheck),
  supported: Schema.Boolean,
});
export type GitGetChangeRequestChecksResult = typeof GitGetChangeRequestChecksResult.Type;

export const GitGetChangeRequestConversationResult = Schema.Struct({
  supported: Schema.Boolean,
  /** null when unsupported */
  description: Schema.NullOr(ChangeRequestDescription),
  additions: Schema.NullOr(NonNegativeInt),
  deletions: Schema.NullOr(NonNegativeInt),
  /** Requested reviewer logins/team slugs. Display-only. */
  reviewers: Schema.Array(TrimmedNonEmptyStringSchema),
  comments: Schema.Array(ChangeRequestComment),
  commentsTruncated: Schema.Boolean,
  reviewThreads: Schema.Array(ChangeRequestReviewThread),
  reviewThreadsTruncated: Schema.Boolean,
});
export type GitGetChangeRequestConversationResult =
  typeof GitGetChangeRequestConversationResult.Type;

export const GitAddChangeRequestCommentResult = Schema.Struct({
  added: Schema.Literal(true),
});
export type GitAddChangeRequestCommentResult = typeof GitAddChangeRequestCommentResult.Type;

export const GitReplyToChangeRequestThreadResult = Schema.Struct({
  replied: Schema.Literal(true),
});
export type GitReplyToChangeRequestThreadResult = typeof GitReplyToChangeRequestThreadResult.Type;

export const GitSetChangeRequestThreadResolvedResult = Schema.Struct({
  resolved: Schema.Boolean,
});
export type GitSetChangeRequestThreadResolvedResult =
  typeof GitSetChangeRequestThreadResolvedResult.Type;

export const GitChangeRequestCommit = Schema.Struct({
  oid: GitObjectId,
  messageHeadline: Schema.String,
  authorName: Schema.NullOr(TrimmedNonEmptyStringSchema),
  authorLogin: Schema.NullOr(TrimmedNonEmptyStringSchema),
  authoredAt: Schema.NullOr(IsoDateTime),
  committedAt: Schema.NullOr(IsoDateTime),
});
export type GitChangeRequestCommit = typeof GitChangeRequestCommit.Type;

export const GitListChangeRequestCommitsResult = Schema.Struct({
  supported: Schema.Boolean,
  commits: Schema.Array(GitChangeRequestCommit),
  truncated: Schema.Boolean,
  /** Whether the PR head commit is resolvable in the local object database (after a guarded fetch attempt), i.e. whether the local commit viewer can open these commits. */
  commitsAvailableLocally: Schema.Boolean,
});
export type GitListChangeRequestCommitsResult = typeof GitListChangeRequestCommitsResult.Type;

export const GitRepositoryChangeRequestSummary = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyStringSchema,
  url: Schema.String,
  baseRefName: TrimmedNonEmptyStringSchema,
  headRefName: TrimmedNonEmptyStringSchema,
  state: Schema.Literals(["open", "closed", "merged"]),
  /** Whether the provider has confirmed that the source and target refs conflict. Omitted when unknown. */
  hasConflicts: Schema.optional(Schema.Boolean),
});
export type GitRepositoryChangeRequestSummary = typeof GitRepositoryChangeRequestSummary.Type;

export const GitListRepositoryChangeRequestsResult = Schema.Struct({
  supported: Schema.Boolean,
  changeRequests: Schema.Array(GitRepositoryChangeRequestSummary),
  truncated: Schema.Boolean,
});
export type GitListRepositoryChangeRequestsResult =
  typeof GitListRepositoryChangeRequestsResult.Type;

/**
 * Local follow-up state after the remote branch is deleted.
 * - none: nothing local tracks the PR head
 * - branch: a plain local branch exists; `removal` reports what happened to it
 * - worktree: a worktree checks the branch out; client should offer the existing
 *   vcs.deleteWorktree flow (which owns the thread cascade) instead
 * - checked_out: the branch is the current branch of the main checkout; left untouched
 */
export const GitDeleteChangeRequestBranchLocalState = Schema.Union([
  Schema.TaggedStruct("none", {}),
  Schema.TaggedStruct("branch", {
    refName: TrimmedNonEmptyStringSchema,
    removal: Schema.Literals(["not_requested", "removed", "failed"]),
  }),
  Schema.TaggedStruct("worktree", {
    refName: TrimmedNonEmptyStringSchema,
    worktreePath: TrimmedNonEmptyStringSchema,
  }),
  Schema.TaggedStruct("checked_out", {
    refName: TrimmedNonEmptyStringSchema,
  }),
]);
export type GitDeleteChangeRequestBranchLocalState =
  typeof GitDeleteChangeRequestBranchLocalState.Type;

export const GitDeleteChangeRequestBranchResult = Schema.Struct({
  /** The PR head branch name, resolved server-side (never client-supplied). */
  branch: TrimmedNonEmptyStringSchema,
  remote: Schema.Literals(["deleted", "already_missing"]),
  local: GitDeleteChangeRequestBranchLocalState,
});
export type GitDeleteChangeRequestBranchResult = typeof GitDeleteChangeRequestBranchResult.Type;

export const GitGetChangeRequestMergeOptionsResult = Schema.Struct({
  methods: Schema.Array(GitChangeRequestMergeMethod).check(Schema.isMinLength(1)),
  defaultMethod: GitChangeRequestMergeMethod,
  autoMergeSupported: Schema.Boolean,
  /** Current auto-merge state; null when the provider does not report it. */
  autoMergeEnabled: Schema.NullOr(Schema.Boolean),
}).check(
  Schema.makeFilter(
    (input) =>
      input.methods.includes(input.defaultMethod) ||
      "The default merge method must be included in the allowed methods.",
  ),
);
export type GitGetChangeRequestMergeOptionsResult =
  typeof GitGetChangeRequestMergeOptionsResult.Type;

export const GitMergeChangeRequestResult = Schema.Struct({
  merged: Schema.Literal(true),
});
export type GitMergeChangeRequestResult = typeof GitMergeChangeRequestResult.Type;

export const GitSetAutoMergeResult = Schema.Struct({
  enabled: Schema.Boolean,
});
export type GitSetAutoMergeResult = typeof GitSetAutoMergeResult.Type;

export const GitUpdateChangeRequestStateResult = Schema.Struct({
  state: Schema.Literals(["open", "closed"]),
});
export type GitUpdateChangeRequestStateResult = typeof GitUpdateChangeRequestStateResult.Type;

export const GitPreparePullRequestThreadResult = Schema.Struct({
  pullRequest: GitResolvedPullRequest,
  branch: TrimmedNonEmptyStringSchema,
  worktreePath: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
});
export type GitPreparePullRequestThreadResult = typeof GitPreparePullRequestThreadResult.Type;

export const VcsSwitchRefResult = Schema.Struct({
  refName: Schema.NullOr(TrimmedNonEmptyStringSchema),
});
export type VcsSwitchRefResult = typeof VcsSwitchRefResult.Type;

export const GitRunStackedActionResult = Schema.Struct({
  action: GitStackedAction,
  branch: Schema.Struct({
    status: GitBranchStepStatus,
    name: Schema.optional(TrimmedNonEmptyStringSchema),
  }),
  commit: Schema.Struct({
    status: GitCommitStepStatus,
    commitSha: Schema.optional(TrimmedNonEmptyStringSchema),
    subject: Schema.optional(TrimmedNonEmptyStringSchema),
  }),
  push: Schema.Struct({
    status: GitPushStepStatus,
    branch: Schema.optional(TrimmedNonEmptyStringSchema),
    upstreamBranch: Schema.optional(TrimmedNonEmptyStringSchema),
    setUpstream: Schema.optional(Schema.Boolean),
  }),
  pr: Schema.Struct({
    status: GitPrStepStatus,
    url: Schema.optional(Schema.String),
    number: Schema.optional(PositiveInt),
    baseBranch: Schema.optional(TrimmedNonEmptyStringSchema),
    headBranch: Schema.optional(TrimmedNonEmptyStringSchema),
    title: Schema.optional(TrimmedNonEmptyStringSchema),
  }),
  toast: GitRunStackedActionToast,
});
export type GitRunStackedActionResult = typeof GitRunStackedActionResult.Type;

export const VcsPullResult = Schema.Struct({
  status: Schema.Literals(["pulled", "skipped_up_to_date"]),
  refName: TrimmedNonEmptyStringSchema,
  upstreamRef: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
});
export type VcsPullResult = typeof VcsPullResult.Type;

// RPC / domain errors
export class GitCommandError extends Schema.TaggedErrorClass<GitCommandError>()("GitCommandError", {
  operation: Schema.String,
  command: Schema.String,
  cwd: Schema.String,
  argumentCount: Schema.optional(Schema.Number),
  exitCode: Schema.optional(Schema.Number),
  stdoutLength: Schema.optional(Schema.Number),
  stderrLength: Schema.optional(Schema.Number),
  outputLength: Schema.optional(Schema.Number),
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Git command failed in ${this.operation} (${this.cwd}): ${this.detail}`;
  }
}

export class TextGenerationError extends Schema.TaggedErrorClass<TextGenerationError>()(
  "TextGenerationError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Text generation failed in ${this.operation}: ${this.detail}`;
  }
}

export class GitManagerError extends Schema.TaggedErrorClass<GitManagerError>()("GitManagerError", {
  operation: Schema.String,
  cwd: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Git manager failed in ${this.operation}: ${this.detail}`;
  }
}

export class GitPullRequestMaterializationError extends Schema.TaggedErrorClass<GitPullRequestMaterializationError>()(
  "GitPullRequestMaterializationError",
  {
    cwd: TrimmedNonEmptyStringSchema,
    pullRequestNumber: PositiveInt,
    headRepository: Schema.NullOr(TrimmedNonEmptyStringSchema),
    headBranch: TrimmedNonEmptyStringSchema,
    localBranch: TrimmedNonEmptyStringSchema,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to materialize pull request #${this.pullRequestNumber} branch ${this.headBranch} as ${this.localBranch}.`;
  }
}

export const GitManagerServiceError = Schema.Union([
  GitManagerError,
  GitPullRequestMaterializationError,
  GitCommandError,
  SourceControlProviderError,
  TextGenerationError,
]);
export type GitManagerServiceError = typeof GitManagerServiceError.Type;

const GitActionProgressBase = Schema.Struct({
  actionId: TrimmedNonEmptyStringSchema,
  cwd: TrimmedNonEmptyStringSchema,
  action: GitStackedAction,
});

const GitActionStartedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal("action_started"),
  phases: Schema.Array(GitActionProgressPhase),
});
const GitActionPhaseStartedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal("phase_started"),
  phase: GitActionProgressPhase,
  label: TrimmedNonEmptyStringSchema,
});
const GitActionHookStartedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal("hook_started"),
  hookName: TrimmedNonEmptyStringSchema,
});
const GitActionHookOutputEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal("hook_output"),
  hookName: Schema.NullOr(TrimmedNonEmptyStringSchema),
  stream: GitActionProgressStream,
  text: TrimmedNonEmptyStringSchema,
});
const GitActionHookFinishedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal("hook_finished"),
  hookName: TrimmedNonEmptyStringSchema,
  exitCode: Schema.NullOr(Schema.Int),
  durationMs: Schema.NullOr(NonNegativeInt),
});
const GitActionFinishedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal("action_finished"),
  result: GitRunStackedActionResult,
});
const GitActionFailedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal("action_failed"),
  phase: Schema.NullOr(GitActionProgressPhase),
  message: TrimmedNonEmptyStringSchema,
});

export const GitActionProgressEvent = Schema.Union([
  GitActionStartedEvent,
  GitActionPhaseStartedEvent,
  GitActionHookStartedEvent,
  GitActionHookOutputEvent,
  GitActionHookFinishedEvent,
  GitActionFinishedEvent,
  GitActionFailedEvent,
]);
export type GitActionProgressEvent = typeof GitActionProgressEvent.Type;
