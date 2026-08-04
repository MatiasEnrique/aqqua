import { expect, it } from "@effect/vitest";

import {
  renderLoopbackAuthorizationCompleteHtml,
  resolveLoopbackAuthorizationStage,
} from "./cliAuthHtml.ts";

it("renders the branded loopback authorization completion page", () => {
  const html = renderLoopbackAuthorizationCompleteHtml();

  expect(resolveLoopbackAuthorizationStage()).toBe("dev");
  expect(html).toContain("Aqqua (Dev)");
  expect(html).toContain('class="stage stage-dev"');
  expect(html).not.toContain("Secure terminal handoff");
  expect(html).toContain("You're connected");
  expect(html).toContain("Return to your terminal");
  expect(html).not.toContain('class="next"');
  expect(html).toContain('name="viewport"');
  expect(html).not.toContain('class="status"');
});

it("renders the matching header treatment for the release channel", () => {
  const latest = renderLoopbackAuthorizationCompleteHtml("latest");

  expect(latest).toContain('<p class="brand">Aqqua</p>');
  expect(latest).not.toContain("(Latest)");
  expect(latest).toContain('class="stage stage-latest"');
});
