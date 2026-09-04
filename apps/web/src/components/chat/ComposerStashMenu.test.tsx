import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import type { PromptStashEntry } from "../../promptStashStore";
import { ComposerStashMenu } from "./ComposerStashMenu";

describe("ComposerStashMenu", () => {
  it("does not render a file attachment as an image based only on its MIME type", () => {
    const fileWithImageMime = {
      type: "file" as const,
      id: "file-1",
      name: "raw-pixels.png",
      mimeType: "image/png",
      sizeBytes: 4,
      dataUrl: "data:image/png;base64,dGVzdA==",
    };
    const entry = {
      id: "stash-1",
      createdAt: "2026-09-04T00:00:00.000Z",
      prompt: "",
      attachments: [fileWithImageMime],
      droppedImageNames: [],
      unreadableImageNames: [],
      pendingImageCount: 0,
    } satisfies PromptStashEntry;

    const markup = renderToStaticMarkup(
      <ComposerStashMenu
        entries={[entry]}
        onRestore={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(markup).not.toContain("<img");
    expect(markup).toContain("(1 attachment)");
  });
});
