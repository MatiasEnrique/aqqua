import { describe, expect, it } from "vite-plus/test";

import { conversationStatePresentation } from "./conversationStatePresentation";

describe("conversationStatePresentation", () => {
  it("presents settled conversations in yellow", () => {
    expect(conversationStatePresentation("settled").className).toBe(
      "text-yellow-600 dark:text-yellow-300",
    );
  });
});
