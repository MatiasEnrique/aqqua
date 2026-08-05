import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ChangeRequestChecksBadge } from "./ChangeRequestChecksBadge";

describe("ChangeRequestChecksBadge", () => {
  it.each([
    ["pending", "Pending"],
    ["success", "Passing"],
    ["failure", "Failing"],
    [null, "Not reported"],
  ] as const)("renders %s checks without a continuous animation", (status, label) => {
    const markup = renderToStaticMarkup(<ChangeRequestChecksBadge status={status} />);

    expect(markup).toContain(`Pull request checks: ${label}`);
    expect(markup).toContain(label);
    expect(markup).not.toContain("animate-spin");
  });
});
