import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_MODEL_BY_PROVIDER, PROVIDER_DISPLAY_NAMES } from "./model.ts";
import { ProviderDriverKind } from "./providerInstance.ts";

describe("pi provider model metadata", () => {
  const piDriverKind = ProviderDriverKind.make("pi");

  it("uses pi's lowercase product name", () => {
    expect(PROVIDER_DISPLAY_NAMES[piDriverKind]).toBe("pi");
  });

  it("provides pi's default model slug", () => {
    expect(DEFAULT_MODEL_BY_PROVIDER[piDriverKind]).toBe("anthropic/claude-sonnet-5");
  });
});
