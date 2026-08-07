import { describe, expect, it } from "vite-plus/test";

import {
  formatPendingPrimaryActionLabel,
  resolveRunningComposerActions,
} from "./ComposerPrimaryActions";

describe("resolveRunningComposerActions", () => {
  it("keeps steer and queue available while a turn is running", () => {
    expect(
      resolveRunningComposerActions({
        messageQueueSupported: true,
        hasSendableContent: true,
        isSendBusy: false,
        isConnecting: false,
        isEnvironmentUnavailable: false,
        sendDisabledReason: null,
      }),
    ).toEqual({
      queueDisabled: false,
      steerDisabled: false,
    });
  });

  it("disables both message actions without sendable content", () => {
    expect(
      resolveRunningComposerActions({
        messageQueueSupported: true,
        hasSendableContent: false,
        isSendBusy: false,
        isConnecting: false,
        isEnvironmentUnavailable: false,
        sendDisabledReason: null,
      }),
    ).toEqual({
      queueDisabled: true,
      steerDisabled: true,
    });
  });

  it("keeps steering available when an older server does not advertise the queue", () => {
    expect(
      resolveRunningComposerActions({
        messageQueueSupported: false,
        hasSendableContent: true,
        isSendBusy: false,
        isConnecting: false,
        isEnvironmentUnavailable: false,
        sendDisabledReason: null,
      }),
    ).toEqual({
      queueDisabled: true,
      steerDisabled: false,
    });
  });
});

describe("formatPendingPrimaryActionLabel", () => {
  it("returns 'Submitting...' while responding", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: false,
        isResponding: true,
        questionIndex: 0,
      }),
    ).toBe("Submitting...");
  });

  it("returns 'Submitting...' while responding regardless of other flags", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: true,
        isLastQuestion: true,
        isResponding: true,
        questionIndex: 3,
      }),
    ).toBe("Submitting...");
  });

  it("returns 'Submit' in compact mode on the last question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: true,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 0,
      }),
    ).toBe("Submit");
  });

  it("returns 'Next' in compact mode when not the last question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: true,
        isLastQuestion: false,
        isResponding: false,
        questionIndex: 1,
      }),
    ).toBe("Next");
  });

  it("returns 'Next question' when not the last question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: false,
        isResponding: false,
        questionIndex: 0,
      }),
    ).toBe("Next question");
  });

  it("returns singular 'Submit answer' on the last question when it is the only question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 0,
      }),
    ).toBe("Submit answer");
  });

  it("returns plural 'Submit answers' on the last question when there are multiple questions", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 1,
      }),
    ).toBe("Submit answers");
  });

  it("returns plural 'Submit answers' for higher question indices", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 5,
      }),
    ).toBe("Submit answers");
  });
});
