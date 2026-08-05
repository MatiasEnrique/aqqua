import { describe, expect, it } from "vite-plus/test";

import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";

import { reportBoardCommandResult } from "./boardCommandFeedback";

describe("reportBoardCommandResult", () => {
  it("allows a flow dialog to close after a successful command", () => {
    expect(reportBoardCommandResult(AsyncResult.success(undefined), "Could not save")).toBe(true);
  });

  it("keeps the dialog open after a rejected or interrupted command", () => {
    expect(
      reportBoardCommandResult(
        AsyncResult.failure(Cause.fail(new Error("Flow does not exist"))),
        "Could not save",
      ),
    ).toBe(false);
    expect(
      reportBoardCommandResult(AsyncResult.failure(Cause.interrupt(1)), "Could not save"),
    ).toBe(false);
  });
});
