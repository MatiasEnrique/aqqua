import { describe, expect, it } from "@effect/vitest";

import {
  IMAGE_ONLY_BOOTSTRAP_PROMPT,
  queuedMessagePreview,
  resolveComposerPrimaryActions,
} from "./composerQueuePresentation";

describe("queued message preview", () => {
  it("shows queued message text", () => {
    expect(queuedMessagePreview({ text: "Run the focused tests", attachmentCount: 0 })).toBe(
      "Run the focused tests",
    );
  });

  it("describes an image-only queued message", () => {
    expect(queuedMessagePreview({ text: "", attachmentCount: 1 })).toBe("1 image");
    expect(queuedMessagePreview({ text: "   ", attachmentCount: 3 })).toBe("3 images");
  });

  it("does not expose the internal image-only bootstrap prompt", () => {
    expect(queuedMessagePreview({ text: IMAGE_ONLY_BOOTSTRAP_PROMPT, attachmentCount: 1 })).toBe(
      "1 image",
    );
  });
});

describe("composer primary actions", () => {
  const base = {
    turnRunning: false,
    threadBusy: false,
    messageQueueSupported: true,
    hasSendableContent: true,
  };

  it("offers send only while the thread is idle", () => {
    expect(resolveComposerPrimaryActions(base)).toMatchObject({
      showStop: false,
      sendLabel: "Send",
      deliveryMode: "steer",
    });
  });

  it("makes the primary action queue while a supported turn runs", () => {
    expect(
      resolveComposerPrimaryActions({ ...base, turnRunning: true, threadBusy: true }),
    ).toMatchObject({
      showStop: true,
      sendLabel: "Queue message",
      deliveryMode: "queue",
    });
  });

  it("falls back to steering when the server cannot queue messages", () => {
    expect(
      resolveComposerPrimaryActions({
        ...base,
        turnRunning: true,
        threadBusy: true,
        messageQueueSupported: false,
      }),
    ).toMatchObject({
      showStop: true,
      sendLabel: "Steer conversation",
      deliveryMode: "steer",
    });
  });

  it("queues whenever the thread is busy, even before the session reports running", () => {
    expect(resolveComposerPrimaryActions({ ...base, threadBusy: true })).toMatchObject({
      showStop: false,
      sendLabel: "Queue message",
      deliveryMode: "queue",
    });
  });

  it("disables the submit path without sendable content", () => {
    expect(
      resolveComposerPrimaryActions({
        ...base,
        turnRunning: true,
        hasSendableContent: false,
      }),
    ).toMatchObject({ sendDisabled: true });
  });
});
