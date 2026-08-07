import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { StatusIndicator } from "./StatusIndicator";

describe("StatusIndicator", () => {
  it("uses one low-repaint dot for live status", () => {
    const markup = renderToStaticMarkup(
      <StatusIndicator state="working" label="Working" size="size-2" showLabel />,
    );

    expect(markup).toContain('aria-label="Working"');
    expect(markup).toContain("animate-status-pulse");
    expect(markup).toContain("size-2");
    expect(markup).not.toContain("animate-spin");
    expect(markup).not.toContain("aqqua-ring");
  });

  it("keeps final states still", () => {
    const markup = renderToStaticMarkup(<StatusIndicator state="done" />);

    expect(markup).toContain("text-emerald-600");
    expect(markup).not.toContain("animate-status-pulse");
  });

  it("owns pulse behavior for non-conversation glyphs too", () => {
    const markup = renderToStaticMarkup(
      <StatusIndicator label="Terminal running" pulse glyph={<svg data-terminal="" />} />,
    );

    expect(markup).toContain('aria-label="Terminal running"');
    expect(markup).toContain("animate-status-pulse");
    expect(markup).toContain("data-terminal");
  });
});
