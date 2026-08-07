import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { PositiveInt, TrimmedNonEmptyString, type GitChangeRequestCheck } from "@aqqua/contracts";

export interface NormalizedBitbucketPullRequestRecord {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state: "open" | "closed" | "merged";
  readonly updatedAt: Option.Option<DateTime.Utc>;
  readonly hasConflicts?: boolean;
  readonly isCrossRepository?: boolean;
  readonly headRepositoryNameWithOwner?: string | null;
  readonly headRepositoryOwnerLogin?: string | null;
}

export type BitbucketChecksStatus = "success" | "failure" | "pending" | null;

export const BitbucketCommitStatusListSchema = Schema.Struct({
  values: Schema.Array(
    Schema.Struct({
      state: Schema.String,
      key: Schema.optional(Schema.NullOr(Schema.String)),
      name: Schema.optional(Schema.NullOr(Schema.String)),
      url: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
  next: Schema.optional(TrimmedNonEmptyString),
});

function classifyBitbucketState(state: string): "success" | "failure" | "pending" {
  switch (state.trim().toUpperCase()) {
    case "SUCCESSFUL":
      return "success";
    case "FAILED":
    case "STOPPED":
      return "failure";
    default:
      return "pending";
  }
}

export function normalizeBitbucketChecksStatus(
  input: Schema.Schema.Type<typeof BitbucketCommitStatusListSchema>,
): BitbucketChecksStatus {
  if (input.values.length === 0) {
    return null;
  }
  let pending = false;
  for (const status of input.values) {
    const classified = classifyBitbucketState(status.state);
    if (classified === "failure") return "failure";
    if (classified === "pending") pending = true;
  }
  return pending ? "pending" : "success";
}

export function normalizeBitbucketCheckDetails(
  input: Schema.Schema.Type<typeof BitbucketCommitStatusListSchema>,
): ReadonlyArray<GitChangeRequestCheck> {
  return input.values.flatMap((status) => {
    const name = status.name?.trim() || status.key?.trim();
    if (!name) return [];
    const normalizedStatus = classifyBitbucketState(status.state);
    const detailsUrl = status.url?.trim();
    return [
      {
        name,
        status: normalizedStatus,
        ...(detailsUrl ? { detailsUrl } : {}),
      },
    ];
  });
}

export const BitbucketRepositoryRefSchema = Schema.Struct({
  full_name: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  workspace: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        slug: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
      }),
    ),
  ),
});

export const BitbucketPullRequestBranchSchema = Schema.Struct({
  repository: Schema.optional(Schema.NullOr(BitbucketRepositoryRefSchema)),
  branch: Schema.Struct({
    name: TrimmedNonEmptyString,
    merge_strategies: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
    default_merge_strategy: Schema.optional(TrimmedNonEmptyString),
  }),
});

export const BitbucketPullRequestSchema = Schema.Struct({
  id: PositiveInt,
  title: TrimmedNonEmptyString,
  state: Schema.optional(Schema.NullOr(Schema.String)),
  updated_on: Schema.optional(Schema.OptionFromNullOr(Schema.DateTimeUtcFromString)),
  links: Schema.Struct({
    html: Schema.Struct({
      href: TrimmedNonEmptyString,
    }),
  }),
  source: BitbucketPullRequestBranchSchema,
  destination: BitbucketPullRequestBranchSchema,
});

export const BitbucketPullRequestListSchema = Schema.Struct({
  values: Schema.Array(BitbucketPullRequestSchema),
  next: Schema.optional(TrimmedNonEmptyString),
});

function trimOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function repositoryOwner(repository: Schema.Schema.Type<typeof BitbucketRepositoryRefSchema>) {
  return (
    trimOptionalString(repository.workspace?.slug) ??
    (repository.full_name?.includes("/") ? (repository.full_name.split("/")[0] ?? null) : null)
  );
}

function normalizeBitbucketPullRequestState(state: string | null | undefined) {
  switch (state?.trim().toUpperCase()) {
    case "MERGED":
      return "merged" as const;
    case "DECLINED":
    case "SUPERSEDED":
      return "closed" as const;
    case "OPEN":
    default:
      return "open" as const;
  }
}

export function normalizeBitbucketPullRequestRecord(
  raw: Schema.Schema.Type<typeof BitbucketPullRequestSchema>,
): NormalizedBitbucketPullRequestRecord {
  const headRepositoryNameWithOwner = trimOptionalString(raw.source.repository?.full_name);
  const baseRepositoryNameWithOwner = trimOptionalString(raw.destination.repository?.full_name);
  const headRepositoryOwnerLogin = raw.source.repository
    ? repositoryOwner(raw.source.repository)
    : null;
  const isCrossRepository =
    headRepositoryNameWithOwner !== null &&
    baseRepositoryNameWithOwner !== null &&
    headRepositoryNameWithOwner !== baseRepositoryNameWithOwner;

  return {
    number: raw.id,
    title: raw.title,
    url: raw.links.html.href,
    baseRefName: raw.destination.branch.name,
    headRefName: raw.source.branch.name,
    state: normalizeBitbucketPullRequestState(raw.state),
    updatedAt: raw.updated_on ?? Option.none(),
    ...(isCrossRepository ? { isCrossRepository: true } : {}),
    ...(headRepositoryNameWithOwner ? { headRepositoryNameWithOwner } : {}),
    ...(headRepositoryOwnerLogin ? { headRepositoryOwnerLogin } : {}),
  };
}
