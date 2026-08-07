import { assert, it, afterEach, describe, expect, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import { ChildProcessSpawner } from "effect/unstable/process";
import { VcsProcessExitError, VcsProcessSpawnError } from "@aqqua/contracts";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitHubCli from "./GitHubCli.ts";

const processOutput = (stdout: string): VcsProcess.VcsProcessOutput => ({
  exitCode: ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

const processFailureOutput = (stderr: string): VcsProcess.VcsProcessOutput => ({
  exitCode: ChildProcessSpawner.ExitCode(1),
  stdout: "",
  stderr,
  stdoutTruncated: false,
  stderrTruncated: false,
});

const mockRun = vi.fn<VcsProcess.VcsProcess["Service"]["run"]>();

const layer = GitHubCli.layer.pipe(
  Layer.provide(
    Layer.mock(VcsProcess.VcsProcess)({
      run: mockRun,
    }),
  ),
);

afterEach(() => {
  mockRun.mockReset();
});

describe("GitHubCli.layer", () => {
  it("does not classify a missing cwd as an unavailable gh executable", () => {
    const context = { command: "gh", cwd: "/repo" } as const;
    const missingCwd = new VcsProcessSpawnError({
      operation: "GitHubCli.execute",
      command: "gh",
      cwd: context.cwd,
      cause: PlatformError.systemError({
        _tag: "NotFound",
        module: "FileSystem",
        method: "access",
        pathOrDescriptor: context.cwd,
      }),
    });

    const commandFailure = GitHubCli.fromVcsError(context, missingCwd);

    assert.equal(commandFailure._tag, "GitHubCliCommandError");
    assert.strictEqual(commandFailure.cause, missingCwd);
    assert.notProperty(commandFailure, "operation");
  });

  it.effect("parses pull request view output", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              number: 42,
              title: "Add PR thread creation",
              url: "https://github.com/pingdotgg/codething-mvp/pull/42",
              baseRefName: "main",
              headRefName: "feature/pr-threads",
              state: "OPEN",
              mergedAt: null,
              mergeable: "CONFLICTING",
              isCrossRepository: true,
              headRepository: {
                nameWithOwner: "octocat/codething-mvp",
              },
              headRepositoryOwner: {
                login: "octocat",
              },
            }),
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.getPullRequest({
        cwd: "/repo",
        reference: "#42",
      });

      assert.deepStrictEqual(result, {
        number: 42,
        title: "Add PR thread creation",
        url: "https://github.com/pingdotgg/codething-mvp/pull/42",
        baseRefName: "main",
        headRefName: "feature/pr-threads",
        state: "open",
        hasConflicts: true,
        isCrossRepository: true,
        headRepositoryNameWithOwner: "octocat/codething-mvp",
        headRepositoryOwnerLogin: "octocat",
      });
      expect(mockRun).toHaveBeenCalledWith({
        operation: "GitHubCli.execute",
        command: "gh",
        args: [
          "pr",
          "view",
          "#42",
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,mergeable,isCrossRepository,headRepository,headRepositoryOwner",
        ],
        cwd: "/repo",
        timeoutMs: 30_000,
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("reads repository merge settings and maps mutation commands", () =>
    Effect.gen(function* () {
      mockRun
        .mockReturnValueOnce(
          Effect.succeed(
            processOutput(
              // @effect-diagnostics-next-line preferSchemaOverJson:off
              JSON.stringify({
                mergeCommitAllowed: true,
                squashMergeAllowed: true,
                rebaseMergeAllowed: false,
                viewerDefaultMergeMethod: "SQUASH",
              }),
            ),
          ),
        )
        .mockReturnValue(Effect.succeed(processOutput("")));

      const github = yield* GitHubCli.GitHubCli;
      const options = yield* github.getMergeOptions({ cwd: "/repo" });
      yield* github.mergePullRequest({ cwd: "/repo", reference: "42", method: "squash" });
      yield* github.setAutoMerge({
        cwd: "/repo",
        reference: "42",
        enabled: true,
        method: "merge",
      });
      yield* github.setAutoMerge({ cwd: "/repo", reference: "42", enabled: false });
      yield* github.updatePullRequestState({ cwd: "/repo", reference: "42", state: "closed" });

      expect(options).toEqual({
        methods: ["merge", "squash"],
        defaultMethod: "squash",
      });
      expect(mockRun.mock.calls.map(([input]) => input.args)).toEqual([
        [
          "repo",
          "view",
          "--json",
          "mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed,viewerDefaultMergeMethod",
        ],
        ["pr", "merge", "42", "--squash"],
        ["pr", "merge", "42", "--auto", "--merge"],
        ["pr", "merge", "42", "--disable-auto"],
        ["pr", "close", "42"],
      ]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("reads pull request auto-merge state tolerantly", () =>
    Effect.gen(function* () {
      mockRun
        .mockReturnValueOnce(
          Effect.succeed(
            processOutput(
              // @effect-diagnostics-next-line preferSchemaOverJson:off
              JSON.stringify({ autoMergeRequest: { enabledAt: "2026-08-05T00:00:00Z" } }),
            ),
          ),
        )
        .mockReturnValueOnce(
          Effect.succeed(
            processOutput(
              // @effect-diagnostics-next-line preferSchemaOverJson:off
              JSON.stringify({ autoMergeRequest: null }),
            ),
          ),
        )
        .mockReturnValueOnce(Effect.succeed(processOutput("{}")))
        .mockReturnValueOnce(Effect.succeed(processOutput("not json")))
        .mockReturnValueOnce(Effect.succeed(processOutput("")));

      const github = yield* GitHubCli.GitHubCli;

      expect(yield* github.getPullRequestAutoMergeState({ cwd: "/repo", reference: "#42" })).toBe(
        true,
      );
      expect(yield* github.getPullRequestAutoMergeState({ cwd: "/repo", reference: "43" })).toBe(
        false,
      );
      expect(
        yield* github.getPullRequestAutoMergeState({ cwd: "/repo", reference: "44" }),
      ).toBeNull();
      expect(
        yield* github.getPullRequestAutoMergeState({ cwd: "/repo", reference: "45" }),
      ).toBeNull();
      expect(
        yield* github.getPullRequestAutoMergeState({ cwd: "/repo", reference: "46" }),
      ).toBeNull();
      expect(mockRun.mock.calls.map(([input]) => input.args)).toEqual([
        ["pr", "view", "#42", "--json", "autoMergeRequest"],
        ["pr", "view", "43", "--json", "autoMergeRequest"],
        ["pr", "view", "44", "--json", "autoMergeRequest"],
        ["pr", "view", "45", "--json", "autoMergeRequest"],
        ["pr", "view", "46", "--json", "autoMergeRequest"],
      ]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("fetches conversation and commits and maps comment and thread mutations", () =>
    Effect.gen(function* () {
      mockRun
        .mockReturnValueOnce(
          Effect.succeed(
            processOutput(
              // @effect-diagnostics-next-line preferSchemaOverJson:off
              JSON.stringify({
                number: 42,
                state: "OPEN",
                headRefName: "feature/conversation",
                comments: [],
                reviewRequests: [],
              }),
            ),
          ),
        )
        .mockReturnValueOnce(
          Effect.succeed(
            processOutput(
              // @effect-diagnostics-next-line preferSchemaOverJson:off
              JSON.stringify({ data: null }),
            ),
          ),
        )
        .mockReturnValueOnce(
          Effect.succeed(
            processOutput(
              // @effect-diagnostics-next-line preferSchemaOverJson:off
              JSON.stringify({
                number: 42,
                commits: [{ oid: "abc123", messageHeadline: "First commit" }],
              }),
            ),
          ),
        )
        .mockReturnValue(Effect.succeed(processOutput("")));

      const github = yield* GitHubCli.GitHubCli;
      const conversation = yield* github.getPullRequestConversation({
        cwd: "/repo",
        reference: "42",
      });
      const commits = yield* github.listPullRequestCommits({ cwd: "/repo", reference: "42" });
      yield* github.addPullRequestComment({
        cwd: "/repo",
        changeRequestNumber: 42,
        body: "Body\n--repo=other/project",
      });
      yield* github.replyToPullRequestThread({
        cwd: "/repo",
        threadId: "thread-1",
        body: "true",
      });
      yield* github.replyToPullRequestThread({
        cwd: "/repo",
        threadId: "thread-2",
        body: "@/private/secret.txt",
      });
      yield* github.setPullRequestThreadResolved({
        cwd: "/repo",
        threadId: "123",
        resolved: true,
      });
      yield* github.setPullRequestThreadResolved({
        cwd: "/repo",
        threadId: "thread-1",
        resolved: false,
      });

      assert.strictEqual(conversation.number, 42);
      assert.strictEqual(conversation.reviewThreads.length, 0);
      assert.strictEqual(commits.headOid, "abc123");
      const args = mockRun.mock.calls.map(([input]) => input.args);
      assert.deepStrictEqual(args[0], [
        "pr",
        "view",
        "42",
        "--json",
        "number,state,mergedAt,headRefName,isCrossRepository,body,author,createdAt,url,additions,deletions,comments,reviewRequests",
      ]);
      assert.deepStrictEqual(args[1]?.slice(0, 9), [
        "api",
        "graphql",
        "-F",
        "owner={owner}",
        "-F",
        "name={repo}",
        "-F",
        "number=42",
        "-f",
      ]);
      assert.match(args[1]?.[9] ?? "", /^query=query\(\$owner: String!/);
      assert.deepStrictEqual(args[2], ["pr", "view", "42", "--json", "number,commits"]);
      assert.deepStrictEqual(args[3], [
        "api",
        "repos/{owner}/{repo}/issues/42/comments",
        "-f",
        "body=Body\n--repo=other/project",
      ]);
      assert.deepStrictEqual(args[4]?.slice(0, 7), [
        "api",
        "graphql",
        "-f",
        "threadId=thread-1",
        "-f",
        "body=true",
        "-f",
      ]);
      assert.deepStrictEqual(args[5]?.slice(0, 7), [
        "api",
        "graphql",
        "-f",
        "threadId=thread-2",
        "-f",
        "body=@/private/secret.txt",
        "-f",
      ]);
      assert.deepStrictEqual(args[6]?.slice(0, 5), ["api", "graphql", "-f", "threadId=123", "-f"]);
      assert.match(args[6]?.at(-1) ?? "", /query=.*resolveReviewThread/);
      assert.deepStrictEqual(args[7]?.slice(0, 5), [
        "api",
        "graphql",
        "-f",
        "threadId=thread-1",
        "-f",
      ]);
      assert.match(args[7]?.at(-1) ?? "", /query=.*unresolveReviewThread/);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("deletes remote branches and tolerates an already-missing reference", () =>
    Effect.gen(function* () {
      mockRun
        .mockReturnValueOnce(Effect.succeed(processOutput("")))
        .mockReturnValueOnce(
          Effect.succeed(processFailureOutput("GraphQL: Reference does not exist")),
        );

      const github = yield* GitHubCli.GitHubCli;
      const deleted = yield* github.deleteRemoteBranch({ cwd: "/repo", branch: "fix/#12%" });
      const alreadyMissing = yield* github.deleteRemoteBranch({
        cwd: "/repo",
        branch: "feature/missing",
      });
      const invalid = yield* github
        .deleteRemoteBranch({ cwd: "/repo", branch: "--repo=other/project" })
        .pipe(Effect.flip);

      assert.strictEqual(deleted, "deleted");
      assert.strictEqual(alreadyMissing, "already_missing");
      assert.strictEqual(invalid._tag, "GitHubPullRequestReferenceError");
      assert.deepStrictEqual(
        mockRun.mock.calls.map(([input]) => input),
        [
          {
            operation: "GitHubCli.execute",
            command: "gh",
            args: ["api", "-X", "DELETE", "repos/{owner}/{repo}/git/refs/heads/fix/%2312%25"],
            cwd: "/repo",
            timeoutMs: 30_000,
            allowNonZeroExit: true,
          },
          {
            operation: "GitHubCli.execute",
            command: "gh",
            args: ["api", "-X", "DELETE", "repos/{owner}/{repo}/git/refs/heads/feature/missing"],
            cwd: "/repo",
            timeoutMs: 30_000,
            allowNonZeroExit: true,
          },
        ],
      );
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rejects option-like references before pull request mutations", () =>
    Effect.gen(function* () {
      const github = yield* GitHubCli.GitHubCli;
      const attempts = [
        () =>
          github.mergePullRequest({
            cwd: "/repo",
            reference: "--repo=other/project",
            method: "squash",
          }),
        () =>
          github.setAutoMerge({
            cwd: "/repo",
            reference: "--repo=other/project",
            enabled: false,
          }),
        () =>
          github.updatePullRequestState({
            cwd: "/repo",
            reference: "--repo=other/project",
            state: "closed",
          }),
      ];

      for (const attempt of attempts) {
        const error = yield* attempt().pipe(Effect.flip);
        assert.strictEqual(error._tag, "GitHubPullRequestReferenceError");
      }
      assert.strictEqual(mockRun.mock.calls.length, 0);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("falls back when GitHub omits or changes its default merge method", () =>
    Effect.gen(function* () {
      mockRun
        .mockReturnValueOnce(
          Effect.succeed(
            processOutput(
              // @effect-diagnostics-next-line preferSchemaOverJson:off
              JSON.stringify({
                mergeCommitAllowed: true,
                squashMergeAllowed: true,
                rebaseMergeAllowed: false,
                viewerDefaultMergeMethod: "MERGE_QUEUE",
              }),
            ),
          ),
        )
        .mockReturnValueOnce(
          Effect.succeed(
            processOutput(
              // @effect-diagnostics-next-line preferSchemaOverJson:off
              JSON.stringify({
                mergeCommitAllowed: false,
                squashMergeAllowed: true,
                rebaseMergeAllowed: false,
              }),
            ),
          ),
        );

      const github = yield* GitHubCli.GitHubCli;
      const unknownDefault = yield* github.getMergeOptions({ cwd: "/repo" });
      const missingDefault = yield* github.getMergeOptions({ cwd: "/repo" });

      assert.deepStrictEqual(unknownDefault, {
        methods: ["merge", "squash"],
        defaultMethod: "merge",
      });
      assert.deepStrictEqual(missingDefault, {
        methods: ["squash"],
        defaultMethod: "squash",
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rolls up GitHub statusCheckRollup values", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              statusCheckRollup: [
                { status: "COMPLETED", conclusion: "SUCCESS" },
                { status: "COMPLETED", conclusion: "FAILURE" },
              ],
            }),
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.listChecks({ cwd: "/repo", changeRequestNumber: 42 });

      assert.strictEqual(result, "failure");
      assert.deepStrictEqual(mockRun.mock.calls[0]?.[0].args, [
        "pr",
        "view",
        "42",
        "--json",
        "statusCheckRollup",
      ]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("treats successful GitHub status contexts as passing checks", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              statusCheckRollup: [{ state: "SUCCESS" }],
            }),
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.listChecks({ cwd: "/repo", changeRequestNumber: 42 });

      assert.strictEqual(result, "success");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("returns named GitHub check runs and status contexts from the rollup", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              statusCheckRollup: [
                {
                  name: "unit tests",
                  status: "COMPLETED",
                  conclusion: "FAILURE",
                  detailsUrl: "https://github.com/acme/repo/actions/runs/1",
                },
                {
                  context: "deploy/preview",
                  state: "PENDING",
                  targetUrl: "https://preview.example.test",
                },
                { name: "docs", status: "COMPLETED", conclusion: "SKIPPED" },
              ],
            }),
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.listCheckDetails({ cwd: "/repo", reference: "#42" });

      assert.deepStrictEqual(result, [
        {
          name: "unit tests",
          status: "failure",
          detailsUrl: "https://github.com/acme/repo/actions/runs/1",
        },
        {
          name: "deploy/preview",
          status: "pending",
          detailsUrl: "https://preview.example.test",
        },
        { name: "docs", status: "skipped" },
      ]);
      assert.deepStrictEqual(mockRun.mock.calls[0]?.[0].args, [
        "pr",
        "view",
        "#42",
        "--json",
        "statusCheckRollup",
      ]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("attributes malformed check details to listCheckDetails", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput("{}")));

      const gh = yield* GitHubCli.GitHubCli;
      const error = yield* gh.listCheckDetails({ cwd: "/repo", reference: "42" }).pipe(Effect.flip);

      if (error._tag !== "GitHubChecksDecodeError") {
        return assert.fail(`Expected GitHubChecksDecodeError, received ${error._tag}`);
      }
      assert.strictEqual(error.operation, "listCheckDetails");
      assert.match(error.message, /listCheckDetails/);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("trims pull request fields decoded from gh json", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              number: 42,
              title: "  Add PR thread creation  \n",
              url: " https://github.com/pingdotgg/codething-mvp/pull/42 ",
              baseRefName: " main ",
              headRefName: "\tfeature/pr-threads\t",
              state: "OPEN",
              mergedAt: null,
              isCrossRepository: true,
              headRepository: {
                nameWithOwner: " octocat/codething-mvp ",
              },
              headRepositoryOwner: {
                login: " octocat ",
              },
            }),
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.getPullRequest({
        cwd: "/repo",
        reference: "#42",
      });

      assert.deepStrictEqual(result, {
        number: 42,
        title: "Add PR thread creation",
        url: "https://github.com/pingdotgg/codething-mvp/pull/42",
        baseRefName: "main",
        headRefName: "feature/pr-threads",
        state: "open",
        isCrossRepository: true,
        headRepositoryNameWithOwner: "octocat/codething-mvp",
        headRepositoryOwnerLogin: "octocat",
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("skips invalid entries when parsing pr lists", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify([
              {
                number: 0,
                title: "invalid",
                url: "https://github.com/pingdotgg/codething-mvp/pull/0",
                baseRefName: "main",
                headRefName: "feature/invalid",
              },
              {
                number: 43,
                title: "  Valid PR  ",
                url: " https://github.com/pingdotgg/codething-mvp/pull/43 ",
                baseRefName: " main ",
                headRefName: " feature/pr-list ",
                headRepository: {
                  nameWithOwner: "   ",
                },
                headRepositoryOwner: {
                  login: "   ",
                },
              },
            ]),
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.listOpenPullRequests({
        cwd: "/repo",
        headSelector: "feature/pr-list",
      });

      assert.deepStrictEqual(result, [
        {
          number: 43,
          title: "Valid PR",
          url: "https://github.com/pingdotgg/codething-mvp/pull/43",
          baseRefName: "main",
          headRefName: "feature/pr-list",
          state: "open",
        },
      ]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("keeps pull requests from gh versions without headRepository.nameWithOwner", () =>
    // gh < 2.47 (e.g. Ubuntu-packaged 2.46) exports headRepository as
    // {id, name} only. These entries must decode instead of being dropped,
    // with nameWithOwner rebuilt from the owner login.
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify([
              {
                number: 2829,
                title: "Codex turn mapping",
                url: "https://github.com/pingdotgg/codething-mvp/pull/2829",
                baseRefName: "main",
                headRefName: "aqqua/codex-turn-mapping",
                state: "OPEN",
                mergedAt: null,
                isCrossRepository: false,
                headRepository: {
                  id: "R_kgDORLtfbQ",
                  name: "codething-mvp",
                },
                headRepositoryOwner: {
                  id: "MDEyOk9yZ2FuaXphdGlvbjg5MTkxNzI3",
                  login: "pingdotgg",
                },
              },
            ]),
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.listOpenPullRequests({
        cwd: "/repo",
        headSelector: "aqqua/codex-turn-mapping",
      });

      assert.deepStrictEqual(result, [
        {
          number: 2829,
          title: "Codex turn mapping",
          url: "https://github.com/pingdotgg/codething-mvp/pull/2829",
          baseRefName: "main",
          headRefName: "aqqua/codex-turn-mapping",
          state: "open",
          isCrossRepository: false,
          headRepositoryNameWithOwner: "pingdotgg/codething-mvp",
          headRepositoryOwnerLogin: "pingdotgg",
        },
      ]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("lists repository pull requests without a head filter", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify([
              {
                number: 42,
                title: "Repository pull request",
                url: "https://github.com/pingdotgg/codething-mvp/pull/42",
                baseRefName: "main",
                headRefName: "feature/repository-list",
                state: "OPEN",
                mergedAt: null,
                mergeable: "CONFLICTING",
              },
            ]),
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.listRepositoryPullRequests({
        cwd: "/repo",
        limit: 1,
      });

      assert.deepStrictEqual(result, {
        changeRequests: [
          {
            number: 42,
            title: "Repository pull request",
            url: "https://github.com/pingdotgg/codething-mvp/pull/42",
            baseRefName: "main",
            headRefName: "feature/repository-list",
            state: "open",
            hasConflicts: true,
          },
        ],
        truncated: false,
      });
      expect(mockRun).toHaveBeenCalledWith({
        operation: "GitHubCli.execute",
        command: "gh",
        args: [
          "pr",
          "list",
          "--state",
          "open",
          "--limit",
          "2",
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,mergeable",
        ],
        cwd: "/repo",
        timeoutMs: 30_000,
      });
      expect(mockRun.mock.calls[0]?.[0].args).not.toContain("--head");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("marks repository pull requests as truncated when more exist than the limit", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify([
              {
                number: 42,
                title: "First pull request",
                url: "https://github.com/pingdotgg/codething-mvp/pull/42",
                baseRefName: "main",
                headRefName: "feature/first",
                state: "OPEN",
                mergedAt: null,
              },
              {
                number: 43,
                title: "Second pull request",
                url: "https://github.com/pingdotgg/codething-mvp/pull/43",
                baseRefName: "main",
                headRefName: "feature/second",
                state: "OPEN",
                mergedAt: null,
              },
            ]),
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.listRepositoryPullRequests({
        cwd: "/repo",
        limit: 1,
      });

      assert.deepStrictEqual(result, {
        changeRequests: [
          {
            number: 42,
            title: "First pull request",
            url: "https://github.com/pingdotgg/codething-mvp/pull/42",
            baseRefName: "main",
            headRefName: "feature/first",
            state: "open",
          },
        ],
        truncated: true,
      });
      expect(mockRun).toHaveBeenCalledWith({
        operation: "GitHubCli.execute",
        command: "gh",
        args: [
          "pr",
          "list",
          "--state",
          "open",
          "--limit",
          "2",
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,mergeable",
        ],
        cwd: "/repo",
        timeoutMs: 30_000,
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("returns an empty repository pull request list when stdout is empty", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput("")));

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.listRepositoryPullRequests({
        cwd: "/repo",
        limit: 1,
      });

      assert.deepStrictEqual(result, {
        changeRequests: [],
        truncated: false,
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("reads repository clone URLs", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              nameWithOwner: "octocat/codething-mvp",
              url: "https://github.com/octocat/codething-mvp",
              sshUrl: "git@github.com:octocat/codething-mvp.git",
            }),
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.getRepositoryCloneUrls({
        cwd: "/repo",
        repository: "octocat/codething-mvp",
      });

      assert.deepStrictEqual(result, {
        nameWithOwner: "octocat/codething-mvp",
        url: "https://github.com/octocat/codething-mvp",
        sshUrl: "git@github.com:octocat/codething-mvp.git",
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("creates repositories and parses clone URLs from create output", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            "✓ Created repository octocat/codething-mvp on github.com\nhttps://github.com/octocat/codething-mvp\n",
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.createRepository({
        cwd: "/repo",
        repository: "octocat/codething-mvp",
        visibility: "private",
      });

      assert.deepStrictEqual(result, {
        nameWithOwner: "octocat/codething-mvp",
        url: "https://github.com/octocat/codething-mvp",
        sshUrl: "git@github.com:octocat/codething-mvp.git",
      });
      expect(mockRun).toHaveBeenCalledTimes(1);
      expect(mockRun).toHaveBeenNthCalledWith(1, {
        operation: "GitHubCli.execute",
        command: "gh",
        args: ["repo", "create", "octocat/codething-mvp", "--private"],
        cwd: "/repo",
        timeoutMs: 30_000,
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("falls back to constructed URLs when create output omits a URL", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput("")));

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.createRepository({
        cwd: "/repo",
        repository: "octocat/codething-mvp",
        visibility: "private",
      });

      assert.deepStrictEqual(result, {
        nameWithOwner: "octocat/codething-mvp",
        url: "https://github.com/octocat/codething-mvp",
        sshUrl: "git@github.com:octocat/codething-mvp.git",
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("surfaces a friendly error when the pull request is not found", () =>
    Effect.gen(function* () {
      const cause = new VcsProcessExitError({
        operation: "GitHubCli.execute",
        command: "gh pr view",
        cwd: "/repo",
        exitCode: 1,
        failureKind: "not-found",
        detail:
          "GraphQL: Could not resolve to a PullRequest with the number of 4888. (repository.pullRequest)",
      });
      mockRun.mockReturnValueOnce(Effect.fail(cause));

      const gh = yield* GitHubCli.GitHubCli;
      const error = yield* gh
        .getPullRequest({
          cwd: "/repo",
          reference: "4888",
        })
        .pipe(Effect.flip);

      assert.equal(error.message.includes("Pull request not found"), true);
      assert.strictEqual(error._tag, "GitHubPullRequestNotFoundError");
      assert.strictEqual(error.command, "gh");
      assert.strictEqual(error.cwd, "/repo");
      assert.strictEqual(error.cause, cause);
      assert.equal(error.message.includes(cause.detail), false);
    }).pipe(Effect.provide(layer)),
  );
});
