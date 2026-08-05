import { ProviderExternalSession } from "@aqqua/contracts";
import * as Schema from "effect/Schema";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { ComposerResumePicker } from "./ComposerResumePicker";

const session = Schema.decodeUnknownSync(ProviderExternalSession)({
  sessionId: "codex-cli-thread",
  title: "Earlier Codex work",
  cwd: "/repo/.aqqua/worktrees/feature",
  updatedAt: "2026-08-04T12:00:00.000Z",
  messageCount: 0,
});

describe("ComposerResumePicker", () => {
  it("groups sessions by provider, shows non-root cwd, and hides unknown zero counts", () => {
    const markup = renderToStaticMarkup(
      <ComposerResumePicker
        sessions={[session]}
        supported
        isPending={false}
        error={null}
        providerLabel="Codex"
        projectRoot="/repo"
        onSelect={vi.fn()}
        onRequestClose={vi.fn()}
      />,
    );

    expect(markup).toContain("Codex");
    expect(markup).toContain("Earlier Codex work");
    expect(markup).toContain("/repo/.aqqua/worktrees/feature");
    expect(markup).not.toContain("0 messages");
  });
});
