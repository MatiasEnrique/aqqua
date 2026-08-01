import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { ChildProcessSpawner } from "effect/unstable/process";

import { GitCommandError, GitObjectId, NonNegativeInt } from "@t3tools/contracts";

import { base64UrlEncode } from "../auth/utils.ts";
import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as GitHistory from "./GitHistory.ts";

const HistoryCursorPayloadJson = Schema.fromJsonString(
  Schema.Struct({
    v: Schema.Literal(1),
    tips: Schema.Array(GitObjectId).check(Schema.isMinLength(1)),
    skip: NonNegativeInt,
    includeOrigin: Schema.Boolean,
  }),
);
const encodeTestHistoryCursor = Schema.encodeSync(HistoryCursorPayloadJson);

const ServerConfigLayer = ServerConfig.ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-git-history-test-",
});
const TestLayer = GitHistory.layer.pipe(
  Layer.provideMerge(GitVcsDriver.layer),
  Layer.provide(ServerConfigLayer),
  Layer.provideMerge(NodeServices.layer),
);

const makeTmpDir = (): Effect.Effect<string, never, FileSystem.FileSystem | Scope.Scope> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-git-history-repo-" });
  }).pipe(Effect.orDie);

const git = (
  cwd: string,
  args: ReadonlyArray<string>,
): Effect.Effect<string, GitCommandError, GitVcsDriver.GitVcsDriver> =>
  Effect.gen(function* () {
    const driver = yield* GitVcsDriver.GitVcsDriver;
    const result = yield* driver.execute({
      operation: "GitHistory.test.git",
      cwd,
      args,
      timeoutMs: 10_000,
    });
    return result.stdout.trim();
  });

const writeFile = (
  cwd: string,
  relativePath: string,
  contents: string,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fileSystem.writeFileString(path.join(cwd, relativePath), contents);
  }).pipe(Effect.orDie);

const writeBytes = (
  cwd: string,
  relativePath: string,
  contents: Uint8Array,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fileSystem.writeFile(path.join(cwd, relativePath), contents);
  }).pipe(Effect.orDie);

const initRepo = Effect.fn("GitHistory.test.initRepo")(function* (cwd: string) {
  yield* git(cwd, ["init", "-b", "main"]);
  yield* git(cwd, ["config", "user.email", "test@example.com"]);
  yield* git(cwd, ["config", "user.name", "Test Author"]);
});

const commitFile = Effect.fn("GitHistory.test.commitFile")(function* (
  cwd: string,
  relativePath: string,
  contents: string,
  subject: string,
  body?: string,
) {
  yield* writeFile(cwd, relativePath, contents);
  yield* git(cwd, ["add", relativePath]);
  yield* git(cwd, ["commit", "-m", subject, ...(body ? ["-m", body] : [])]);
  return yield* git(cwd, ["rev-parse", "HEAD"]);
});

const executeResult = (
  stdout: string,
  options?: { readonly truncated?: boolean; readonly exitCode?: number },
): GitVcsDriver.ExecuteGitResult => ({
  exitCode: ChildProcessSpawner.ExitCode(options?.exitCode ?? 0),
  stdout,
  stderr: "",
  stdoutTruncated: options?.truncated ?? false,
  stderrTruncated: false,
});

