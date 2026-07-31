import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  GitCommandError,
  GitObjectId,
  NonNegativeInt,
  type GitHistoryCommitSummary,
  type GitHistoryFileChange,
  type GitHistoryFileChangeKind,
  type GitHistoryRef,
  type GitObjectId as GitObjectIdType,
  type VcsGetCommitFileDiffInput,
  type VcsGetCommitFileDiffResult,
  type VcsGetCommitDetailsInput,
  type VcsGetCommitDetailsResult,
  type VcsListHistoryCursor,
  type VcsListHistoryInput,
  type VcsListHistoryResult,
} from "@t3tools/contracts";

import { base64UrlDecodeUtf8, base64UrlEncode } from "../auth/utils.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

const DEFAULT_HISTORY_LIMIT = 100;
const HISTORY_TIMEOUT_MS = 10_000;
const HISTORY_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const HISTORY_REFS_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const HISTORY_BODY_MAX_OUTPUT_BYTES = 256 * 1024;
const HISTORY_FILES_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const HISTORY_DIFF_MAX_OUTPUT_BYTES = 120 * 1024;
const HISTORY_CURSOR_VERSION = 1;
const GIT_OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const GIT_ENV = Object.freeze({
  GIT_PAGER: "cat",
  LC_ALL: "C",
} satisfies NodeJS.ProcessEnv);

/**
 * Opaque cursor payload for stable history pagination.
 *
 * - `tips`: sorted unique commit object ids of HEAD and the matching
 *   `origin/<current-branch>` tip from the first page. Continuations always
 *   walk that fixed tip set so later ref advances cannot insert or drop
 *   commits mid-pagination.
 * - `skip`: deterministic topo-order offset within that frozen walk.
 */
const HistoryCursorPayload = Schema.Struct({
  v: Schema.Literal(HISTORY_CURSOR_VERSION),
  tips: Schema.Array(GitObjectId).check(Schema.isMinLength(1)),
  skip: NonNegativeInt,
});
type HistoryCursorPayload = typeof HistoryCursorPayload.Type;

const HistoryCursorPayloadJson = Schema.fromJsonString(HistoryCursorPayload);
const encodeHistoryCursorPayloadJson = Schema.encodeSync(HistoryCursorPayloadJson);
const decodeHistoryCursorPayloadJson = Schema.decodeUnknownOption(HistoryCursorPayloadJson);

export class GitHistory extends Context.Service<
  GitHistory,
  {
    readonly list: (
      input: VcsListHistoryInput,
    ) => Effect.Effect<VcsListHistoryResult, GitCommandError>;
    readonly getDetails: (
      input: VcsGetCommitDetailsInput,
    ) => Effect.Effect<VcsGetCommitDetailsResult, GitCommandError>;
    readonly getFileDiff: (
      input: VcsGetCommitFileDiffInput,
    ) => Effect.Effect<VcsGetCommitFileDiffResult, GitCommandError>;
  }
>()("t3/git/GitHistory") {}

function historyError(
  operation: string,
  cwd: string,
  detail: string,
  cause?: unknown,
): GitCommandError {
  return new GitCommandError({
    operation,
    command: "git",
    cwd,
    detail,
    ...(cause === undefined ? {} : { cause }),
  });
}

function parseObjectId(value: string): GitObjectIdType | null {
  return GIT_OBJECT_ID_PATTERN.test(value) ? (value as GitObjectIdType) : null;
}

function encodeHistoryCursor(payload: {
  readonly tips: ReadonlyArray<GitObjectIdType>;
  readonly skip: number;
}): VcsListHistoryCursor {
  return base64UrlEncode(
    encodeHistoryCursorPayloadJson({
      v: HISTORY_CURSOR_VERSION,
      tips: payload.tips,
      skip: payload.skip,
    }),
  ) as VcsListHistoryCursor;
}

