import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { SidebarStateCounters } from "./SidebarStatusPresentations";

describe("SidebarStateCounters", () => {
  it("renders every non-zero family state in one summary", () => {
    const markup = renderToStaticMarkup(
      <SidebarStateCounters
        counts={{ working: 2, needsInput: 1, done: 1, stale: 0, settled: 0 }}
      />,
    );

    expect(markup).toContain(
      'aria-label="2 working conversations, 1 needs input conversation, 1 done conversation"',
    );
    expect(markup).toContain("text-sky-600");
    expect(markup).toContain("text-amber-600");
    expect(markup).toContain("text-emerald-600");
  });
});
