import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { PositiveInt, TrimmedNonEmptyString, type GitChangeRequestCheck } from "@aqqua/contracts";
import { decodeJsonResult, formatSchemaError } from "@aqqua/shared/schemaJson";

export interface NormalizedGitHubPullRequestRecord {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state: "open" | "closed" | "merged";
  readonly updatedAt: Option.Option<DateTime.Utc>;
  readonly isCrossRepository?: boolean;
  readonly headRepositoryNameWithOwner?: string | null;
  readonly headRepositoryOwnerLogin?: string | null;
}

export type GitHubChecksStatus = "success" | "failure" | "pending" | null;

const GitHubPullRequestSchema = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  baseRefName: TrimmedNonEmptyString,
  headRefName: TrimmedNonEmptyString,
  state: Schema.optional(Schema.NullOr(Schema.String)),
  mergedAt: Schema.optional(Schema.NullOr(Schema.String)),
  updatedAt: Schema.optional(Schema.OptionFromNullOr(Schema.DateTimeUtcFromString)),
  isCrossRepository: Schema.optional(Schema.Boolean),
  // gh < 2.47 exports headRepository as {id, name} only; nameWithOwner was
  // added later. Both fields stay optional so a version-drifted gh CLI can
  // never fail the decode and silently drop the PR from the list.
  headRepository: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        nameWithOwner: Schema.optional(Schema.NullOr(Schema.String)),
        name: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
  headRepositoryOwner: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        login: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
});

function trimOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeGitHubPullRequestState(input: {
  state?: string | null | undefined;
  mergedAt?: string | null | undefined;
}): "open" | "closed" | "merged" {
  const normalizedState = input.state?.trim().toUpperCase();
  if (
    (typeof input.mergedAt === "string" && input.mergedAt.trim().length > 0) ||
    normalizedState === "MERGED"
  ) {
    return "merged";
  }
  if (normalizedState === "CLOSED") {
    return "closed";
  }
  return "open";
}

function normalizeGitHubPullRequestRecord(
  raw: Schema.Schema.Type<typeof GitHubPullRequestSchema>,
): NormalizedGitHubPullRequestRecord {
  const explicitNameWithOwner = trimOptionalString(raw.headRepository?.nameWithOwner);
  const headRepositoryName = trimOptionalString(raw.headRepository?.name);
  const headRepositoryOwnerLogin =
    trimOptionalString(raw.headRepositoryOwner?.login) ??
    (explicitNameWithOwner?.includes("/") ? (explicitNameWithOwner.split("/")[0] ?? null) : null);
  const headRepositoryNameWithOwner =
    explicitNameWithOwner ??
    (headRepositoryOwnerLogin && headRepositoryName
      ? `${headRepositoryOwnerLogin}/${headRepositoryName}`
      : null);

  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    baseRefName: raw.baseRefName,
    headRefName: raw.headRefName,
    state: normalizeGitHubPullRequestState(raw),
    updatedAt: raw.updatedAt ?? Option.none(),
    ...(typeof raw.isCrossRepository === "boolean"
      ? { isCrossRepository: raw.isCrossRepository }
      : {}),
    ...(headRepositoryNameWithOwner ? { headRepositoryNameWithOwner } : {}),
    ...(headRepositoryOwnerLogin ? { headRepositoryOwnerLogin } : {}),
  };
}

const decodeGitHubPullRequestList = decodeJsonResult(Schema.Array(Schema.Unknown));
const decodeGitHubPullRequest = decodeJsonResult(GitHubPullRequestSchema);
const decodeGitHubPullRequestEntry = Schema.decodeUnknownExit(GitHubPullRequestSchema);