it.layer(TestLayer)("GitHistory", (it) => {
  describe("list", () => {
    it.effect("returns an empty history for an unborn repository", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTmpDir();
        yield* initRepo(cwd);

        const history = yield* GitHistory.GitHistory;
        const result = yield* history.list({ cwd });

        assert.deepStrictEqual(result, {
          commits: [],
          isRepo: true,
          nextCursor: null,
          referencesTruncated: false,
        });
      }),
    );

    it.effect("uses 100-commit pages by default", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTmpDir();
        yield* initRepo(cwd);
        for (let index = 0; index < 101; index += 1) {
          yield* git(cwd, ["commit", "--allow-empty", "-m", `Commit ${index}`]);
        }

        const history = yield* GitHistory.GitHistory;
        const firstPage = yield* history.list({ cwd });
        assert.equal(firstPage.commits.length, 100);
        assert.notEqual(firstPage.nextCursor, null);
        assert.equal(typeof firstPage.nextCursor, "string");

        const secondPage = yield* history.list({
          cwd,
          cursor: firstPage.nextCursor ?? undefined,
        });

        assert.equal(secondPage.commits.length, 1);
        assert.equal(secondPage.nextCursor, null);
        assert.notEqual(secondPage.commits[0]?.id, firstPage.commits[0]?.id);
      }),
    );

    it.effect(
      "keeps page-two stable when new commits land after page one (no dupes or omissions)",
      () =>
        Effect.gen(function* () {
          const cwd = yield* makeTmpDir();
          yield* initRepo(cwd);
          const commitIds: string[] = [];
          for (let index = 0; index < 5; index += 1) {
            yield* git(cwd, ["commit", "--allow-empty", "-m", `Commit ${index}`]);
            commitIds.push(yield* git(cwd, ["rev-parse", "HEAD"]));
          }
          // Newest-first topo order from a single linear branch.
          const originalNewestFirst = commitIds.toReversed();

          const history = yield* GitHistory.GitHistory;
          const snapshot = yield* history.list({ cwd, limit: 10 });
          assert.deepStrictEqual(
            snapshot.commits.map((commit) => commit.id),
            originalNewestFirst,
          );

          const pageOne = yield* history.list({ cwd, limit: 2 });
          assert.deepStrictEqual(
            pageOne.commits.map((commit) => commit.id),
            originalNewestFirst.slice(0, 2),
          );
          assert.notEqual(pageOne.nextCursor, null);

          // Insert a ref-visible commit that would shift a numeric offset.
          yield* git(cwd, ["commit", "--allow-empty", "-m", "Inserted after page one"]);
          const inserted = yield* git(cwd, ["rev-parse", "HEAD"]);

          const pageTwo = yield* history.list({
            cwd,
            cursor: pageOne.nextCursor ?? undefined,
            limit: 2,
          });
          assert.deepStrictEqual(
            pageTwo.commits.map((commit) => commit.id),
            originalNewestFirst.slice(2, 4),
          );
          assert.notEqual(pageTwo.nextCursor, null);

          const pageThree = yield* history.list({
            cwd,
            cursor: pageTwo.nextCursor ?? undefined,
            limit: 2,
          });
          assert.deepStrictEqual(
            pageThree.commits.map((commit) => commit.id),
            originalNewestFirst.slice(4),
          );
          assert.equal(pageThree.nextCursor, null);

          const continued = [...pageOne.commits, ...pageTwo.commits, ...pageThree.commits].map(
            (commit) => commit.id,
          );
          assert.deepStrictEqual(continued, originalNewestFirst);
          assert.equal(continued.includes(inserted), false);
          assert.equal(new Set(continued).size, continued.length);

          // A fresh first page sees the inserted tip; the old continuation does not.
          const refreshed = yield* history.list({ cwd, limit: 1 });
          assert.equal(refreshed.commits[0]?.id, inserted);
        }),
    );

    it.effect("rejects malformed and unusable history cursors", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTmpDir();
        yield* initRepo(cwd);
        yield* git(cwd, ["commit", "--allow-empty", "-m", "Only commit"]);

        const history = yield* GitHistory.GitHistory;

        const malformed = yield* Effect.flip(history.list({ cwd, cursor: "not-a-cursor" }));
        assert.equal(malformed._tag, "GitCommandError");
        assert.equal(malformed.operation, "GitHistory.list.cursor");
        assert.equal(malformed.detail, "Git history cursor is invalid.");

        const numeric = yield* Effect.flip(history.list({ cwd, cursor: "100" }));
        assert.equal(numeric._tag, "GitCommandError");
        assert.equal(numeric.detail, "Git history cursor is invalid.");

        const missingTips = base64UrlEncode(
          encodeTestHistoryCursor({
            v: 1,
            tips: ["f".repeat(40)],
            skip: 0,
            includeOrigin: false,
          }),
        );
        const unusable = yield* Effect.flip(history.list({ cwd, cursor: missingTips }));
        assert.equal(unusable._tag, "GitCommandError");
        assert.equal(unusable.operation, "GitHistory.list.cursor");
        assert.equal(unusable.detail, "Git history cursor is unusable.");
      }),
    );

    it.effect("lists the local branch by default and includes matching origin on request", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTmpDir();
        yield* initRepo(cwd);
        const initial = yield* commitFile(cwd, "README.md", "initial\n", "Initial commit");
        const localLatest = yield* commitFile(cwd, "local.txt", "local\n", "Local commit");
        yield* git(cwd, ["tag", "v1.0.0", initial]);
        yield* git(cwd, ["branch", "other-local", initial]);
        yield* git(cwd, ["update-ref", "refs/remotes/origin/other-shared", initial]);

        yield* git(cwd, ["checkout", "-b", "origin-main", initial]);
        const originLatest = yield* commitFile(cwd, "origin.txt", "origin\n", "Origin commit");
        yield* git(cwd, ["update-ref", "refs/remotes/origin/main", originLatest]);
        yield* git(cwd, ["checkout", "main"]);
        yield* git(cwd, ["branch", "-D", "origin-main"]);

        yield* git(cwd, ["checkout", "-b", "unrelated", initial]);
        const unrelated = yield* commitFile(
          cwd,
          "unrelated.txt",
          "unrelated\n",
          "Unrelated branch commit",
        );
        yield* git(cwd, ["update-ref", "refs/remotes/origin/unrelated", unrelated]);
        yield* git(cwd, ["tag", "unrelated-tag", unrelated]);
        yield* git(cwd, ["checkout", "main"]);
        yield* git(cwd, ["branch", "-D", "unrelated"]);

        yield* git(cwd, ["checkout", "--orphan", "checkpoint-only"]);
        yield* git(cwd, ["rm", "-rf", "."]);
        const checkpoint = yield* commitFile(
          cwd,
          "checkpoint.txt",
          "internal\n",
          "Internal checkpoint",
        );
        yield* git(cwd, ["update-ref", "refs/t3/checkpoints/thread-1/turn/1", checkpoint]);
        yield* git(cwd, ["checkout", "main"]);
        yield* git(cwd, ["branch", "-D", "checkpoint-only"]);
        yield* writeFile(cwd, "stash-only.txt", "stash\n");
        yield* git(cwd, ["stash", "push", "-u", "-m", "stash-only"]);
        const stashCommit = yield* git(cwd, ["rev-parse", "refs/stash"]);

        const history = yield* GitHistory.GitHistory;
        const localOnly = yield* history.list({ cwd, limit: 10 });

        assert.deepStrictEqual(
          new Set(localOnly.commits.map((commit) => commit.id)),
          new Set([localLatest, initial]),
        );
        assert.equal(
          localOnly.commits
            .flatMap((commit) => commit.refs)
            .some((ref) => ref.kind === "remote_branch"),
          false,
        );

        const result = yield* history.list({ cwd, includeOrigin: true, limit: 1 });

        assert.equal(result.isRepo, true);
        assert.equal(result.commits.length, 1);
        assert.equal([localLatest, originLatest].includes(result.commits[0]?.id ?? ""), true);
        assert.notEqual(result.nextCursor, null);
        assert.equal(typeof result.nextCursor, "string");

        const mismatchedCursor = yield* Effect.flip(
          history.list({ cwd, cursor: result.nextCursor ?? undefined, limit: 10 }),
        );
        assert.equal(mismatchedCursor.operation, "GitHistory.list.cursor");
        assert.equal(mismatchedCursor.detail, "Git history cursor is unusable.");

        const older = yield* history.list({
          cwd,
          cursor: result.nextCursor ?? undefined,
          includeOrigin: true,
          limit: 10,
        });
        const allCommits = [...result.commits, ...older.commits];
        assert.deepStrictEqual(
          new Set(allCommits.map((commit) => commit.id)),
          new Set([localLatest, originLatest, initial]),
        );
        const localCommit = allCommits.find((commit) => commit.id === localLatest);
        const originCommit = allCommits.find((commit) => commit.id === originLatest);
        const initialCommit = allCommits.find((commit) => commit.id === initial);
        assert.equal(localCommit?.isHead, true);
        assert.equal(
          localCommit?.refs.some(
            (ref) => ref.kind === "local_branch" && ref.name === "main" && ref.current,
          ),
          true,
        );
        assert.equal(
          originCommit?.refs.some(
            (ref) => ref.kind === "remote_branch" && ref.name === "origin/main",
          ),
          true,
        );
        assert.equal(
          initialCommit?.refs.some((ref) => ref.kind === "tag" && ref.name === "v1.0.0"),
          true,
        );
        assert.deepStrictEqual(
          allCommits
            .flatMap((commit) => commit.refs)
            .filter((ref) => ref.kind !== "tag")
            .map((ref) => ref.name)
            .sort(),
          ["main", "origin/main"],
        );
        assert.equal(
          allCommits.some((commit) => commit.id === checkpoint),
          false,
        );
        assert.equal(
          allCommits.some((commit) => commit.id === stashCommit),
          false,
        );
        assert.equal(
          allCommits.some((commit) => commit.id === unrelated),
          false,
        );
      }),
    );

    it.effect("peels annotated tags and limits detached history to HEAD", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTmpDir();
        yield* initRepo(cwd);
        const initial = yield* commitFile(cwd, "README.md", "initial\n", "Initial");
        const latest = yield* commitFile(cwd, "latest.txt", "latest\n", "Latest");
        yield* git(cwd, ["tag", "-a", "v2.0.0", "-m", "annotated", initial]);
        yield* git(cwd, ["update-ref", "refs/remotes/origin/main", latest]);
        yield* git(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
        yield* git(cwd, ["checkout", "--detach", initial]);

        const history = yield* GitHistory.GitHistory;
        const result = yield* history.list({ cwd });
        const detached = result.commits.find((commit) => commit.id === initial);

        assert.equal(detached?.isHead, true);
        assert.equal(
          detached?.refs.some((ref) => ref.kind === "tag" && ref.name === "v2.0.0"),
          true,
        );
        assert.equal(
          result.commits.flatMap((commit) => commit.refs).some((ref) => ref.current),
          false,
        );
        assert.equal(
          result.commits.some((commit) => commit.id === latest),
          false,
        );
        assert.equal(
          result.commits.flatMap((commit) => commit.refs).some((ref) => ref.name === "origin/HEAD"),
          false,
        );
      }),
    );

    it.effect("emits merge commits before each parent in topological order", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTmpDir();
        yield* initRepo(cwd);
        const root = yield* commitFile(cwd, "root.txt", "root\n", "Root");
        yield* git(cwd, ["checkout", "-b", "feature"]);
        const feature = yield* commitFile(cwd, "feature.txt", "feature\n", "Feature");
        yield* git(cwd, ["checkout", "main"]);
        const main = yield* commitFile(cwd, "main.txt", "main\n", "Main");
        yield* git(cwd, ["merge", "--no-ff", "feature", "-m", "Merge feature"]);
        const merge = yield* git(cwd, ["rev-parse", "HEAD"]);

        const history = yield* GitHistory.GitHistory;
        const result = yield* history.list({ cwd, limit: 10 });
        const ids = result.commits.map((commit) => commit.id);

        assert.equal(ids[0], merge);
        assert.ok(ids.indexOf(merge) < ids.indexOf(main));
        assert.ok(ids.indexOf(merge) < ids.indexOf(feature));
        assert.ok(ids.indexOf(main) < ids.indexOf(root));
        assert.ok(ids.indexOf(feature) < ids.indexOf(root));
      }),
    );
  });

  describe("getDiff", () => {
    it.effect("returns every file in a commit as one bounded patch", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTmpDir();
        yield* initRepo(cwd);
        yield* writeFile(cwd, "first.txt", "one\n");
        yield* writeFile(cwd, "second.txt", "one\n");
        yield* git(cwd, ["add", "."]);
        yield* git(cwd, ["commit", "-m", "Root"]);
        yield* writeFile(cwd, "first.txt", "one\ntwo\n");
        yield* writeFile(cwd, "second.txt", "one\nthree\n");
        yield* git(cwd, ["add", "."]);
        yield* git(cwd, ["commit", "-m", "Change two files"]);
        const commitId = yield* git(cwd, ["rev-parse", "HEAD"]);

        const history = yield* GitHistory.GitHistory;
        const result = yield* history.getDiff({ cwd, commitId });

        assert.equal(result.commitId, commitId);
        assert.match(result.diff, /diff --git a\/first\.txt b\/first\.txt/);
        assert.match(result.diff, /diff --git a\/second\.txt b\/second\.txt/);
        assert.match(result.diff, /^\+two$/m);
        assert.match(result.diff, /^\+three$/m);
        assert.equal(result.truncated, false);
      }),
    );

    it.effect("compares a root commit with an empty tree", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTmpDir();
        yield* initRepo(cwd);
        yield* writeFile(cwd, "root.txt", "root contents\n");
        yield* git(cwd, ["add", "."]);
        yield* git(cwd, ["commit", "-m", "Root"]);
        const commitId = yield* git(cwd, ["rev-parse", "HEAD"]);

        const history = yield* GitHistory.GitHistory;
        const result = yield* history.getDiff({ cwd, commitId });

        assert.match(result.diff, /diff --git a\/root\.txt b\/root\.txt/);
        assert.match(result.diff, /^\+root contents$/m);
        assert.equal(result.truncated, false);
      }),
    );
  });

  describe("getDetails", () => {
    it.effect("returns the message body and first-parent file statistics", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTmpDir();
        yield* initRepo(cwd);
        const root = yield* commitFile(cwd, "README.md", "one\n", "Initial commit");
        const commitId = yield* commitFile(
          cwd,
          "README.md",
          "one\ntwo\n",
          "Expand readme",
          "Explain the second line.",
        );

        const history = yield* GitHistory.GitHistory;
        const details = yield* history.getDetails({ cwd, commitId });

        assert.equal(details.commitId, commitId);
        assert.equal(details.comparisonParentId, root);
        assert.equal(details.body, "Explain the second line.\n");
        assert.deepStrictEqual(details.files, [
          {
            path: "README.md",
            previousPath: null,
            kind: "modified",
            insertions: 1,
            deletions: 0,
            binary: false,
          },
        ]);

        const fileDiff = yield* history.getFileDiff({
          cwd,
          commitId,
          path: "README.md",
          previousPath: null,
        });
        assert.equal(fileDiff.path, "README.md");
        assert.match(fileDiff.diff, /diff --git a\/README\.md b\/README\.md/);
        assert.match(fileDiff.diff, /^\+two$/m);
        assert.equal(fileDiff.truncated, false);
      }),
    );

    it.effect("reports root, rename, copy, deletion, and binary changes", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTmpDir();
        yield* initRepo(cwd);
        yield* writeFile(cwd, "source.txt", "one\ntwo\nthree\n");
        yield* writeFile(cwd, "delete.txt", "remove me\n");
        yield* writeBytes(cwd, "binary.dat", new Uint8Array([0, 1, 2, 3]));
        yield* git(cwd, ["add", "."]);
        yield* git(cwd, ["commit", "-m", "Root"]);
        const root = yield* git(cwd, ["rev-parse", "HEAD"]);

        const history = yield* GitHistory.GitHistory;
        const rootDetails = yield* history.getDetails({ cwd, commitId: root });
        assert.equal(rootDetails.comparisonParentId, null);
        assert.equal(rootDetails.files.find((file) => file.path === "source.txt")?.kind, "added");
        assert.equal(rootDetails.files.find((file) => file.path === "binary.dat")?.binary, true);
        const rootDiff = yield* history.getFileDiff({
          cwd,
          commitId: root,
          path: "source.txt",
          previousPath: null,
        });
        assert.match(rootDiff.diff, /diff --git a\/source\.txt b\/source\.txt/);
        assert.match(rootDiff.diff, /^\+one$/m);

        yield* git(cwd, ["mv", "source.txt", "renamed.txt"]);
        yield* git(cwd, ["commit", "-m", "Rename source"]);
        const renameCommit = yield* git(cwd, ["rev-parse", "HEAD"]);
        const renameDetails = yield* history.getDetails({ cwd, commitId: renameCommit });
        assert.deepStrictEqual(
          renameDetails.files.map((file) => ({
            kind: file.kind,
            previousPath: file.previousPath,
            path: file.path,
          })),
          [{ kind: "renamed", previousPath: "source.txt", path: "renamed.txt" }],
        );

        yield* writeFile(cwd, "copied.txt", "one\ntwo\nthree\n");
        yield* git(cwd, ["add", "copied.txt"]);
        yield* git(cwd, ["commit", "-m", "Copy source"]);
        const copyCommit = yield* git(cwd, ["rev-parse", "HEAD"]);
        const copyDetails = yield* history.getDetails({ cwd, commitId: copyCommit });
        assert.equal(copyDetails.files[0]?.kind, "copied");
        assert.equal(copyDetails.files[0]?.previousPath, "renamed.txt");

        yield* git(cwd, ["rm", "delete.txt"]);
        yield* writeBytes(cwd, "binary.dat", new Uint8Array([0, 1, 2, 3, 4, 5]));
        yield* git(cwd, ["add", "binary.dat"]);
        yield* git(cwd, ["commit", "-m", "Delete and change binary"]);
        const finalCommit = yield* git(cwd, ["rev-parse", "HEAD"]);
        const finalDetails = yield* history.getDetails({ cwd, commitId: finalCommit });
        assert.equal(
          finalDetails.files.find((file) => file.path === "delete.txt")?.kind,
          "deleted",
        );
        assert.deepStrictEqual(
          finalDetails.files.find((file) => file.path === "binary.dat"),
          {
            path: "binary.dat",
            previousPath: null,
            kind: "modified",
            insertions: null,
            deletions: null,
            binary: true,
          },
        );
      }),
    );

    it.effect("compares a merge against its first parent", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTmpDir();
        yield* initRepo(cwd);
        yield* commitFile(cwd, "root.txt", "root\n", "Root");
        yield* git(cwd, ["checkout", "-b", "feature"]);
        yield* commitFile(cwd, "feature.txt", "feature\n", "Feature");
        yield* git(cwd, ["checkout", "main"]);
        const firstParent = yield* commitFile(cwd, "main.txt", "main\n", "Main");
        yield* git(cwd, ["merge", "--no-ff", "feature", "-m", "Merge feature"]);
        const merge = yield* git(cwd, ["rev-parse", "HEAD"]);

        const history = yield* GitHistory.GitHistory;
        const details = yield* history.getDetails({ cwd, commitId: merge });

        assert.equal(details.comparisonParentId, firstParent);
        assert.deepStrictEqual(
          details.files.map((file) => file.path),
          ["feature.txt"],
        );
        const fileDiff = yield* history.getFileDiff({
          cwd,
          commitId: merge,
          path: "feature.txt",
          previousPath: null,
        });
        assert.match(fileDiff.diff, /diff --git a\/feature\.txt b\/feature\.txt/);
        assert.match(fileDiff.diff, /^\+feature$/m);
      }),
    );

    it.effect("loads a later changed file without generating patches for its siblings", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTmpDir();
        yield* initRepo(cwd);
        yield* writeFile(cwd, "first.txt", "one\n");
        yield* writeFile(cwd, "later.txt", "one\n");
        yield* git(cwd, ["add", "."]);
        yield* git(cwd, ["commit", "-m", "Root"]);
        yield* writeFile(cwd, "first.txt", "one\ntwo\n");
        yield* writeFile(cwd, "later.txt", "one\nselected\n");
        yield* git(cwd, ["add", "."]);
        yield* git(cwd, ["commit", "-m", "Change two files"]);
        const commitId = yield* git(cwd, ["rev-parse", "HEAD"]);

        const history = yield* GitHistory.GitHistory;
        const details = yield* history.getDetails({ cwd, commitId });
        assert.deepStrictEqual(
          details.files.map((file) => file.path),
          ["first.txt", "later.txt"],
        );

        const laterDiff = yield* history.getFileDiff({
          cwd,
          commitId,
          path: "later.txt",
          previousPath: null,
        });
        assert.match(laterDiff.diff, /diff --git a\/later\.txt b\/later\.txt/);
        assert.match(laterDiff.diff, /^\+selected$/m);
        assert.equal(/first\.txt/.test(laterDiff.diff), false);
      }),
    );

    it.effect("caps oversized message bodies and returns a sanitized missing-commit error", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTmpDir();
        yield* initRepo(cwd);
        yield* writeFile(cwd, "large.txt", "large\n");
        yield* writeFile(cwd, "message.txt", `Large body\n\n${"x".repeat(300 * 1024)}`);
        yield* git(cwd, ["add", "large.txt"]);
        yield* git(cwd, ["commit", "-F", "message.txt"]);
        const commitId = yield* git(cwd, ["rev-parse", "HEAD"]);

        const history = yield* GitHistory.GitHistory;
        const details = yield* history.getDetails({ cwd, commitId });
        assert.equal(details.bodyTruncated, true);
        assert.ok(Buffer.byteLength(details.body) <= 256 * 1024);

        const missingId = "f".repeat(40);
        const error = yield* Effect.flip(history.getDetails({ cwd, commitId: missingId }));
        assert.equal(error._tag, "GitCommandError");
        assert.equal(error.detail, "The selected commit could not be resolved.");
        const fileDiffError = yield* Effect.flip(
          history.getFileDiff({
            cwd,
            commitId: missingId,
            path: "large.txt",
            previousPath: null,
          }),
        );
        assert.equal(fileDiffError._tag, "GitCommandError");
        assert.equal(fileDiffError.detail, "The selected commit could not be resolved.");
      }),
    );
  });
});

