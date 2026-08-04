import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as BitbucketApi from "./BitbucketApi.ts";
import * as BitbucketSourceControlProvider from "./BitbucketSourceControlProvider.ts";

function makeProvider(bitbucket: Partial<BitbucketApi.BitbucketApi["Service"]>) {
  return BitbucketSourceControlProvider.make.pipe(
    Effect.provide(Layer.mock(BitbucketApi.BitbucketApi)(bitbucket)),
  );
}

it.effect("maps Bitbucket PR summaries into provider-neutral change requests", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      getPullRequest: () =>
        Effect.succeed({
          number: 42,
          title: "Add Bitbucket provider",
          url: "https://bitbucket.org/pingdotgg/aqqua/pull-requests/42",
          baseRefName: "main",
          headRefName: "feature/source-control",
          state: "open",
          updatedAt: Option.none(),
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
      provider: "bitbucket",
      number: 42,
      title: "Add Bitbucket provider",
      url: "https://bitbucket.org/pingdotgg/aqqua/pull-requests/42",
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

it.effect("advertises checks and maps Bitbucket statuses through the provider surface", () =>
  Effect.gen(function* () {
    let checksInput: Parameters<BitbucketApi.BitbucketApi["Service"]["listChecks"]>[0] | null =
      null;
    const provider = yield* makeProvider({
      listChecks: (input) => {
        checksInput = input;
        return Effect.succeed("success");
      },
    });

    const listChecks = provider.listChecks;
    if (!listChecks) {
      return assert.fail("Expected Bitbucket checks capability");
    }
    const status = yield* listChecks({
      cwd: "/repo",
      changeRequestNumber: 42,
    });

    assert.deepStrictEqual(provider.capabilities, {
      checks: true,
      merge: true,
      changeRequestState: true,
    });
    assert.deepStrictEqual(checksInput, { cwd: "/repo", changeRequestNumber: 42 });
    assert.strictEqual(status, "success");
  }),
);

it.effect("delegates Bitbucket merge and state mutations without advertising auto-merge", () =>
  Effect.gen(function* () {
    const calls: Array<string> = [];
    const provider = yield* makeProvider({
      getMergeOptions: () => Effect.succeed({ methods: ["squash"], defaultMethod: "squash" }),
      mergePullRequest: (input) => {
        calls.push(`merge:${input.method}`);
        return Effect.void;
      },
      updatePullRequestState: (input) => {
        calls.push(`state:${input.state}`);
        return Effect.void;
      },
    });

    yield* provider.mergeChangeRequest!({
      cwd: "/repo",
      reference: "42",
      method: "squash",
    });
    yield* provider.updateChangeRequestState!({
      cwd: "/repo",
      reference: "42",
      state: "closed",
    });

    assert.strictEqual(provider.setAutoMerge, undefined);
    assert.deepStrictEqual(calls, ["merge:squash", "state:closed"]);
  }),
);

it.effect("adds repository context while retaining Bitbucket API causes", () =>
  Effect.gen(function* () {
    const upstreamCause = new Error("raw upstream failure");
    const cause = new BitbucketApi.BitbucketRequestError({
      operation: "getRepository",
      cause: upstreamCause,
    });
    const provider = yield* makeProvider({
      getRepositoryCloneUrls: () => Effect.fail(cause),
    });

    const error = yield* provider
      .getRepositoryCloneUrls({ cwd: "/repo", repository: "owner/repo" })
      .pipe(Effect.flip);

    assert.deepStrictEqual(
      {
        provider: error.provider,
        operation: error.operation,
        command: error.command,
        cwd: error.cwd,
        repository: error.repository,
        detail: error.detail,
      },
      {
        provider: "bitbucket",
        operation: "getRepositoryCloneUrls",
        command: undefined,
        cwd: "/repo",
        repository: "owner/repo",
        detail: "Failed to get repository clone URLs.",
      },
    );
    assert.strictEqual(error.cause, cause);
    assert.equal(error.message.includes(upstreamCause.message), false);
  }),
);

it.effect("lists Bitbucket PRs through provider-neutral input names", () =>
  Effect.gen(function* () {
    let listInput: Parameters<BitbucketApi.BitbucketApi["Service"]["listPullRequests"]>[0] | null =
      null;
    const provider = yield* makeProvider({
      listPullRequests: (input) => {
        listInput = input;
        return Effect.succeed([]);
      },
    });

    yield* provider.listChangeRequests({
      cwd: "/repo",
      headSelector: "feature/provider",
      state: "all",
      limit: 10,
    });

    assert.deepStrictEqual(listInput, {
      cwd: "/repo",
      headSelector: "feature/provider",
      state: "all",
      limit: 10,
    });
  }),
);

it.effect("creates Bitbucket PRs through provider-neutral input names", () =>
  Effect.gen(function* () {
    let createInput:
      | Parameters<BitbucketApi.BitbucketApi["Service"]["createPullRequest"]>[0]
      | null = null;
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
      source: {
        owner: "owner",
        refName: "feature/provider",
      },
      title: "Provider PR",
      bodyFile: "/tmp/body.md",
    });
  }),
);

it.effect("uses Bitbucket API repository detection for default branch lookup", () =>
  Effect.gen(function* () {
    let cwdInput: string | null = null;
    const provider = yield* makeProvider({
      getDefaultBranch: (input) => {
        cwdInput = input.cwd;
        return Effect.succeed("main");
      },
    });

    const defaultBranch = yield* provider.getDefaultBranch({ cwd: "/repo" });

    assert.strictEqual(defaultBranch, "main");
    assert.strictEqual(cwdInput, "/repo");
  }),
);
