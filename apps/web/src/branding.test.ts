import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  resolveServerBackedAppDisplayName,
  resolveServerBackedAppStageLabel,
} from "./branding.logic";

const originalWindow = globalThis.window;

afterEach(() => {
  vi.resetModules();

  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
    return;
  }

  globalThis.window = originalWindow;
});

describe("branding", () => {
  it("uses injected desktop branding when available", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        desktopBridge: {
          getAppBranding: () => ({
            baseName: "Aqqua",
            stageLabel: "Sigma",
            displayName: "Aqqua (Sigma)",
          }),
        },
      },
    });

    const branding = await import("./branding");

    expect(branding.APP_BASE_NAME).toBe("Aqqua");
    expect(branding.APP_STAGE_LABEL).toBe("Sigma");
    expect(branding.APP_DISPLAY_NAME).toBe("Aqqua (Sigma)");
  });

  it("ignores retired hosted app channel metadata", async () => {
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "nightly");

    const branding = await import("./branding");

    expect(branding.HOSTED_APP_CHANNEL).toBeNull();
    expect(branding.HOSTED_APP_CHANNEL_LABEL).toBeNull();
    expect(branding.APP_STAGE_LABEL).toBe("Dev");
    expect(branding.APP_DISPLAY_NAME).toBe("Aqqua (Dev)");
  });

  it("does not label the latest hosted app channel", async () => {
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "latest");

    const branding = await import("./branding");

    expect(branding.HOSTED_APP_CHANNEL).toBe("latest");
    expect(branding.HOSTED_APP_CHANNEL_LABEL).toBe("Latest");
    expect(branding.APP_STAGE_LABEL).toBe("Latest");
    expect(branding.APP_DISPLAY_NAME).toBe("Aqqua");
  });

  it("ignores unknown hosted app channels", async () => {
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "preview");

    const branding = await import("./branding");

    expect(branding.HOSTED_APP_CHANNEL).toBeNull();
    expect(branding.HOSTED_APP_CHANNEL_LABEL).toBeNull();
  });
});

describe("branding logic", () => {
  it("keeps the fallback stage for legacy Nightly primary server versions", () => {
    expect(
      resolveServerBackedAppStageLabel({
        primaryServerVersion: "0.0.28-nightly.20260616.12",
        fallbackStageLabel: "Alpha",
      }),
    ).toBe("Alpha");
  });

  it("keeps the fallback display name for legacy Nightly primary server versions", () => {
    expect(
      resolveServerBackedAppDisplayName({
        baseName: "Aqqua",
        fallbackDisplayName: "Aqqua (Alpha)",
        fallbackStageLabel: "Alpha",
        primaryServerVersion: "0.0.28-nightly.20260616.12",
      }),
    ).toBe("Aqqua (Alpha)");
  });

  it("keeps the fallback display name for stable primary server versions", () => {
    expect(
      resolveServerBackedAppDisplayName({
        baseName: "Aqqua",
        fallbackDisplayName: "Aqqua (Alpha)",
        fallbackStageLabel: "Alpha",
        primaryServerVersion: "0.0.27",
      }),
    ).toBe("Aqqua (Alpha)");
  });

  it("keeps the fallback display name for malformed legacy Nightly versions", () => {
    expect(
      resolveServerBackedAppDisplayName({
        baseName: "Aqqua",
        fallbackDisplayName: "Aqqua (Alpha)",
        fallbackStageLabel: "Alpha",
        primaryServerVersion: "0.0.28-nightly.20260616",
      }),
    ).toBe("Aqqua (Alpha)");
  });
});
