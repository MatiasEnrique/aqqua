import { assert, it, afterEach, expect, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/unstable/process";

import { VcsProcessExitError } from "@aqqua/contracts";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitLabCli from "./GitLabCli.ts";

const mockedRun = vi.fn<VcsProcess.VcsProcess["Service"]["run"]>();
const layer = it.layer(
  GitLabCli.layer.pipe(
    Layer.provide(
      Layer.mock(VcsProcess.VcsProcess)({
        run: mockedRun,
      }),
    ),
  ),
);

function processOutput(stdout: string): VcsProcess.VcsProcessOutput {
  return {
    exitCode: ChildProcessSpawner.ExitCode(0),
    stdout,
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}

afterEach(() => {
  mockedRun.mockReset();
});

layer("GitLabCli.layer", (it) => {
  it.effect("parses merge request view output", () =>
    Effect.gen(function* () {
      mockedRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              iid: 42,
              title: "Add MR thread creation",
              web_url: "https://gitlab.com/pingdotgg/aqqua/-/merge_requests/42",
              target_branch: "main",
              source_branch: "feature/mr-threads",
              state: "opened",
              source_project_id: 101,
              target_project_id: 100,
              source_project: {
                path_with_namespace: "octocat/aqqua",
              },
            }),
          ),
        ),
      );

      const result = yield* Effect.gen(function* () {
        const glab = yield* GitLabCli.GitLabCli;
        return yield* glab.getMergeRequest({
          cwd: "/repo",
          reference: "42",
        });
      });

      assert.deepStrictEqual(result, {
        number: 42,
        title: "Add MR thread creation",
        url: "https://gitlab.com/pingdotgg/aqqua/-/merge_requests/42",
        baseRefName: "main",
        headRefName: "feature/mr-threads",
        state: "open",
        isCrossRepository: true,
        headRepositoryNameWithOwner: "octocat/aqqua",
        headRepositoryOwnerLogin: "octocat",
      });
      expect(mockedRun).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "glab",
          cwd: "/repo",
          args: ["mr", "view", "42", "--output", "json"],
        }),
      );
    }),
  );

  it.effect("uses the latest merge request pipeline as checks status", () =>
    Effect.gen(function* () {
      mockedRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify([{ status: "running" }]),
          ),
        ),
      );

      const glab = yield* GitLabCli.GitLabCli;
      const result = yield* glab.listChecks({ cwd: "/repo", changeRequestNumber: 42 });

      assert.strictEqual(result, "pending");
      assert.deepStrictEqual(mockedRun.mock.calls[0]?.[0].args, [
        "api",
        "projects/:fullpath/merge_requests/42/pipelines?per_page=1",
      ]);
    }),
  );

  it.effect("lists jobs from the latest merge request pipeline", () =>
    Effect.gen(function* () {
      mockedRun
        .mockReturnValueOnce(
          // @effect-diagnostics-next-line preferSchemaOverJson:off
          Effect.succeed(processOutput(JSON.stringify([{ id: 99, status: "running" }]))),
        )
        .mockReturnValueOnce(
          Effect.succeed(
            processOutput(
              // @effect-diagnostics-next-line preferSchemaOverJson:off
              JSON.stringify([
                {
                  name: "unit tests",
                  status: "success",
                  web_url: "https://gitlab.com/acme/repo/-/jobs/1",
                },
                { name: "docs", status: "skipped" },
              ]),
            ),
          ),
        );

      const glab = yield* GitLabCli.GitLabCli;
      const result = yield* glab.listCheckDetails({ cwd: "/repo", reference: "#42" });

      assert.deepStrictEqual(result, [
        {
          name: "unit tests",
          status: "success",
          detailsUrl: "https://gitlab.com/acme/repo/-/jobs/1",
        },
        { name: "docs", status: "skipped" },
      ]);
      assert.deepStrictEqual(
        mockedRun.mock.calls.map(([input]) => input.args),
        [
          ["api", "projects/:fullpath/merge_requests/42/pipelines?per_page=1"],
          ["api", "projects/:fullpath/pipelines/99/jobs?per_page=100&page=1"],
        ],
      );
    }),
  );

  it.effect("includes later pages of jobs from the latest pipeline", () =>
    Effect.gen(function* () {
      mockedRun
        .mockReturnValueOnce(
          // @effect-diagnostics-next-line preferSchemaOverJson:off
          Effect.succeed(processOutput(JSON.stringify([{ id: 99, status: "running" }]))),
        )
        .mockReturnValueOnce(
          Effect.succeed(
            processOutput(
              // @effect-diagnostics-next-line preferSchemaOverJson:off
              JSON.stringify(
                Array.from({ length: 100 }, (_, index) => ({
                  name: `job-${index + 1}`,
                  status: "success",
                })),
              ),
            ),
          ),
        )
        .mockReturnValueOnce(
          // @effect-diagnostics-next-line preferSchemaOverJson:off
          Effect.succeed(processOutput(JSON.stringify([{ name: "job-101", status: "failed" }]))),
        );

      const glab = yield* GitLabCli.GitLabCli;
      const result = yield* glab.listCheckDetails({ cwd: "/repo", reference: "42" });

      assert.strictEqual(result.length, 101);
      assert.deepStrictEqual(result.at(-1), { name: "job-101", status: "failure" });
      assert.deepStrictEqual(mockedRun.mock.calls.at(-1)?.[0].args, [
        "api",
        "projects/:fullpath/pipelines/99/jobs?per_page=100&page=2",
      ]);
    }),
  );

  it.effect("maps project squash settings and issues explicit mutation commands", () =>
    Effect.gen(function* () {
      mockedRun
        .mockReturnValueOnce(
          // @effect-diagnostics-next-line preferSchemaOverJson:off
          Effect.succeed(processOutput(JSON.stringify({ squash_option: "default_on" }))),
        )
        .mockReturnValueOnce(
          // @effect-diagnostics-next-line preferSchemaOverJson:off
          Effect.succeed(processOutput(JSON.stringify({ squash: true }))),
        )
        .mockReturnValue(Effect.succeed(processOutput("{}")));

      const glab = yield* GitLabCli.GitLabCli;
      const options = yield* glab.getMergeOptions({ cwd: "/repo", reference: "#42" });
      yield* glab.mergeMergeRequest({ cwd: "/repo", reference: "42", method: "squash" });
      yield* glab.setAutoMerge({
        cwd: "/repo",
        reference: "42",
        enabled: true,
        method: "merge",
      });
      yield* glab.setAutoMerge({ cwd: "/repo", reference: "42", enabled: false });
      yield* glab.updateMergeRequestState({ cwd: "/repo", reference: "42", state: "open" });

      assert.deepStrictEqual(options, {
        methods: ["merge", "squash"],
        defaultMethod: "squash",
      });
      assert.deepStrictEqual(
        mockedRun.mock.calls.map(([input]) => input.args),
        [
          ["api", "projects/:fullpath"],
          ["api", "projects/:fullpath/merge_requests/42"],
          ["mr", "merge", "42", "--yes", "--auto-merge=false", "--squash"],
          ["mr", "merge", "42", "--yes", "--auto-merge"],
          [
            "api",
            "-X",
            "POST",
            "projects/:fullpath/merge_requests/42/cancel_merge_when_pipeline_succeeds",
          ],
          ["mr", "reopen", "42"],
        ],
      );
    }),
  );

  it.effect("skips invalid entries when parsing MR lists", () =>
    Effect.gen(function* () {
      mockedRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify([
              {
                iid: 0,
                title: "invalid",
                web_url: "https://gitlab.com/pingdotgg/aqqua/-/merge_requests/0",
                target_branch: "main",
                source_branch: "feature/invalid",
              },
              {
                iid: 43,
                title: "  Valid MR  ",
                web_url: " https://gitlab.com/pingdotgg/aqqua/-/merge_requests/43 ",
                target_branch: " main ",
                source_branch: " feature/mr-list ",
                state: "merged",
              },
            ]),
          ),
        ),
      );

      const result = yield* Effect.gen(function* () {
        const glab = yield* GitLabCli.GitLabCli;
        return yield* glab.listMergeRequests({
          cwd: "/repo",
          headSelector: "feature/mr-list",
          state: "all",
        });
      });

      assert.deepStrictEqual(result, [
        {
          number: 43,
          title: "Valid MR",
          url: "https://gitlab.com/pingdotgg/aqqua/-/merge_requests/43",
          baseRefName: "main",
          headRefName: "feature/mr-list",
          state: "merged",
        },
      ]);
      expect(mockedRun).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "glab",
          cwd: "/repo",
          args: [
            "mr",
            "list",
            "--source-branch",
            "feature/mr-list",
            "--all",
            "--per-page",
            "20",
            "--output",
            "json",
          ],
        }),
      );
    }),
  );

  it.effect("reads repository clone URLs", () =>
    Effect.gen(function* () {
      mockedRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              path_with_namespace: "octocat/aqqua",
              web_url: "https://gitlab.com/octocat/aqqua",
              http_url_to_repo: "https://gitlab.com/octocat/aqqua.git",
              ssh_url_to_repo: "git@gitlab.com:octocat/aqqua.git",
            }),
          ),
        ),
      );

      const result = yield* Effect.gen(function* () {
        const glab = yield* GitLabCli.GitLabCli;
        return yield* glab.getRepositoryCloneUrls({
          cwd: "/repo",
          repository: "octocat/aqqua",
        });
      });

      assert.deepStrictEqual(result, {
        nameWithOwner: "octocat/aqqua",
        url: "https://gitlab.com/octocat/aqqua",
        sshUrl: "git@gitlab.com:octocat/aqqua.git",
      });
    }),
  );

  it.effect("creates merge requests through the GitLab API without placing the body in argv", () =>
    Effect.gen(function* () {
      mockedRun.mockReturnValueOnce(Effect.succeed(processOutput("{}")));

      const glab = yield* GitLabCli.GitLabCli;
      yield* glab.createMergeRequest({
        cwd: "/repo",
        baseBranch: "main",
        headSelector: "owner:feature/provider",
        title: "Provider MR",
        bodyFile: "/tmp/aqqua-mr-body.md",
      });

      expect(mockedRun).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "glab",
          cwd: "/repo",
          args: [
            "api",
            "--method",
            "POST",
            "projects/:fullpath/merge_requests",
            "--raw-field",
            "source_branch=feature/provider",
            "--raw-field",
            "target_branch=main",
            "--raw-field",
            "title=Provider MR",
            "--field",
            "description=@/tmp/aqqua-mr-body.md",
          ],
        }),
      );
    }),
  );

  it.effect("creates repositories under an explicit namespace", () =>
    Effect.gen(function* () {
      mockedRun

        .mockReturnValueOnce(
          Effect.succeed(
            processOutput(
              // @effect-diagnostics-next-line preferSchemaOverJson:off
              JSON.stringify({ id: 1234 }),
            ),
          ),
        )
        .mockReturnValueOnce(
          Effect.succeed(
            processOutput(
              // @effect-diagnostics-next-line preferSchemaOverJson:off
              JSON.stringify({
                path_with_namespace: "octocat/aqqua",
                web_url: "https://gitlab.com/octocat/aqqua",
                http_url_to_repo: "https://gitlab.com/octocat/aqqua.git",
                ssh_url_to_repo: "git@gitlab.com:octocat/aqqua.git",
              }),
            ),
          ),
        );

      const glab = yield* GitLabCli.GitLabCli;
      const result = yield* glab.createRepository({
        cwd: "/repo",
        repository: "octocat/aqqua",
        visibility: "public",
      });

      assert.deepStrictEqual(result, {
        nameWithOwner: "octocat/aqqua",
        url: "https://gitlab.com/octocat/aqqua",
        sshUrl: "git@gitlab.com:octocat/aqqua.git",
      });
      expect(mockedRun).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          command: "glab",
          cwd: "/repo",
          args: ["api", "namespaces/octocat"],
        }),
      );
      expect(mockedRun).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          command: "glab",
          cwd: "/repo",
          args: [
            "api",
            "--method",
            "POST",
            "projects",
            "--raw-field",
            "path=aqqua",
            "--raw-field",
            "name=aqqua",
            "--raw-field",
            "visibility=public",
            "--raw-field",
            "namespace_id=1234",
          ],
        }),
      );
    }),
  );

  it.effect("does not pass unsupported force flags when checking out merge requests", () =>
    Effect.gen(function* () {
      mockedRun.mockReturnValueOnce(Effect.succeed(processOutput("")));

      const glab = yield* GitLabCli.GitLabCli;
      yield* glab.checkoutMergeRequest({
        cwd: "/repo",
        reference: "42",
        force: true,
      });

      expect(mockedRun).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "glab",
          cwd: "/repo",
          args: ["mr", "checkout", "42"],
        }),
      );
    }),
  );

  it.effect("surfaces a friendly error when the merge request is not found", () =>
    Effect.gen(function* () {
      const cause = new VcsProcessExitError({
        operation: "GitLabCli.execute",
        command: "glab",
        cwd: "/repo",
        exitCode: 1,
        detail: "GET 404 merge request not found",
        failureKind: "not-found",
      });
      mockedRun.mockReturnValueOnce(Effect.fail(cause));

      const error = yield* Effect.gen(function* () {
        const glab = yield* GitLabCli.GitLabCli;
        return yield* glab.getMergeRequest({
          cwd: "/repo",
          reference: "4888",
        });
      }).pipe(Effect.flip);

      assert.equal(error.message.includes("Merge request 4888 was not found"), true);
      assert.strictEqual(error._tag, "GitLabMergeRequestNotFoundError");
      assert.strictEqual(error.command, "glab");
      assert.strictEqual(error.cwd, "/repo");
      assert.strictEqual(error.cause, cause);
      assert.equal(error.message.includes(cause.detail), false);
    }),
  );

  it.effect("keeps non-merge-request not-found failures generic", () =>
    Effect.gen(function* () {
      const cause = new VcsProcessExitError({
        operation: "GitLabCli.execute",
        command: "glab",
        cwd: "/repo",
        exitCode: 1,
        detail: "GET 404 project not found",
        failureKind: "not-found",
      });
      mockedRun.mockReturnValueOnce(Effect.fail(cause));

      const error = yield* Effect.gen(function* () {
        const glab = yield* GitLabCli.GitLabCli;
        return yield* glab.getRepositoryCloneUrls({
          cwd: "/repo",
          repository: "missing/project",
        });
      }).pipe(Effect.flip);

      assert.strictEqual(error._tag, "GitLabCliCommandError");
      assert.strictEqual(error.cause, cause);
    }),
  );
});