describe("GitHistory bounded-output parsing", () => {
  it.effect("drops an incomplete trailing file record and reports truncation", () => {
    const commitId = "a".repeat(40);
    const parentId = "b".repeat(40);
    const gitLayer = Layer.mock(GitVcsDriver.GitVcsDriver)({
      execute: (input) => {
        switch (input.operation) {
          case "GitHistory.getDetails.verify":
            return Effect.succeed(executeResult(""));
          case "GitHistory.getDetails.metadata":
            return Effect.succeed(
              executeResult(
                ["Test Committer", "test@example.com", "2026-07-29T12:00:00Z", parentId].join("\0"),
              ),
            );
          case "GitHistory.getDetails.body":
            return Effect.succeed(executeResult("Body\n"));
          case "GitHistory.getDetails.nameStatus":
            return Effect.succeed(
              executeResult("M\0complete.txt\0A\0partial", { truncated: true }),
            );
          case "GitHistory.getDetails.numstat":
            return Effect.succeed(executeResult("1\t0\tcomplete.txt\0", { truncated: true }));
          default:
            return Effect.die(`Unexpected Git operation: ${input.operation}`);
        }
      },
    });

    return Effect.gen(function* () {
      const history = yield* GitHistory.make;
      const details = yield* history.getDetails({ cwd: "/repo", commitId });

      assert.deepStrictEqual(details.files, [
        {
          path: "complete.txt",
          previousPath: null,
          kind: "modified",
          insertions: 1,
          deletions: 0,
          binary: false,
        },
      ]);
      assert.equal(details.filesTruncated, true);
    }).pipe(Effect.provide(gitLayer));
  });

  it.effect("returns a bounded patch for exactly the selected file", () => {
    const commitId = "a".repeat(40);
    const parentId = "b".repeat(40);
    const calls: ReadonlyArray<string>[] = [];
    const gitLayer = Layer.mock(GitVcsDriver.GitVcsDriver)({
      execute: (input) => {
        calls.push(input.args);
        switch (input.operation) {
          case "GitHistory.getFileDiff.parents":
            return Effect.succeed(executeResult(`${parentId}\n`));
          case "GitHistory.getFileDiff.patch":
            return Effect.succeed(
              executeResult("diff --git a/old.ts b/new.ts\n", { truncated: true }),
            );
          default:
            return Effect.die(`Unexpected Git operation: ${input.operation}`);
        }
      },
    });

    return Effect.gen(function* () {
      const history = yield* GitHistory.make;
      const result = yield* history.getFileDiff({
        cwd: "/repo",
        commitId,
        path: "new.ts",
        previousPath: "old.ts",
      });

      assert.deepStrictEqual(result, {
        commitId,
        path: "new.ts",
        diff: "diff --git a/old.ts b/new.ts\n",
        truncated: true,
      });
      assert.equal(calls.at(-1)?.includes("--literal-pathspecs"), true);
      assert.deepStrictEqual(calls.at(-1)?.slice(-3), ["--", "old.ts", "new.ts"]);
    }).pipe(Effect.provide(gitLayer));
  });

  it.effect("turns incomplete log records into a stable Git command error", () => {
    const commitId = "a".repeat(40);
    const gitLayer = Layer.mock(GitVcsDriver.GitVcsDriver)({
      execute: (input) => {
        switch (input.operation) {
          case "GitHistory.list.head":
            return Effect.succeed(executeResult(`${commitId}\n`));
          case "GitHistory.list.currentRef":
            return Effect.succeed(executeResult("refs/heads/main\n"));
          case "GitHistory.list.refs":
            return Effect.succeed(
              executeResult(["refs/heads/main", commitId, "commit", "", "", "", "\n"].join("\0")),
            );
          case "GitHistory.list.log":
            return Effect.succeed(executeResult(`${commitId}\0`));
          default:
            return Effect.die(`Unexpected Git operation: ${input.operation}`);
        }
      },
    });

    return Effect.gen(function* () {
      const history = yield* GitHistory.make;
      const error = yield* Effect.flip(history.list({ cwd: "/repo" }));

      assert.equal(error._tag, "GitCommandError");
      assert.equal(error.operation, "GitHistory.list.parseLog");
      assert.equal(error.detail, "Git history output was incomplete.");
    }).pipe(Effect.provide(gitLayer));
  });

  it.effect("walks pinned tip object ids from the cursor instead of live ref names", () => {
    const tipA = "a".repeat(40);
    const tipB = "b".repeat(40);
    const cursor = base64UrlEncode(
      encodeTestHistoryCursor({
        v: 1,
        tips: [tipA, tipB],
        skip: 2,
        includeOrigin: false,
      }),
    );
    let logArgs: ReadonlyArray<string> | undefined;
    const gitLayer = Layer.mock(GitVcsDriver.GitVcsDriver)({
      execute: (input) => {
        switch (input.operation) {
          case "GitHistory.list.head":
            return Effect.succeed(executeResult(`${tipA}\n`));
          case "GitHistory.list.currentRef":
            return Effect.succeed(executeResult("refs/heads/main\n"));
          case "GitHistory.list.refs":
            return Effect.succeed(
              executeResult(["refs/heads/main", tipA, "commit", "", "", "", "\n"].join("\0")),
            );
          case "GitHistory.list.log":
            logArgs = input.args;
            return Effect.succeed(executeResult(""));
          default:
            return Effect.die(`Unexpected Git operation: ${input.operation}`);
        }
      },
    });

    return Effect.gen(function* () {
      const history = yield* GitHistory.make;
      const result = yield* history.list({ cwd: "/repo", cursor, limit: 5 });

      assert.deepStrictEqual(result.commits, []);
      assert.equal(result.nextCursor, null);
      assert.ok(logArgs?.includes(`--skip=2`));
      assert.ok(logArgs?.includes(`--max-count=6`));
      assert.ok(logArgs?.includes(tipA));
      assert.ok(logArgs?.includes(tipB));
      assert.equal(logArgs?.includes("--branches"), false);
      assert.equal(logArgs?.includes("--remotes"), false);
      assert.equal(logArgs?.includes("--tags"), false);
    }).pipe(Effect.provide(gitLayer));
  });
});
