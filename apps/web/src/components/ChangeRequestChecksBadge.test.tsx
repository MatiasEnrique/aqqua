import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ChangeRequestChecksBadge } from "./ChangeRequestChecksBadge";

describe("ChangeRequestChecksBadge", () => {
  it.each([
    ["success", "Passing"],
    ["failure", "Failing"],
    [null, "Not reported"],
  ] as const)("renders %s checks without a continuous animation", (status, label) => {
    const markup = renderToStaticMarkup(<ChangeRequestChecksBadge status={status} />);

    expect(markup).toContain(`Pull request checks: ${label}`);
    expect(markup).toContain(label);
    expect(markup).not.toContain("animate-spin");
    expect(markup).not.toContain("animate-aqqua-ring-dot");
  });

  it("renders pending checks with the breathing running-state loader", () => {
    const markup = renderToStaticMarkup(<ChangeRequestChecksBadge status="pending" />);

    expect(markup).toContain("Pull request checks: Pending");
    expect(markup).toContain("animate-aqqua-ring-dot");
    expect(markup).not.toContain("animate-spin");
  });
});
