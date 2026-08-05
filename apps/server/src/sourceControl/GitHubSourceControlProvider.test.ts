import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitHubCli from "./GitHubCli.ts";
import { parseGitHubAuthStatus } from "./gitHubAuthStatus.ts";
import * as GitHubSourceControlProvider from "./GitHubSourceControlProvider.ts";

const processResult = (
  stdout: string,
  options?: {
    readonly stderr?: string;
    readonly exitCode?: ChildProcessSpawner.ExitCode;
  },
): VcsProcess.VcsProcessOutput => ({
  exitCode: options?.exitCode ?? ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: options?.stderr ?? "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

function makeProvider(github: Partial<GitHubCli.GitHubCli["Service"]>) {
  return GitHubSourceControlProvider.make.pipe(
    Effect.provide(Layer.mock(GitHubCli.GitHubCli)(github)),
  );
}

it.effect("maps GitHub PR summaries into provider-neutral change requests", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      getPullRequest: () =>
        Effect.succeed({
          number: 42,
          title: "Add GitHub provider",
          url: "https://github.com/pingdotgg/aqqua/pull/42",
          baseRefName: "main",
          headRefName: "feature/source-control",
          state: "open",
          isCrossRepository: true,
          headRepositoryNameWithOwner: "fork/aqqua",
          headRepositoryOwnerLogin: "fork",
        }),
    });

    const changeRequest = yield* provider.getChangeRequest({
      cwd: "/repo",
      reference: "42",
    });

    assert.deepStrictEqual(changeRequest, {
      provider: "github",
      number: 42,
      title: "Add GitHub provider",
      url: "https://github.com/pingdotgg/aqqua/pull/42",
      baseRefName: "main",
      headRefName: "feature/source-control",
      state: "open",
      updatedAt: Option.none(),
      isCrossRepository: true,
      headRepositoryNameWithOwner: "fork/aqqua",
      headRepositoryOwnerLogin: "fork",
    });
  }),
);

it.effect(
  "advertises checks and maps GitHub rollups and details through the provider surface",
  () =>
    Effect.gen(function* () {
      let checksInput: Parameters<GitHubCli.GitHubCli["Service"]["listChecks"]>[0] | null = null;
      const provider = yield* makeProvider({
        listChecks: (input) => {
          checksInput = input;
          return Effect.succeed("failure");
        },
        listCheckDetails: () =>
          Effect.succeed([
            { name: "unit", status: "failure", detailsUrl: "https://example.test/unit" },
          ]),
      });

      const listChecks = provider.listChecks;
      if (!listChecks) {
        return assert.fail("Expected GitHub checks capability");
      }
      const status = yield* listChecks({
        cwd: "/repo",
        changeRequestNumber: 42,
      });
      const details = yield* provider.listCheckDetails!({ cwd: "/repo", reference: "#42" });

      assert.deepStrictEqual(provider.capabilities, {
        checks: true,
        checkDetails: true,
        merge: true,
        autoMerge: true,
        changeRequestState: true,
        conversation: true,
        commits: true,
        branchDelete: true,
      });
      assert.deepStrictEqual(checksInput, { cwd: "/repo", changeRequestNumber: 42 });
      assert.strictEqual(status, "failure");
      assert.deepStrictEqual(details, [
        { name: "unit", status: "failure", detailsUrl: "https://example.test/unit" },
      ]);
    }),
);

it.effect("advertises merge, auto-merge, and state mutation capabilities", () =>
  Effect.gen(function* () {
    const calls: Array<string> = [];
    const provider = yield* makeProvider({
      getMergeOptions: () =>
        Effect.succeed({ methods: ["merge", "squash"], defaultMethod: "squash" }),
      mergePullRequest: (input) => {
        calls.push(`merge:${input.reference}:${input.method}`);
        return Effect.void;
      },
      setAutoMerge: (input) => {
        calls.push(`auto:${input.reference}:${input.enabled}`);
        return Effect.void;
      },
      updatePullRequestState: (input) => {
        calls.push(`state:${input.reference}:${input.state}`);
        return Effect.void;
      },
    });

    const options = yield* provider.getChangeRequestMergeOptions!({
      cwd: "/repo",
      reference: "42",
    });
    yield* provider.mergeChangeRequest!({
      cwd: "/repo",
      reference: "42",
      method: "squash",
    });
    yield* provider.setAutoMerge!({
      cwd: "/repo",
      reference: "42",
      enabled: true,
      method: "squash",
    });
    yield* provider.updateChangeRequestState!({
      cwd: "/repo",
      reference: "42",
      state: "closed",
    });

    assert.deepStrictEqual(provider.capabilities, {
      checks: true,
      checkDetails: true,
      merge: true,
      autoMerge: true,
      changeRequestState: true,
      conversation: true,
      commits: true,
      branchDelete: true,
    });
    assert.deepStrictEqual(options, {
      methods: ["merge", "squash"],
      defaultMethod: "squash",
    });
    assert.deepStrictEqual(calls, ["merge:42:squash", "auto:42:true", "state:42:closed"]);
  }),
);

