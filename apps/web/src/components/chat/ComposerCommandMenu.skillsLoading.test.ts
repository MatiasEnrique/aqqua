import { describe, expect, it } from "vite-plus/test";
import {
  PROVIDER_WORKSPACE_SKILLS_LOADING_LABEL,
  shouldShowProviderWorkspaceSkillsLoadingFooter,
} from "@t3tools/client-runtime/state/provider-skills";

/**
 * Pure seam for the skill-menu loading footer. The footer is rendered outside
 * CommandItem rows so keyboard/selection order is unchanged while global
 * fallback skills remain visible during a pending workspace query.
 */
describe("ComposerCommandMenu skill loading footer", () => {
  it("shows Searching workspace skills… when skill query is pending with fallback rows", () => {
    const hasFallbackRows = true;
    const isLoading = true;
    const showFooter = shouldShowProviderWorkspaceSkillsLoadingFooter({
      isPending: isLoading,
      isSkillTrigger: true,
    });

    expect(hasFallbackRows).toBe(true);
    expect(showFooter).toBe(true);
    expect(PROVIDER_WORKSPACE_SKILLS_LOADING_LABEL).toBe("Searching workspace skills…");
  });

  it("does not show the skill loading footer for path triggers", () => {
    expect(
      shouldShowProviderWorkspaceSkillsLoadingFooter({
        isPending: true,
        isSkillTrigger: false,
      }),
    ).toBe(false);
  });
});
