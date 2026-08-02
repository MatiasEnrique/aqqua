import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ThreadErrorBanner } from "./ThreadErrorBanner";

describe("ThreadErrorBanner", () => {
  it("renders nothing without an error", () => {
    const markup = renderToStaticMarkup(<ThreadErrorBanner error={null} onDismiss={() => {}} />);
    expect(markup).toBe("");
  });

  it("renders a controlled accessible dismiss control when an error is present", () => {
    const markup = renderToStaticMarkup(
      <ThreadErrorBanner
        error="The aqqua server restarted while this turn was running."
        onDismiss={() => {}}
      />,
    );

    expect(markup).toContain('aria-label="Dismiss error"');
    expect(markup).toContain("The aqqua server restarted while this turn was running.");
  });

  it("omits the dismiss control when onDismiss is not provided", () => {
    const markup = renderToStaticMarkup(<ThreadErrorBanner error="Something went wrong." />);

    expect(markup).toContain("Something went wrong.");
    expect(markup).not.toContain('aria-label="Dismiss error"');
  });
});
