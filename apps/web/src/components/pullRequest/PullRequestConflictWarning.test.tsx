import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { PullRequestConflictWarning } from "./PullRequestConflictWarning";

describe("PullRequestConflictWarning", () => {
  it("renders an assertive, high-signal conflict warning", () => {
    const markup = renderToStaticMarkup(<PullRequestConflictWarning baseRef="main" />);

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Merge conflicts");
    expect(markup).toContain("main");
    expect(markup).toContain("text-destructive");
  });
});