function decodeHistoryCursor(
  cursor: string,
  cwd: string,
): Effect.Effect<HistoryCursorPayload, GitCommandError> {
  try {
    const decoded = decodeHistoryCursorPayloadJson(base64UrlDecodeUtf8(cursor));
    if (Option.isNone(decoded)) {
      return Effect.fail(
        historyError("GitHistory.list.cursor", cwd, "Git history cursor is invalid."),
      );
    }
    return Effect.succeed(decoded.value);
  } catch (cause) {
    return Effect.fail(
      historyError("GitHistory.list.cursor", cwd, "Git history cursor is invalid.", cause),
    );
  }
}

function currentHistoryBranchNames(
  currentRef: string | null,
): { readonly local: string; readonly origin: string } | null {
  if (!currentRef?.startsWith("refs/heads/")) return null;
  const local = currentRef.slice("refs/heads/".length);
  return { local, origin: `origin/${local}` };
}

function collectHistoryTips(
  headId: GitObjectIdType | null,
  refsByCommit: ReadonlyMap<GitObjectIdType, ReadonlyArray<GitHistoryRef>>,
  currentRef: string | null,
): GitObjectIdType[] {
  const tips = new Set<GitObjectIdType>();
  if (headId) tips.add(headId);

  const branchNames = currentHistoryBranchNames(currentRef);
  if (branchNames) {
    for (const [objectId, refs] of refsByCommit) {
      if (refs.some((ref) => ref.kind === "remote_branch" && ref.name === branchNames.origin)) {
        tips.add(objectId);
      }
    }
  }

  return [...tips].sort((left, right) => left.localeCompare(right));
}

function isVisibleHistoryRef(ref: GitHistoryRef, currentRef: string | null): boolean {
  if (ref.kind === "tag") return true;
  const branchNames = currentHistoryBranchNames(currentRef);
  if (!branchNames) return false;
  return ref.kind === "local_branch"
    ? ref.name === branchNames.local
    : ref.name === branchNames.origin;
}

function parseCommitLog(
  stdout: string,
  cwd: string,
): Effect.Effect<ReadonlyArray<Omit<GitHistoryCommitSummary, "refs" | "isHead">>, GitCommandError> {
  const fields = stdout.split("\0");
  if (fields.at(-1) === "") {
    fields.pop();
  }
  if (fields.length === 0) {
    return Effect.succeed([]);
  }
  if (fields.length % 7 !== 0) {
    return Effect.fail(
      historyError("GitHistory.list.parseLog", cwd, "Git history output was incomplete."),
    );
  }

  const commits: Array<Omit<GitHistoryCommitSummary, "refs" | "isHead">> = [];
  for (let index = 0; index < fields.length; index += 7) {
    const id = parseObjectId(fields[index] ?? "");
    const parentValues = (fields[index + 1] ?? "").split(" ").filter(Boolean);
    const parentIds = parentValues.map(parseObjectId);
    if (!id || parentIds.some((parentId) => parentId === null)) {
      return Effect.fail(
        historyError(
          "GitHistory.list.parseLog",
          cwd,
          "Git history contained an invalid object id.",
        ),
      );
    }
    commits.push({
      id,
      parentIds: parentIds as GitObjectIdType[],
      authorName: fields[index + 2] ?? "",
      authorEmail: fields[index + 3] ?? "",
      authoredAt: fields[index + 4] ?? "",
      committedAt: fields[index + 5] ?? "",
      subject: fields[index + 6] ?? "",
    });
  }
  return Effect.succeed(commits);
}

function refKind(fullName: string): GitHistoryRef["kind"] | null {
  if (fullName.startsWith("refs/heads/")) return "local_branch";
  if (fullName.startsWith("refs/remotes/")) return "remote_branch";
  if (fullName.startsWith("refs/tags/")) return "tag";
  return null;
}

function shortRefName(fullName: string, kind: GitHistoryRef["kind"]): string {
  switch (kind) {
    case "local_branch":
      return fullName.slice("refs/heads/".length);
    case "remote_branch":
      return fullName.slice("refs/remotes/".length);
    case "tag":
      return fullName.slice("refs/tags/".length);
  }
}

