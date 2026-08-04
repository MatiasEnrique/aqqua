import { ProviderInstanceId } from "@aqqua/contracts";
import { describe, expect, it } from "@effect/vitest";

import { normalizeClaudeOauthUsage } from "./ClaudeUsageFetcher.ts";

const INSTANCE_ID = ProviderInstanceId.make("claudeAgent");
const CAPTURED_AT = "2026-08-04T12:00:00.000Z";

describe("normalizeClaudeOauthUsage", () => {
  it("maps the live endpoint shape to windows with 0-100 percentages", () => {
    // Trimmed from a real GET /api/oauth/usage response.
    const snapshot = normalizeClaudeOauthUsage(
      {
        five_hour: {
          utilization: 88.0,
          resets_at: "2026-08-04T22:19:59.589116+00:00",
          limit_dollars: null,
        },
        seven_day: {
          utilization: 13.0,
          resets_at: "2026-08-11T07:59:59.589135+00:00",
        },
        seven_day_opus: null,
        seven_day_sonnet: null,
        tangelo: null,
        extra_usage: { is_enabled: false },
      },
      { providerInstanceId: INSTANCE_ID, capturedAt: CAPTURED_AT },
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot?.windows).toEqual([
      {
        kind: "five-hour",
        usedPercent: 88,
        resetsAt: Math.round(Date.parse("2026-08-04T22:19:59.589116+00:00") / 1_000),
        windowMinutes: 300,
      },
      {
        kind: "weekly",
        usedPercent: 13,
        resetsAt: Math.round(Date.parse("2026-08-11T07:59:59.589135+00:00") / 1_000),
        windowMinutes: 10_080,
      },
    ]);
    expect(snapshot?.provider).toBe("claudeAgent");
  });

  it("prefers structured limits and surfaces the Fable-scoped weekly quota", () => {
    // Trimmed from a real response: model quotas live in `limits`, not the
    // legacy top-level fields.
    const snapshot = normalizeClaudeOauthUsage(
      {
        five_hour: { utilization: 88, resets_at: "2026-08-04T22:19:59+00:00" },
        seven_day: { utilization: 13, resets_at: "2026-08-11T07:59:59+00:00" },
        limits: [
          {
            kind: "session",
            group: "session",
            percent: 93,
            severity: "critical",
            resets_at: "2026-08-04T22:20:00.436336+00:00",
            scope: null,
            is_active: true,
          },
          {
            kind: "weekly_all",
            group: "weekly",
            percent: 14,
            resets_at: "2026-08-11T08:00:00.436356+00:00",
            scope: null,
            is_active: false,
          },
          {
            kind: "weekly_scoped",
            group: "weekly",
            percent: 21,
            resets_at: "2026-08-11T07:59:59.436604+00:00",
            scope: { model: { id: null, display_name: "Fable" }, surface: null },
            is_active: false,
          },
        ],
      },
      { providerInstanceId: INSTANCE_ID, capturedAt: CAPTURED_AT },
    );

    const byKind = new Map(snapshot?.windows.map((window) => [window.kind, window]));
    // Structured limits win over the legacy fields for shared windows.
    expect(byKind.get("five-hour")?.usedPercent).toBe(93);
    expect(byKind.get("weekly")?.usedPercent).toBe(14);
    expect(byKind.get("weekly-fable")?.usedPercent).toBe(21);
    expect(byKind.get("weekly-fable")?.windowMinutes).toBe(10_080);
    expect(snapshot?.windows).toHaveLength(3);
  });

  it("returns null for unrecognizable payloads and window-less responses", () => {
    expect(
      normalizeClaudeOauthUsage("nope", {
        providerInstanceId: INSTANCE_ID,
        capturedAt: CAPTURED_AT,
      }),
    ).toBeNull();
    expect(
      normalizeClaudeOauthUsage(
        { five_hour: null, seven_day: null },
        { providerInstanceId: INSTANCE_ID, capturedAt: CAPTURED_AT },
      ),
    ).toBeNull();
  });
});