const GitHubStatusCheckRollupSchema = Schema.Struct({
  statusCheckRollup: Schema.Array(
    Schema.Struct({
      status: Schema.optional(Schema.NullOr(Schema.String)),
      conclusion: Schema.optional(Schema.NullOr(Schema.String)),
      state: Schema.optional(Schema.NullOr(Schema.String)),
      name: Schema.optional(Schema.NullOr(Schema.String)),
      context: Schema.optional(Schema.NullOr(Schema.String)),
      detailsUrl: Schema.optional(Schema.NullOr(Schema.String)),
      targetUrl: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
});
const decodeGitHubStatusCheckRollup = decodeJsonResult(GitHubStatusCheckRollupSchema);

export const formatGitHubJsonDecodeError = formatSchemaError;

export function decodeGitHubPullRequestListJson(
  raw: string,
): Result.Result<
  ReadonlyArray<NormalizedGitHubPullRequestRecord>,
  Cause.Cause<Schema.SchemaError>
> {
  const result = decodeGitHubPullRequestList(raw);
  if (Result.isSuccess(result)) {
    const pullRequests: NormalizedGitHubPullRequestRecord[] = [];
    for (const entry of result.success) {
      const decodedEntry = decodeGitHubPullRequestEntry(entry);
      if (Exit.isFailure(decodedEntry)) {
        continue;
      }
      pullRequests.push(normalizeGitHubPullRequestRecord(decodedEntry.value));
    }
    return Result.succeed(pullRequests);
  }
  return Result.fail(result.failure);
}

export function decodeGitHubPullRequestJson(
  raw: string,
): Result.Result<NormalizedGitHubPullRequestRecord, Cause.Cause<Schema.SchemaError>> {
  const result = decodeGitHubPullRequest(raw);
  if (Result.isSuccess(result)) {
    return Result.succeed(normalizeGitHubPullRequestRecord(result.success));
  }
  return Result.fail(result.failure);
}

const FAILURE_CONCLUSIONS = new Set([
  "FAILURE",
  "CANCELLED",
  "TIMED_OUT",
  "ACTION_REQUIRED",
  "STALE",
  "STARTUP_FAILURE",
]);

function isFailedCheck(state: string | undefined, conclusion: string | undefined): boolean {
  return state === "FAILURE" || state === "ERROR" || FAILURE_CONCLUSIONS.has(conclusion ?? "");
}

export function decodeGitHubChecksStatusJson(
  raw: string,
): Result.Result<GitHubChecksStatus, Cause.Cause<Schema.SchemaError>> {
  const result = decodeGitHubStatusCheckRollup(raw);
  if (!Result.isSuccess(result)) {
    return Result.fail(result.failure);
  }
  if (result.success.statusCheckRollup.length === 0) {
    return Result.succeed(null);
  }

  let pending = false;
  for (const check of result.success.statusCheckRollup) {
    const status = check.status?.trim().toUpperCase();
    const conclusion = check.conclusion?.trim().toUpperCase();
    const state = check.state?.trim().toUpperCase();
    if (isFailedCheck(state, conclusion)) {
      return Result.succeed("failure");
    }
    if (state !== undefined) {
      if (state !== "SUCCESS") {
        pending = true;
      }
      continue;
    }
    if (
      (status !== undefined && status !== "COMPLETED") ||
      conclusion === null ||
      conclusion === undefined ||
      conclusion === ""
    ) {
      pending = true;
    }
  }

  return Result.succeed(pending ? "pending" : "success");
}

function normalizeGitHubCheckStatus(check: {
  readonly status?: string | null | undefined;
  readonly conclusion?: string | null | undefined;
  readonly state?: string | null | undefined;
}): GitChangeRequestCheck["status"] {
  const status = check.status?.trim().toUpperCase();
  const conclusion = check.conclusion?.trim().toUpperCase();
  const state = check.state?.trim().toUpperCase();
  if (state === "SUCCESS" || conclusion === "SUCCESS") return "success";
  if (conclusion === "SKIPPED") return "skipped";
  if (conclusion === "NEUTRAL") return "neutral";
  if (isFailedCheck(state, conclusion)) {
    return "failure";
  }
  return status === "COMPLETED" && conclusion ? "neutral" : "pending";
}

export function decodeGitHubCheckDetailsJson(
  raw: string,
): Result.Result<ReadonlyArray<GitChangeRequestCheck>, Cause.Cause<Schema.SchemaError>> {
  const result = decodeGitHubStatusCheckRollup(raw);
  if (!Result.isSuccess(result)) return Result.fail(result.failure);

  return Result.succeed(
    result.success.statusCheckRollup.flatMap((check) => {
      const name = check.name?.trim() || check.context?.trim();
      if (!name) return [];
      const detailsUrl = check.detailsUrl?.trim() || check.targetUrl?.trim();
      return [
        {
          name,
          status: normalizeGitHubCheckStatus(check),
          ...(detailsUrl ? { detailsUrl } : {}),
        },
      ];
    }),
  );
}
