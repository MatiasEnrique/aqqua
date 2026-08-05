import { assert, it } from "@effect/vitest";

import * as Effect from "effect/Effect";

import {
  supportsChangeRequestChecks,
  supportsChangeRequestCheckDetails,
  supportsChangeRequestAutoMerge,
  supportsChangeRequestMerge,
  supportsChangeRequestStateUpdate,
  supportsChangeRequestConversation,
  supportsChangeRequestCommits,
  supportsChangeRequestBranchDelete,
  transportSafeSourceControlErrorValue,
  SourceControlProvider,
} from "./SourceControlProvider.ts";

it("removes URL credentials, query parameters, and fragments from error transport values", () => {
  assert.strictEqual(
    transportSafeSourceControlErrorValue(
      "https://user:secret@example.test/org/repo/pull/42?token=secret#discussion",
    ),
    "https://example.test/org/repo/pull/42",
  );
});

it("requires each change-request capability flag and its methods", () => {
  const base = {
    kind: "github" as const,
  } as SourceControlProvider["Service"];
  const getChangeRequestMergeOptions = () =>
    Effect.succeed({ methods: ["merge"] as const, defaultMethod: "merge" as const });
  const mergeChangeRequest = () => Effect.void;
  const setAutoMerge = () => Effect.void;
  const updateChangeRequestState = () => Effect.void;
  const listCheckDetails = () => Effect.succeed([]);
  const getChangeRequestConversation = () =>
    Effect.succeed({
      number: 42,
      state: "open" as const,
      headRefName: "feature/test",
      isCrossRepository: false,
      additions: 1,
      deletions: 0,
      reviewers: [],
      description: { author: null, body: "", createdAt: null, url: "" },
      comments: [],
      commentsTruncated: false,
      reviewThreads: [],
      reviewThreadsTruncated: false,
    });
  const addChangeRequestComment = () => Effect.void;
  const replyToChangeRequestThread = () => Effect.void;
  const setChangeRequestThreadResolved = () => Effect.void;
  const listChangeRequestCommits = () =>
    Effect.succeed({ number: 42, headOid: null, commits: [], truncated: false });
  const deleteChangeRequestRemoteBranch = () =>
    Effect.succeed({ branch: "feature/test", remote: "deleted" as const });

  assert.strictEqual(
    supportsChangeRequestMerge({
      ...base,
      capabilities: { merge: true },
      getChangeRequestMergeOptions,
      mergeChangeRequest,
    }),
    true,
  );
  assert.strictEqual(
    supportsChangeRequestMerge({
      ...base,
      capabilities: { merge: true },
      mergeChangeRequest,
    }),
    false,
  );
  assert.strictEqual(
    supportsChangeRequestAutoMerge({
      ...base,
      capabilities: { autoMerge: true },
      setAutoMerge,
    }),
    true,
  );
  assert.strictEqual(
    supportsChangeRequestStateUpdate({
      ...base,
      capabilities: { changeRequestState: true },
      updateChangeRequestState,
    }),
    true,
  );
  assert.strictEqual(
    supportsChangeRequestAutoMerge({
      ...base,
      capabilities: { autoMerge: true },
    }),
    false,
  );
  assert.strictEqual(
    supportsChangeRequestStateUpdate({
      ...base,
      capabilities: { changeRequestState: true },
    }),
    false,
  );
  assert.strictEqual(
    supportsChangeRequestCheckDetails({
      ...base,
      capabilities: { checkDetails: true },
      listCheckDetails,
    }),
    true,
  );
  assert.strictEqual(
    supportsChangeRequestCheckDetails({
      ...base,
      capabilities: { checkDetails: true },
    }),
    false,
  );
  assert.strictEqual(
    supportsChangeRequestConversation({
      ...base,
      capabilities: { conversation: true },
      getChangeRequestConversation,
      addChangeRequestComment,
      replyToChangeRequestThread,
      setChangeRequestThreadResolved,
    }),
    true,
  );
  assert.strictEqual(
    supportsChangeRequestConversation({
      ...base,
      capabilities: { conversation: true },
      getChangeRequestConversation,
      addChangeRequestComment,
      replyToChangeRequestThread,
    }),
    false,
  );
  assert.strictEqual(
    supportsChangeRequestCommits({
      ...base,
      capabilities: { commits: true },
      listChangeRequestCommits,
    }),
    true,
  );
  assert.strictEqual(
    supportsChangeRequestCommits({ ...base, capabilities: { commits: true } }),
    false,
  );
  assert.strictEqual(
    supportsChangeRequestBranchDelete({
      ...base,
      capabilities: { branchDelete: true },
      deleteChangeRequestRemoteBranch,
    }),
    true,
  );
  assert.strictEqual(
    supportsChangeRequestBranchDelete({ ...base, capabilities: { branchDelete: true } }),
    false,
  );
});

it("normalizes control characters and bounds error transport values", () => {
  assert.strictEqual(
    transportSafeSourceControlErrorValue(`  owner/repo\n\t${"x".repeat(300)}  `),
    `owner/repo ${"x".repeat(245)}`,
  );
});

it("requires both the checks capability and method", () => {
  const base = {
    kind: "github" as const,
  } as SourceControlProvider["Service"];
  const listChecks = () => Effect.succeed("success" as const);

  assert.strictEqual(
    supportsChangeRequestChecks({
      ...base,
      capabilities: { checks: true },
      listChecks,
    }),
    true,
  );
  assert.strictEqual(
    supportsChangeRequestChecks({
      ...base,
      capabilities: { checks: false },
      listChecks,
    }),
    false,
  );
  assert.strictEqual(
    supportsChangeRequestChecks({
      ...base,
      capabilities: { checks: true },
    }),
    false,
  );
});

it("keeps aggregate checks support separate from per-check detail support", () => {
  const base = { kind: "github" as const } as SourceControlProvider["Service"];
  const listCheckDetails = () => Effect.succeed([]);

  assert.strictEqual(
    supportsChangeRequestCheckDetails({
      ...base,
      capabilities: { checks: true },
      listCheckDetails,
    }),
    false,
  );
  assert.strictEqual(
    supportsChangeRequestCheckDetails({
      ...base,
      capabilities: { checkDetails: true },
      listCheckDetails,
    }),
    true,
  );
});