it.effect("refuses to delete the head branch of an open pull request", () =>
  Effect.gen(function* () {
    let deleteCalled = false;
    const provider = yield* makeProvider({
      getPullRequest: () =>
        Effect.succeed({
          number: 42,
          title: "Open pull request",
          url: "https://github.com/acme/repo/pull/42",
          baseRefName: "main",
          headRefName: "feature/open",
          state: "open",
          isCrossRepository: false,
        }),
      deleteRemoteBranch: () => {
        deleteCalled = true;
        return Effect.succeed("deleted");
      },
    });

    const error = yield* provider.deleteChangeRequestRemoteBranch!({
      cwd: "/repo",
      reference: "#42",
    }).pipe(Effect.flip);

    assert.match(error.detail, /Only merged or closed pull requests/u);
    assert.strictEqual(deleteCalled, false);
  }),
);

it.effect("refuses to delete a pull request head branch that lives on a fork", () =>
  Effect.gen(function* () {
    let deleteCalled = false;
    const provider = yield* makeProvider({
      getPullRequest: () =>
        Effect.succeed({
          number: 42,
          title: "Fork pull request",
          url: "https://github.com/acme/repo/pull/42",
          baseRefName: "main",
          headRefName: "feature/fork",
          state: "merged",
          isCrossRepository: true,
        }),
      deleteRemoteBranch: () => {
        deleteCalled = true;
        return Effect.succeed("deleted");
      },
    });

    const error = yield* provider.deleteChangeRequestRemoteBranch!({
      cwd: "/repo",
      reference: "#42",
    }).pipe(Effect.flip);

    assert.match(error.detail, /head branch lives on a fork/u);
    assert.strictEqual(deleteCalled, false);
  }),
);

it.effect("adds safe request context while retaining GitHub CLI causes", () =>
  Effect.gen(function* () {
    const cause = new GitHubCli.GitHubPullRequestNotFoundError({
      command: "gh",
      cwd: "/repo",
      cause: new Error("raw upstream detail that should remain in the cause"),
    });
    const provider = yield* makeProvider({
      getPullRequest: () => Effect.fail(cause),
    });

    const error = yield* provider
      .getChangeRequest({
        cwd: "/repo",
        reference: "https://user:secret@github.com/pingdotgg/aqqua/pull/42?token=secret#diff",
      })
      .pipe(Effect.flip);

    assert.deepStrictEqual(
      {
        provider: error.provider,
        operation: error.operation,
        command: error.command,
        cwd: error.cwd,
        reference: error.reference,
        detail: error.detail,
      },
      {
        provider: "github",
        operation: "getChangeRequest",
        command: "gh",
        cwd: "/repo",
        reference: "https://github.com/pingdotgg/aqqua/pull/42",
        detail: "Pull request not found. Check the PR number or URL and try again.",
      },
    );
    assert.strictEqual(error.cause, cause);
    assert.equal(error.message.includes("raw upstream detail"), false);
  }),
);

it.effect("uses gh json listing for non-open change request state queries", () =>
  Effect.gen(function* () {
    let executeArgs: ReadonlyArray<string> = [];
    const provider = yield* makeProvider({
      execute: (input) => {
        executeArgs = input.args;
        return Effect.succeed(
          processResult(
            JSON.stringify([
              {
                number: 7,
                title: "Merged work",
                url: "https://github.com/pingdotgg/aqqua/pull/7",
                baseRefName: "main",
                headRefName: "feature/merged",
                state: "merged",
                updatedAt: "2026-01-02T00:00:00.000Z",
              },
            ]),
          ),
        );
      },
    });

    const changeRequests = yield* provider.listChangeRequests({
      cwd: "/repo",
      headSelector: "feature/merged",
      state: "all",
      limit: 10,
    });

    assert.deepStrictEqual(executeArgs, [
      "pr",
      "list",
      "--head",
      "feature/merged",
      "--state",
      "all",
      "--limit",
      "10",
      "--json",
      "number,title,url,baseRefName,headRefName,state,mergedAt,updatedAt,isCrossRepository,headRepository,headRepositoryOwner",
    ]);
    assert.strictEqual(changeRequests[0]?.provider, "github");
    assert.strictEqual(changeRequests[0]?.state, "merged");
    assert.deepStrictEqual(
      changeRequests[0]?.updatedAt,
      Option.some(DateTime.makeUnsafe("2026-01-02T00:00:00.000Z")),
    );
  }),
);

