import type { OrchestrationQueuedMessage } from "@aqqua/contracts";
import { describe, expect, it } from "vite-plus/test";

import { queuedMessagePreview } from "./ComposerMessageQueue";
import { IMAGE_ONLY_BOOTSTRAP_PROMPT } from "../ChatView.logic";

const queuedMessage = (overrides: Partial<OrchestrationQueuedMessage> = {}) =>
  ({
    messageId: "msg-queued",
    text: "Run the focused tests",
    attachments: [],
    modelSelection: { instanceId: "codex", model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    createdAt: "2026-08-06T00:00:00.000Z",
    ...overrides,
  }) as OrchestrationQueuedMessage;

describe("queuedMessagePreview", () => {
  it("shows queued message text", () => {
    expect(queuedMessagePreview(queuedMessage())).toBe("Run the focused tests");
  });

  it("describes an image-only queued message", () => {
    expect(
      queuedMessagePreview(
        queuedMessage({
          text: "",
          attachments: [
            {
              type: "image",
              id: "image-1",
              name: "screen.png",
              mimeType: "image/png",
              sizeBytes: 42,
            },
          ],
        }),
      ),
    ).toBe("1 image");
  });

  it("does not expose the internal image-only bootstrap prompt", () => {
    expect(
      queuedMessagePreview(
        queuedMessage({
          text: IMAGE_ONLY_BOOTSTRAP_PROMPT,
          attachments: [
            {
              type: "image",
              id: "image-1",
              name: "screen.png",
              mimeType: "image/png",
              sizeBytes: 42,
            },
          ],
        }),
      ),
    ).toBe("1 image");
  });
});
