import { assert, it } from "@effect/vitest";

import * as Effect from "effect/Effect";

import {
  supportsChangeRequestChecks,
  supportsChangeRequestCheckDetails,
  supportsChangeRequestAutoMerge,
  supportsChangeRequestMerge,
  supportsChangeRequestStateUpdate,
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
