import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import type {
  ChangeRequestActor,
  ChangeRequestComment,
  ChangeRequestDescription,
  ChangeRequestReviewThread,
  GitChangeRequestCommit,
} from "@aqqua/contracts";
import { decodeJsonResult } from "@aqqua/shared/schemaJson";

const MAX_COMMENTS = 100;
const MAX_COMMITS = 250;

export interface GitHubPullRequestConversation {
  readonly number: number;
  readonly state: "open" | "closed" | "merged";
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

export interface GitHubPullRequestCommits {
  readonly number: number;
  readonly headOid: string | null;
  readonly commits: ReadonlyArray<GitChangeRequestCommit>;
  readonly truncated: boolean;
}

export type GitHubPullRequestConversationOverview = Omit<
  GitHubPullRequestConversation,
  "reviewThreads" | "reviewThreadsTruncated"
>;

export interface GitHubPullRequestReviewThreads {
  readonly reviewThreads: ReadonlyArray<ChangeRequestReviewThread>;
  readonly reviewThreadsTruncated: boolean;
}

const RawActorSchema = Schema.Struct({
  login: Schema.optional(Schema.NullOr(Schema.String)),
});

const RawCommentSchema = Schema.Struct({
  id: Schema.String,
  author: Schema.optional(Schema.NullOr(RawActorSchema)),
  body: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.optional(Schema.NullOr(Schema.String)),
});

const RawOverviewSchema = Schema.Struct({
  number: Schema.Number,
  state: Schema.optional(Schema.NullOr(Schema.String)),
  mergedAt: Schema.optional(Schema.NullOr(Schema.String)),
  headRefName: Schema.String,
  isCrossRepository: Schema.optional(Schema.NullOr(Schema.Boolean)),
  additions: Schema.optional(Schema.NullOr(Schema.Number)),
  deletions: Schema.optional(Schema.NullOr(Schema.Number)),
  body: Schema.optional(Schema.NullOr(Schema.String)),
  author: Schema.optional(Schema.NullOr(RawActorSchema)),
  createdAt: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.optional(Schema.NullOr(Schema.String)),
  comments: Schema.optional(Schema.NullOr(Schema.Array(Schema.Unknown))),
  reviewRequests: Schema.optional(Schema.NullOr(Schema.Array(Schema.Unknown))),
});

const RawReviewerSchema = Schema.Struct({
  login: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.optional(Schema.NullOr(Schema.String)),
  slug: Schema.optional(Schema.NullOr(Schema.String)),
});

const RawThreadSchema = Schema.Struct({
  id: Schema.String,
  isResolved: Schema.optional(Schema.NullOr(Schema.Boolean)),
  isOutdated: Schema.optional(Schema.NullOr(Schema.Boolean)),
  path: Schema.optional(Schema.NullOr(Schema.String)),
  line: Schema.optional(Schema.NullOr(Schema.Number)),
  startLine: Schema.optional(Schema.NullOr(Schema.Number)),
  diffSide: Schema.optional(Schema.NullOr(Schema.String)),
  comments: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        totalCount: Schema.optional(Schema.NullOr(Schema.Number)),
        nodes: Schema.optional(Schema.NullOr(Schema.Array(Schema.Unknown))),
      }),
    ),
  ),
});

const RawReviewThreadsEnvelopeSchema = Schema.Struct({
  data: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        repository: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              pullRequest: Schema.optional(
                Schema.NullOr(
                  Schema.Struct({
                    reviewThreads: Schema.optional(
                      Schema.NullOr(
                        Schema.Struct({
                          pageInfo: Schema.optional(
                            Schema.NullOr(
                              Schema.Struct({
                                hasNextPage: Schema.optional(Schema.NullOr(Schema.Boolean)),
                              }),
                            ),
                          ),
                          nodes: Schema.optional(Schema.NullOr(Schema.Array(Schema.Unknown))),
                        }),
                      ),
                    ),
                  }),
                ),
              ),
            }),
          ),
        ),
      }),
    ),
  ),
});

const RawCommitAuthorSchema = Schema.Struct({
  login: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.optional(Schema.NullOr(Schema.String)),
});

const RawCommitSchema = Schema.Struct({
  oid: Schema.String,
  messageHeadline: Schema.optional(Schema.NullOr(Schema.String)),
  authoredDate: Schema.optional(Schema.NullOr(Schema.String)),
  committedDate: Schema.optional(Schema.NullOr(Schema.String)),
  authors: Schema.optional(Schema.NullOr(Schema.Array(Schema.Unknown))),
});

const RawCommitsEnvelopeSchema = Schema.Struct({
  number: Schema.Number,
  commits: Schema.optional(Schema.NullOr(Schema.Array(Schema.Unknown))),
});

const decodeOverview = decodeJsonResult(RawOverviewSchema);
const decodeReviewThreadsEnvelope = decodeJsonResult(RawReviewThreadsEnvelopeSchema);
const decodeCommitsEnvelope = decodeJsonResult(RawCommitsEnvelopeSchema);
const decodeCommentEntry = Schema.decodeUnknownExit(RawCommentSchema);
const decodeReviewerEntry = Schema.decodeUnknownExit(RawReviewerSchema);
const decodeThreadEntry = Schema.decodeUnknownExit(RawThreadSchema);
const decodeCommitEntry = Schema.decodeUnknownExit(RawCommitSchema);
const decodeCommitAuthorEntry = Schema.decodeUnknownExit(RawCommitAuthorSchema);

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeActor(
  actor: Schema.Schema.Type<typeof RawActorSchema> | null | undefined,
): ChangeRequestActor | null {
  const login = trimToNull(actor?.login);
  return login === null ? null : { login };
}