it.effect("treats empty non-open change request listing output as no results", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      execute: () => Effect.succeed(processResult("")),
    });

    const changeRequests = yield* provider.listChangeRequests({
      cwd: "/repo",
      headSelector: "feature/empty",
      state: "all",
      limit: 10,
    });

    assert.deepStrictEqual(changeRequests, []);
  }),
);

it.effect("creates GitHub PRs through provider-neutral input names", () =>
  Effect.gen(function* () {
    let createInput: Parameters<GitHubCli.GitHubCli["Service"]["createPullRequest"]>[0] | null =
      null;
    const provider = yield* makeProvider({
      createPullRequest: (input) => {
        createInput = input;
        return Effect.void;
      },
    });

    yield* provider.createChangeRequest({
      cwd: "/repo",
      baseRefName: "main",
      headSelector: "owner:feature/provider",
      title: "Provider PR",
      bodyFile: "/tmp/body.md",
    });

    assert.deepStrictEqual(createInput, {
      cwd: "/repo",
      baseBranch: "main",
      headSelector: "owner:feature/provider",
      title: "Provider PR",
      bodyFile: "/tmp/body.md",
    });
  }),
);

it("accepts active authenticated GitHub accounts when another account fails", () => {
  const auth = GitHubSourceControlProvider.discovery.parseAuth(
    processResult(
      JSON.stringify({
        hosts: {
          "github.com": [
            {
              state: "success",
              active: true,
              host: "github.com",
              login: "active-user",
              tokenSource: "keyring",
              gitProtocol: "ssh",
            },
            {
              state: "error",
              active: false,
              host: "github.com",
              login: "stale-user",
              tokenSource: "keyring",
              gitProtocol: "ssh",
              error: "The token in keyring is invalid.",
            },
          ],
        },
      }),
    ),
  );

  assert.deepStrictEqual(
    {
      status: auth.status,
      account: auth.account,
      host: auth.host,
    },
    {
      status: "authenticated",
      account: Option.some("active-user"),
      host: Option.some("github.com"),
    },
  );
});

it("parses GitHub auth JSON from stdout when stderr has warnings", () => {
  const auth = GitHubSourceControlProvider.discovery.parseAuth(
    processResult(
      JSON.stringify({
        hosts: {
          "github.com": [
            {
              state: "success",
              active: true,
              host: "github.com",
              login: "active-user",
              tokenSource: "keyring",
              gitProtocol: "ssh",
            },
          ],
        },
      }),
      { stderr: "warning: ignored diagnostic from gh\n" },
    ),
  );

  assert.deepStrictEqual(
    {
      status: auth.status,
      account: auth.account,
      host: auth.host,
    },
    {
      status: "authenticated",
      account: Option.some("active-user"),
      host: Option.some("github.com"),
    },
  );
});

it("parses GitHub auth status accounts by host and active state", () => {
  assert.deepStrictEqual(
    parseGitHubAuthStatus(
      JSON.stringify({
        hosts: {
          "github.com": [
            {
              state: "success",
              active: true,
              host: "github.com",
              login: "active-user",
              tokenSource: "keyring",
              gitProtocol: "ssh",
            },
            {
              state: "error",
              active: false,
              host: "github.com",
              login: "stale-user",
              tokenSource: "keyring",
              gitProtocol: "ssh",
            },
          ],
          "github.example.test": [
            {
              state: "success",
              active: false,
              host: "github.example.test",
              login: "enterprise-user",
              tokenSource: "keyring",
              gitProtocol: "ssh",
            },
          ],
        },
      }),
    ).accounts,
    [
      {
        host: "github.com",
        account: "active-user",
        authenticated: true,
        active: true,
        error: null,
      },
      {
        host: "github.com",
        account: "stale-user",
        authenticated: false,
        active: false,
        error: null,
      },
      {
        host: "github.example.test",
        account: "enterprise-user",
        authenticated: true,
        active: false,
        error: null,
      },
    ],
  );
});

it("reports unauthenticated when GitHub JSON has accounts but none are valid", () => {
  const auth = GitHubSourceControlProvider.discovery.parseAuth(
    processResult(
      JSON.stringify({
        hosts: {
          "github.com": [
            {
              state: "error",
              active: true,
              host: "github.com",
              login: "stale-user",
              tokenSource: "keyring",
              gitProtocol: "ssh",
              error: "The token in keyring is invalid.",
            },
          ],
        },
      }),
    ),
  );

  assert.deepStrictEqual(
    {
      status: auth.status,
      host: auth.host,
      detail: auth.detail,
    },
    {
      status: "unauthenticated",
      host: Option.some("github.com"),
      detail: Option.some("The token in keyring is invalid."),
    },
  );
});
