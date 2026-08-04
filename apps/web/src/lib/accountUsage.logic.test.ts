import type { AccountRateLimitsSnapshot } from "@aqqua/contracts";
import { ProviderDriverKind, ProviderInstanceId } from "@aqqua/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  formatRateLimitWindowLabel,
  formatResetCountdown,
  formatUsagePercent,
  getUsageTone,
  normalizeUsagePercent,
  resolveAccountUsagePresentation,
  selectMostConstrainedWindow,
} from "./accountUsage.logic";

const snapshot = (
  overrides: Partial<AccountRateLimitsSnapshot> = {},
): AccountRateLimitsSnapshot => ({
  providerInstanceId: ProviderInstanceId.make("codex-work"),
  provider: ProviderDriverKind.make("codex"),
  planLabel: "pro",
  credits: null,
  windows: [],
  status: null,
  capturedAt: "2026-08-04T12:00:00.000Z",
  ...overrides,
});

describe("account usage presentation", () => {
  it("clamps finite percentages and rejects values that cannot be displayed", () => {
    expect(normalizeUsagePercent(-4)).toBe(0);
    expect(normalizeUsagePercent(34.44)).toBe(34.44);
    expect(normalizeUsagePercent(140)).toBe(100);
    expect(normalizeUsagePercent(Number.NaN)).toBeNull();
    expect(formatUsagePercent(9.94)).toBe("9.9%");
    expect(formatUsagePercent(34.44)).toBe("34%");
  });

  it("uses warning at 70 percent and critical at 90 percent", () => {
    expect(getUsageTone(69.99)).toBe("ok");
    expect(getUsageTone(70)).toBe("warn");
    expect(getUsageTone(89.99)).toBe("warn");
    expect(getUsageTone(90)).toBe("critical");
  });

  it("formats reset countdowns from an injected clock", () => {
    const now = 1_800_000_000_000;
    expect(formatResetCountdown(null, now)).toBe("Reset time unavailable");
    expect(formatResetCountdown(1_800_000_000, now)).toBe("Resetting now");
    expect(formatResetCountdown(1_800_000_045, now)).toBe("Resets in 45s");
    expect(formatResetCountdown(1_800_003_900, now)).toBe("Resets in 1h 5m");
    expect(formatResetCountdown(1_800_183_600, now)).toBe("Resets in 2d 3h");
  });

  it("headlines the valid window with the highest utilization", () => {
    const selected = selectMostConstrainedWindow([
      { kind: "weekly", usedPercent: 45, resetsAt: null, windowMinutes: 10_080 },
      { kind: "five-hour", usedPercent: 72, resetsAt: null, windowMinutes: 300 },
      { kind: "overage", usedPercent: Number.NaN, resetsAt: null, windowMinutes: null },
    ]);

    expect(selected?.kind).toBe("five-hour");
    expect(formatRateLimitWindowLabel(selected!.kind)).toBe("5h");
  });

  it("prefers the shorter window when utilization is tied", () => {
    const selected = selectMostConstrainedWindow([
      { kind: "weekly", usedPercent: 70, resetsAt: null, windowMinutes: 10_080 },
      { kind: "five-hour", usedPercent: 70, resetsAt: null, windowMinutes: 300 },
    ]);

    expect(selected?.kind).toBe("five-hour");
  });

  it("distinguishes unsupported, pending, and ready provider states", () => {
    expect(
      resolveAccountUsagePresentation({
        provider: ProviderDriverKind.make("cursor"),
        providerInstanceId: ProviderInstanceId.make("cursor"),
        snapshots: [],
      }),
    ).toEqual({ state: "unsupported" });

    expect(
      resolveAccountUsagePresentation({
        provider: ProviderDriverKind.make("claudeAgent"),
        providerInstanceId: ProviderInstanceId.make("claudeAgent"),
        snapshots: [],
      }),
    ).toEqual({ state: "pending" });

    const current = snapshot({
      windows: [
        { kind: "weekly", usedPercent: 91, resetsAt: 1_800_000_000, windowMinutes: 10_080 },
      ],
    });
    expect(
      resolveAccountUsagePresentation({
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: ProviderInstanceId.make("codex-work"),
        snapshots: [current],
      }),
    ).toEqual({ state: "ready", snapshot: current, headline: current.windows[0] });
  });

  it("treats unknown drivers as unsupported", () => {
    expect(
      resolveAccountUsagePresentation({
        provider: ProviderDriverKind.make("custom-driver"),
        providerInstanceId: ProviderInstanceId.make("custom-driver"),
        snapshots: [],
      }),
    ).toEqual({ state: "unsupported" });
  });
});