function parseRefs(
  stdout: string,
  currentRef: string | null,
  truncated: boolean,
): ReadonlyMap<GitObjectIdType, ReadonlyArray<GitHistoryRef>> {
  const fields = stdout.split("\0");
  if (truncated && !stdout.endsWith("\0")) fields.pop();
  const refsByCommit = new Map<GitObjectIdType, GitHistoryRef[]>();

  for (let index = 0; index + 6 < fields.length; index += 6) {
    const fullName = (fields[index] ?? "").replace(/^\r?\n/, "");
    const objectId = fields[index + 1] ?? "";
    const objectType = fields[index + 2] ?? "";
    const peeledObjectId = fields[index + 3] ?? "";
    const peeledObjectType = fields[index + 4] ?? "";
    const symbolicRef = fields[index + 5] ?? "";
    const kind = refKind(fullName);
    if (!kind || symbolicRef.length > 0) continue;

    const targetId =
      peeledObjectType === "commit"
        ? parseObjectId(peeledObjectId)
        : objectType === "commit"
          ? parseObjectId(objectId)
          : null;
    if (!targetId) continue;

    const current = refsByCommit.get(targetId) ?? [];
    current.push({
      name: shortRefName(fullName, kind),
      kind,
      current: fullName === currentRef,
    });
    refsByCommit.set(targetId, current);
  }

  for (const refs of refsByCommit.values()) {
    refs.sort(
      (left, right) =>
        Number(right.current) - Number(left.current) ||
        left.kind.localeCompare(right.kind) ||
        left.name.localeCompare(right.name),
    );
  }
  return refsByCommit;
}

function statusKind(status: string): GitHistoryFileChangeKind {
  switch (status[0]) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "type_changed";
    case "U":
      return "unmerged";
    default:
      return "unknown";
  }
}

interface ParsedFileStatus {
  readonly path: string;
  readonly previousPath: string | null;
  readonly kind: GitHistoryFileChangeKind;
}

function parseNameStatus(stdout: string, truncated: boolean): ParsedFileStatus[] | null {
  const fields = stdout.split("\0");
  if (truncated && !stdout.endsWith("\0")) fields.pop();
  if (fields.at(-1) === "") fields.pop();
  const files: ParsedFileStatus[] = [];

  for (let index = 0; index < fields.length; ) {
    const status = fields[index++] ?? "";
    const kind = statusKind(status);
    if (kind === "renamed" || kind === "copied") {
      const previousPath = fields[index++];
      const path = fields[index++];
      if (!previousPath || !path) return truncated ? files : null;
      files.push({ path, previousPath, kind });
      continue;
    }
    const path = fields[index++];
    if (!path) return truncated ? files : null;
    files.push({ path, previousPath: null, kind });
  }
  return files;
}

interface ParsedNumstat {
  readonly path: string;
  readonly previousPath: string | null;
  readonly insertions: number | null;
  readonly deletions: number | null;
  readonly binary: boolean;
}

