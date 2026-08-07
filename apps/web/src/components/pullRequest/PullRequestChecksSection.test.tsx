import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { PullRequestChecksSection } from "./PullRequestChecksSection";

describe("PullRequestChecksSection", () => {
  it("reserves the details-link column when a check has no URL", () => {
    const markup = renderToStaticMarkup(
      <PullRequestChecksSection
        query={{
          data: {
            supported: true,
            checks: [
              {
                name: "Linked check",
                status: "success",
                detailsUrl: "https://example.test/checks/1",
              },
              { name: "Pending check", status: "pending" },
            ],
          },
          error: null,
          isPending: false,
          refresh: async () => undefined,
          refreshData: async () => null,
        }}
      />,
    );

    expect(markup).toContain('aria-label="Open details for Linked check"');
    expect(markup).toContain('aria-hidden="true" class="size-[22px] shrink-0"');
  });
});
