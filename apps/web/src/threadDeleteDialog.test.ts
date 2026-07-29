import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  completeThreadDeleteDialogClose,
  readThreadDeleteDialogState,
  requestThreadDeleteConfirmation,
  resetThreadDeleteDialogForTests,
  respondToThreadDeleteConfirmation,
  ThreadDeleteConfirmationConflictError,
} from "./threadDeleteDialog";

const request = {
  title: "Feature work",
  threadCount: 1,
  candidates: [],
  hasUnverifiableWorktrees: false,
} as const;

describe("thread delete dialog coordinator", () => {
  beforeEach(() => {
    resetThreadDeleteDialogForTests();
  });

  it("resolves cancellation without a deletion decision", async () => {
    const confirmation = requestThreadDeleteConfirmation(request);

    respondToThreadDeleteConfirmation(null);

    await expect(confirmation).resolves.toBeNull();
    expect(readThreadDeleteDialogState().status).toBe("closing");
    completeThreadDeleteDialogClose();
    expect(readThreadDeleteDialogState()).toEqual({ status: "idle" });
  });

  it("returns the explicit cleanup decision", async () => {
    const confirmation = requestThreadDeleteConfirmation(request);
    const decision = {
      deleteWorktrees: true,
      selectionSource: "explicit",
      inspections: {},
    } as const;

    respondToThreadDeleteConfirmation(decision);

    await expect(confirmation).resolves.toEqual(decision);
  });

  it("rejects a concurrent request without replacing the active dialog", async () => {
    const first = requestThreadDeleteConfirmation(request);

    await expect(
      requestThreadDeleteConfirmation({ ...request, title: "Other thread" }),
    ).rejects.toBeInstanceOf(ThreadDeleteConfirmationConflictError);
    expect(readThreadDeleteDialogState()).toMatchObject({
      status: "confirming",
      request: { title: "Feature work" },
    });

    respondToThreadDeleteConfirmation(null);
    await expect(first).resolves.toBeNull();
  });
});