function normalizeComment(entry: unknown): ChangeRequestComment | null {
  const decoded = decodeCommentEntry(entry);
  if (Exit.isFailure(decoded)) return null;
  const id = trimToNull(decoded.value.id);
  if (id === null) return null;
  return {
    id,
    author: normalizeActor(decoded.value.author),
    body: decoded.value.body ?? "",
    createdAt: trimToNull(decoded.value.createdAt),
    url: decoded.value.url ?? "",
  };
}

function normalizeComments(entries: ReadonlyArray<unknown>): ReadonlyArray<ChangeRequestComment> {
  return entries.flatMap((entry) => {
    const comment = normalizeComment(entry);
    return comment === null ? [] : [comment];
  });
}

function normalizeState(input: {
  readonly state?: string | null | undefined;
  readonly mergedAt?: string | null | undefined;
}): "open" | "closed" | "merged" {
  const state = input.state?.trim().toUpperCase();
  if (trimToNull(input.mergedAt) !== null || state === "MERGED") return "merged";
  return state === "CLOSED" ? "closed" : "open";
}

export function decodeGitHubConversationOverviewJson(
  raw: string,
): Result.Result<GitHubPullRequestConversationOverview, Cause.Cause<Schema.SchemaError>> {
  const decoded = decodeOverview(raw);
  if (!Result.isSuccess(decoded)) return Result.fail(decoded.failure);

  const rawComments = decoded.success.comments ?? [];
  const comments = normalizeComments(rawComments.slice(-MAX_COMMENTS));
  const reviewers = (decoded.success.reviewRequests ?? []).flatMap((entry) => {
    const reviewer = decodeReviewerEntry(entry);
    if (Exit.isFailure(reviewer)) return [];
    const name =
      trimToNull(reviewer.value.login) ??
      trimToNull(reviewer.value.slug) ??
      trimToNull(reviewer.value.name);
    return name === null ? [] : [name];
  });

  return Result.succeed({
    number: decoded.success.number,
    state: normalizeState(decoded.success),
    headRefName: decoded.success.headRefName.trim(),
    isCrossRepository: decoded.success.isCrossRepository ?? false,
    additions: decoded.success.additions ?? null,
    deletions: decoded.success.deletions ?? null,
    reviewers,
    description: {
      author: normalizeActor(decoded.success.author),
      body: decoded.success.body ?? "",
      createdAt: trimToNull(decoded.success.createdAt),
      url: decoded.success.url ?? "",
    },
    comments,
    commentsTruncated: rawComments.length > MAX_COMMENTS,
  });
}

export function decodeGitHubReviewThreadsJson(
  raw: string,
): Result.Result<GitHubPullRequestReviewThreads, Cause.Cause<Schema.SchemaError>> {
  const decoded = decodeReviewThreadsEnvelope(raw);
  if (!Result.isSuccess(decoded)) return Result.fail(decoded.failure);

  const rawThreads = decoded.success.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
  const reviewThreads = rawThreads.flatMap((entry) => {
    const thread = decodeThreadEntry(entry);
    if (Exit.isFailure(thread)) return [];
    const id = trimToNull(thread.value.id);
    if (id === null) return [];
    const rawComments = thread.value.comments?.nodes ?? [];
    const comments = normalizeComments(rawComments);
    const diffSide = thread.value.diffSide?.trim().toUpperCase();
    const normalized: ChangeRequestReviewThread = {
      id,
      isResolved: thread.value.isResolved ?? false,
      isOutdated: thread.value.isOutdated ?? false,
      path: trimToNull(thread.value.path),
      line: thread.value.line ?? null,
      startLine: thread.value.startLine ?? null,
      comments,
      commentsTruncated:
        (thread.value.comments?.totalCount ?? rawComments.length) > rawComments.length,
      ...(diffSide === "LEFT" || diffSide === "RIGHT" ? { diffSide } : {}),
    };
    return [normalized];
  });

  return Result.succeed({
    reviewThreads,
    reviewThreadsTruncated:
      decoded.success.data?.repository?.pullRequest?.reviewThreads?.pageInfo?.hasNextPage ?? false,
  });
}

export function decodeGitHubPullRequestCommitsJson(
  raw: string,
): Result.Result<GitHubPullRequestCommits, Cause.Cause<Schema.SchemaError>> {
  const decoded = decodeCommitsEnvelope(raw);
  if (!Result.isSuccess(decoded)) return Result.fail(decoded.failure);

  const normalizeCommit = (entry: unknown): GitChangeRequestCommit | null => {
    const commit = decodeCommitEntry(entry);
    if (Exit.isFailure(commit)) return null;
    const oid = trimToNull(commit.value.oid);
    if (oid === null) return null;
    const firstAuthor = commit.value.authors?.[0];
    const author = firstAuthor === undefined ? undefined : decodeCommitAuthorEntry(firstAuthor);
    const authorValue = author !== undefined && Exit.isSuccess(author) ? author.value : undefined;
    return {
      oid,
      messageHeadline: commit.value.messageHeadline ?? "",
      authorName: trimToNull(authorValue?.name),
      authorLogin: trimToNull(authorValue?.login),
      authoredAt: trimToNull(commit.value.authoredDate),
      committedAt: trimToNull(commit.value.committedDate),
    };
  };
  const rawCommits = decoded.success.commits ?? [];
  let headOid: string | null = null;
  const commits: GitChangeRequestCommit[] = [];
  rawCommits.forEach((entry, index) => {
    const commit = normalizeCommit(entry);
    if (commit === null) return;
    headOid = commit.oid;
    if (index < MAX_COMMITS) commits.push(commit);
  });

  return Result.succeed({
    number: decoded.success.number,
    headOid,
    commits,
    truncated: rawCommits.length > MAX_COMMITS,
  });
}