function parseCount(value: string): number | null | undefined {
  if (value === "-") return null;
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseNumstat(stdout: string, truncated: boolean): ParsedNumstat[] | null {
  const records = stdout.split("\0");
  if (truncated && !stdout.endsWith("\0")) records.pop();
  if (records.at(-1) === "") records.pop();
  const files: ParsedNumstat[] = [];

  for (let index = 0; index < records.length; ) {
    const header = records[index++] ?? "";
    const [insertionsRaw = "", deletionsRaw = "", path = ""] = header.split("\t");
    const insertions = parseCount(insertionsRaw);
    const deletions = parseCount(deletionsRaw);
    if (insertions === undefined || deletions === undefined) return null;
    const binary = insertionsRaw === "-" || deletionsRaw === "-";
    if (path.length > 0) {
      files.push({
        path,
        previousPath: null,
        insertions,
        deletions,
        binary,
      });
      continue;
    }
    const previousPath = records[index++];
    const renamedPath = records[index++];
    if (!previousPath || !renamedPath) return truncated ? files : null;
    files.push({
      path: renamedPath,
      previousPath,
      insertions,
      deletions,
      binary,
    });
  }
  return files;
}

function fileKey(path: string, previousPath: string | null): string {
  return `${previousPath ?? ""}\0${path}`;
}

function combineFileChanges(
  statuses: ReadonlyArray<ParsedFileStatus>,
  stats: ReadonlyArray<ParsedNumstat>,
): GitHistoryFileChange[] {
  const statsByPath = new Map(stats.map((stat) => [fileKey(stat.path, stat.previousPath), stat]));
  return statuses.map((status) => {
    const stat = statsByPath.get(fileKey(status.path, status.previousPath));
    return {
      ...status,
      insertions: stat?.insertions ?? null,
      deletions: stat?.deletions ?? null,
      binary: stat?.binary ?? false,
    };
  });
}

export const make = Effect.gen(function* () {
  const git = yield* GitVcsDriver.GitVcsDriver;

  const execute = (
    operation: string,
    cwd: string,
    args: ReadonlyArray<string>,
    options?: {
      readonly allowNonZeroExit?: boolean;
      readonly maxOutputBytes?: number;
      readonly truncateOutput?: boolean;
    },
  ) =>
    git.execute({
      operation,
      cwd,
      args: ["--no-pager", ...args],
      env: GIT_ENV,
      timeoutMs: HISTORY_TIMEOUT_MS,
      maxOutputBytes: options?.maxOutputBytes ?? HISTORY_MAX_OUTPUT_BYTES,
      appendTruncationMarker: options?.truncateOutput ?? false,
      ...(options?.allowNonZeroExit === undefined
        ? {}
        : { allowNonZeroExit: options.allowNonZeroExit }),
    });

  const list: GitHistory["Service"]["list"] = Effect.fn("GitHistory.list")(function* (input) {
    const [headResult, currentRefResult, refsResult] = yield* Effect.all(
      [
        execute("GitHistory.list.head", input.cwd, ["rev-parse", "--verify", "--quiet", "HEAD"], {
          allowNonZeroExit: true,
        }),
        execute("GitHistory.list.currentRef", input.cwd, ["symbolic-ref", "--quiet", "HEAD"], {
          allowNonZeroExit: true,
        }),
        execute(
          "GitHistory.list.refs",
          input.cwd,
          [
            "for-each-ref",
            "--format=%(refname)%00%(objectname)%00%(objecttype)%00%(*objectname)%00%(*objecttype)%00%(symref)%00",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
          ],
          {
            maxOutputBytes: HISTORY_REFS_MAX_OUTPUT_BYTES,
            truncateOutput: true,
          },
        ),
      ],
      { concurrency: "unbounded" },
    );
    const headId = headResult.exitCode === 0 ? parseObjectId(headResult.stdout.trim()) : null;
    const currentRef =
      currentRefResult.exitCode === 0 && currentRefResult.stdout.trim().length > 0
        ? currentRefResult.stdout.trim()
        : null;
    const limit = input.limit ?? DEFAULT_HISTORY_LIMIT;
    const refsByCommit = parseRefs(refsResult.stdout, currentRef, refsResult.stdoutTruncated);
    const liveTips = collectHistoryTips(headId, refsByCommit, currentRef);

    let tips: ReadonlyArray<GitObjectIdType>;
    let skip: number;
    if (input.cursor === undefined) {
      tips = liveTips;
      skip = 0;
    } else {
      const decoded = yield* decodeHistoryCursor(input.cursor, input.cwd);
      tips = decoded.tips;
      skip = decoded.skip;
    }

    if (tips.length === 0) {
      // First page with no visible tips (and no HEAD): empty repository history.
      // Continuations never encode empty tips; malformed empty is rejected above.
      return {
        commits: [],
        isRepo: true,
        nextCursor: null,
        referencesTruncated: refsResult.stdoutTruncated,
      };
    }

    const logResult = yield* execute(
      "GitHistory.list.log",
      input.cwd,
      [
        "log",
        "-z",
        "--topo-order",
        `--skip=${skip}`,
        `--max-count=${limit + 1}`,
        // Walk only the tip object ids captured for this pagination sequence.
        // Using live --branches/--remotes/--tags would re-read moving refs and
        // make numeric skips unstable when commits land between page requests.
        "--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%cI%x00%s",
        ...tips,
      ],
      { allowNonZeroExit: true },
    );

    if (logResult.exitCode !== 0) {
      if (input.cursor !== undefined) {
        return yield* historyError(
          "GitHistory.list.cursor",
          input.cwd,
          "Git history cursor is unusable.",
        );
      }
      return yield* historyError("GitHistory.list", input.cwd, "Git history could not be listed.");
    }
    if (logResult.stdoutTruncated) {
      return yield* historyError(
        "GitHistory.list",
        input.cwd,
        "Git history output exceeded the supported size.",
      );
    }

    const parsed = yield* parseCommitLog(logResult.stdout, input.cwd);
    const hasMore = parsed.length > limit;
    const commits = parsed.slice(0, limit).map<GitHistoryCommitSummary>((commit) => ({
      ...commit,
      isHead: commit.id === headId,
      refs: (refsByCommit.get(commit.id) ?? []).filter((ref) =>
        isVisibleHistoryRef(ref, currentRef),
      ),
    }));
    return {
      commits,
      isRepo: true,
      nextCursor: hasMore ? encodeHistoryCursor({ tips, skip: skip + limit }) : null,
      referencesTruncated: refsResult.stdoutTruncated,
    };
  });

  const getDetails: GitHistory["Service"]["getDetails"] = Effect.fn("GitHistory.getDetails")(
    function* (input) {
      const verifyResult = yield* execute(
        "GitHistory.getDetails.verify",
        input.cwd,
        ["cat-file", "-e", `${input.commitId}^{commit}`],
        { allowNonZeroExit: true },
      );
      if (verifyResult.exitCode !== 0) {
        return yield* historyError(
          "GitHistory.getDetails",
          input.cwd,
          "The selected commit could not be resolved.",
        );
      }

      const [metadata, bodyResult] = yield* Effect.all(
        [
          execute("GitHistory.getDetails.metadata", input.cwd, [
            "show",
            "-s",
            "-z",
            "--format=%cn%x00%ce%x00%cI%x00%P",
            input.commitId,
          ]),
          execute(
            "GitHistory.getDetails.body",
            input.cwd,
            ["show", "-s", "--format=%b", input.commitId],
            {
              maxOutputBytes: HISTORY_BODY_MAX_OUTPUT_BYTES,
              truncateOutput: true,
            },
          ),
        ],
        { concurrency: "unbounded" },
      );
      const fields = metadata.stdout.split("\0");
      if (fields.length < 4) {
        return yield* historyError(
          "GitHistory.getDetails.parseMetadata",
          input.cwd,
          "Git commit metadata was incomplete.",
        );
      }
      const parentIds = (fields[3] ?? "").split(" ").filter(Boolean).map(parseObjectId);
      if (parentIds.some((parentId) => parentId === null)) {
        return yield* historyError(
          "GitHistory.getDetails.parseMetadata",
          input.cwd,
          "Git commit metadata contained an invalid parent id.",
        );
      }
      const comparisonParentId = (parentIds[0] ?? null) as GitObjectIdType | null;
      const diffBaseArgs = comparisonParentId
        ? ["diff", "--no-ext-diff", "--find-renames", "--find-copies", "--find-copies-harder"]
        : [
            "diff-tree",
            "--root",
            "--no-commit-id",
            "-r",
            "--find-renames",
            "--find-copies",
            "--find-copies-harder",
          ];
      const diffTargetArgs = comparisonParentId
        ? [comparisonParentId, input.commitId, "--"]
        : [input.commitId, "--"];
      const [nameStatusResult, numstatResult] = yield* Effect.all(
        [
          execute(
            "GitHistory.getDetails.nameStatus",
            input.cwd,
            [...diffBaseArgs, "--name-status", "-z", ...diffTargetArgs],
            {
              maxOutputBytes: HISTORY_FILES_MAX_OUTPUT_BYTES,
              truncateOutput: true,
            },
          ),
          execute(
            "GitHistory.getDetails.numstat",
            input.cwd,
            [...diffBaseArgs, "--numstat", "-z", ...diffTargetArgs],
            {
              maxOutputBytes: HISTORY_FILES_MAX_OUTPUT_BYTES,
              truncateOutput: true,
            },
          ),
        ],
        { concurrency: "unbounded" },
      );
      const statuses = parseNameStatus(nameStatusResult.stdout, nameStatusResult.stdoutTruncated);
      const stats = parseNumstat(numstatResult.stdout, numstatResult.stdoutTruncated);
      if (!statuses || !stats) {
        return yield* historyError(
          "GitHistory.getDetails.parseFiles",
          input.cwd,
          "Git commit file details were incomplete.",
        );
      }
      return {
        commitId: input.commitId,
        committerName: fields[0] ?? "",
        committerEmail: fields[1] ?? "",
        committedAt: fields[2] ?? "",
        body:
          !bodyResult.stdoutTruncated && bodyResult.stdout.endsWith("\n")
            ? bodyResult.stdout.slice(0, -1)
            : bodyResult.stdout,
        bodyTruncated: bodyResult.stdoutTruncated,
        comparisonParentId,
        files: combineFileChanges(statuses, stats),
        filesTruncated: nameStatusResult.stdoutTruncated || numstatResult.stdoutTruncated,
      };
    },
  );

  const getFileDiff: GitHistory["Service"]["getFileDiff"] = Effect.fn("GitHistory.getFileDiff")(
    function* (input) {
      const parentsResult = yield* execute(
        "GitHistory.getFileDiff.parents",
        input.cwd,
        ["show", "-s", "--format=%P", input.commitId],
        { allowNonZeroExit: true },
      );
      if (parentsResult.exitCode !== 0) {
        return yield* historyError(
          "GitHistory.getFileDiff",
          input.cwd,
          "The selected commit could not be resolved.",
        );
      }

      const parentValues = parentsResult.stdout.trim().split(" ").filter(Boolean);
      const parentIds = parentValues.map(parseObjectId);
      if (parentIds.some((parentId) => parentId === null)) {
        return yield* historyError(
          "GitHistory.getFileDiff.parseParents",
          input.cwd,
          "Git commit metadata contained an invalid parent id.",
        );
      }
      const comparisonParentId = (parentIds[0] ?? null) as GitObjectIdType | null;
      const pathspec = [
        ...new Set([input.previousPath, input.path].filter((path) => path !== null)),
      ];
      const patchArgs = comparisonParentId
        ? [
            "--literal-pathspecs",
            "diff",
            "--no-ext-diff",
            "--find-renames",
            "--find-copies",
            "--patch",
            "--no-color",
            "--no-textconv",
            comparisonParentId,
            input.commitId,
            "--",
            ...pathspec,
          ]
        : [
            "--literal-pathspecs",
            "diff-tree",
            "--root",
            "--no-commit-id",
            "-r",
            "--find-renames",
            "--find-copies",
            "--patch",
            "--no-color",
            "--no-textconv",
            input.commitId,
            "--",
            ...pathspec,
          ];
      const patchResult = yield* execute("GitHistory.getFileDiff.patch", input.cwd, patchArgs, {
        maxOutputBytes: HISTORY_DIFF_MAX_OUTPUT_BYTES,
        truncateOutput: true,
      });

      return {
        commitId: input.commitId,
        path: input.path,
        diff: patchResult.stdout,
        truncated: patchResult.stdoutTruncated,
      };
    },
  );

  return GitHistory.of({ list, getDetails, getFileDiff });
});

export const layer = Layer.effect(GitHistory, make);
