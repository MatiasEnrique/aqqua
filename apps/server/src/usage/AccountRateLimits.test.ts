import {
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type AccountRateLimitsSnapshot,
  type ProviderRuntimeEvent,
} from "@aqqua/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import { normalizeClaudeRateLimits } from "../provider/Layers/ClaudeAdapter.ts";
import { normalizeCodexRateLimits } from "../provider/Layers/CodexAdapter.ts";
import { AccountRateLimits } from "./AccountRateLimits.ts";

const THREAD_ID = ThreadId.make("thread-1");
const CAPTURED_AT = "2026-08-04T12:00:00.000Z";

function rateLimitsEvent(
  snapshot: AccountRateLimitsSnapshot,
  options?: { readonly eventId?: string; readonly providerInstanceId?: ProviderInstanceId },
): Extract<ProviderRuntimeEvent, { type: "account.rate-limits.updated" }> {
  return {
    type: "account.rate-limits.updated",
    eventId: EventId.make(options?.eventId ?? "rate-limits-event"),
    provider: snapshot.provider,
    ...(options?.providerInstanceId ? { providerInstanceId: options.providerInstanceId } : {}),
    threadId: THREAD_ID,
    createdAt: snapshot.capturedAt,
    payload: { rateLimits: snapshot },
  };
}

describe("account rate-limit normalization", () => {
  it("normalizes Claude fractional utilization and window kinds", () => {
    const snapshot = normalizeClaudeRateLimits(
      {
        status: "allowed_warning",
        rateLimitType: "seven_day_sonnet",
        utilization: 0.42,
        resetsAt: 1_786_000_000,
      },
      {
        providerInstanceId: ProviderInstanceId.make("claude-work"),
        capturedAt: CAPTURED_AT,
      },
    );

    expect(snapshot).toEqual({
      providerInstanceId: "claude-work",
      provider: "claudeAgent",
      planLabel: null,
      credits: null,
      windows: [
        {
          kind: "weekly-sonnet",
          usedPercent: 42,
          resetsAt: 1_786_000_000,
          windowMinutes: 10_080,
        },
      ],
      status: "allowed_warning",
      capturedAt: CAPTURED_AT,
    });
  });

  it("accumulates Claude windows across single-window events", () => {
    const instanceId = ProviderInstanceId.make("claude-personal");
    const first = normalizeClaudeRateLimits(
      { status: "allowed", rateLimitType: "five_hour", utilization: 0.12, resetsAt: 1_786_000_000 },
      { providerInstanceId: instanceId, capturedAt: CAPTURED_AT },
    );
    const second = normalizeClaudeRateLimits(
      { status: "allowed", rateLimitType: "seven_day", utilization: 0.28, resetsAt: 1_786_500_000 },
      { providerInstanceId: instanceId, capturedAt: CAPTURED_AT, previousWindows: first.windows },
    );
    expect(second.windows.map((window) => window.kind)).toEqual(["five-hour", "weekly"]);

    const updated = normalizeClaudeRateLimits(
      { status: "allowed", rateLimitType: "five_hour", utilization: 0.5, resetsAt: 1_786_600_000 },
      { providerInstanceId: instanceId, capturedAt: CAPTURED_AT, previousWindows: second.windows },
    );
    expect(updated.windows).toHaveLength(2);
    expect(updated.windows.find((window) => window.kind === "five-hour")?.usedPercent).toBe(50);

    const statusOnly = normalizeClaudeRateLimits(
      { status: "allowed" },
      { providerInstanceId: instanceId, capturedAt: CAPTURED_AT, previousWindows: updated.windows },
    );
    expect(statusOnly.windows).toHaveLength(2);
  });

  it("keeps Claude windows that omit utilization (observed live payload)", () => {
    // Captured from a real `claude -p` run: no utilization field at all.
    const snapshot = normalizeClaudeRateLimits(
      {
        status: "allowed",
        resetsAt: 1_785_882_000,
        rateLimitType: "five_hour",
        overageStatus: "rejected",
        overageDisabledReason: "out_of_credits",
        isUsingOverage: false,
      },
      { providerInstanceId: ProviderInstanceId.make("claude-personal"), capturedAt: CAPTURED_AT },
    );
    expect(snapshot.windows).toEqual([
      {
        kind: "five-hour",
        usedPercent: null,
        resetsAt: 1_785_882_000,
        windowMinutes: 300,
      },
    ]);
  });

  it("normalizes Codex primary, secondary, plan, and credits", () => {
    const snapshot = normalizeCodexRateLimits(
      {
        rateLimits: {
          primary: {
            usedPercent: 17,
            resetsAt: 1_786_000_000,
            windowDurationMins: 300,
          },
          secondary: {
            usedPercent: 63,
            resetsAt: 1_786_500_000,
            windowDurationMins: 10_000,
          },
          planType: "pro",
          credits: {
            balance: "12.50",
            hasCredits: true,
            unlimited: false,
          },
        },
      },
      {
        providerInstanceId: ProviderInstanceId.make("codex-personal"),
        capturedAt: CAPTURED_AT,
      },
    );

    expect(snapshot).toEqual({
      providerInstanceId: "codex-personal",
      provider: "codex",
      planLabel: "pro",
      credits: {
        balance: "12.50",
        hasCredits: true,
        unlimited: false,
      },
      windows: [
        {
          kind: "five-hour",
          usedPercent: 17,
          resetsAt: 1_786_000_000,
          windowMinutes: 300,
        },
        {
          kind: "weekly",
          usedPercent: 63,
          resetsAt: 1_786_500_000,
          windowMinutes: 10_000,
        },
      ],
      status: null,
      capturedAt: CAPTURED_AT,
    });
  });
});

describe("AccountRateLimits", () => {
  it.effect("broadcasts only semantic changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const service = yield* AccountRateLimits;
        const subscription = yield* service.subscribe;
        const changesFiber = yield* subscription.changes.pipe(
          Stream.take(2),
          Stream.runCollect,
          Effect.forkChild,
        );
        const initial = normalizeCodexRateLimits(
          {
            rateLimits: {
              primary: { usedPercent: 10, windowDurationMins: 300 },
            },
          },
          {
            providerInstanceId: ProviderInstanceId.make("codex"),
            capturedAt: "2026-08-04T12:00:00.000Z",
          },
        );

        yield* service.ingest(
          rateLimitsEvent(initial, { providerInstanceId: initial.providerInstanceId }),
        );
        yield* service.ingest(
          rateLimitsEvent(
            { ...initial, capturedAt: "2026-08-04T12:01:00.000Z" },
            { eventId: "duplicate", providerInstanceId: initial.providerInstanceId },
          ),
        );
        yield* service.ingest(
          rateLimitsEvent(
            {
              ...initial,
              windows: [{ ...initial.windows[0]!, usedPercent: 11 }],
              capturedAt: "2026-08-04T12:02:00.000Z",
            },
            { eventId: "changed", providerInstanceId: initial.providerInstanceId },
          ),
        );

        const changes = Array.from(yield* Fiber.join(changesFiber));
        expect(changes.map((change) => change.rateLimits[0]?.windows[0]?.usedPercent)).toEqual([
          10, 11,
        ]);
      }).pipe(Effect.provide(AccountRateLimits.layer)),
    ),
  );

  it.effect("falls back to provider kind when the event has no instance id", () =>
    Effect.gen(function* () {
      const service = yield* AccountRateLimits;
      const first = normalizeClaudeRateLimits(
        { status: "allowed", rateLimitType: "five_hour", utilization: 20 },
        {
          providerInstanceId: ProviderInstanceId.make("claude-first"),
          capturedAt: CAPTURED_AT,
        },
      );
      const second = {
        ...first,
        providerInstanceId: ProviderInstanceId.make("claude-second"),
        windows: [{ ...first.windows[0]!, usedPercent: 30 }],
      };

      yield* service.ingest(rateLimitsEvent(first, { eventId: "first" }));
      yield* service.ingest(rateLimitsEvent(second, { eventId: "second" }));

      expect(yield* service.latest).toEqual({
        rateLimits: [second],
      });
    }).pipe(Effect.provide(AccountRateLimits.layer)),
  );

  it.effect("merges windows per kind so fetched and live data combine", () =>
    Effect.gen(function* () {
      const service = yield* AccountRateLimits;
      const instanceId = ProviderInstanceId.make("claudeAgent");
      // Fetcher-style full snapshot: five-hour + weekly with percentages.
      yield* service.report({
        providerInstanceId: instanceId,
        provider: ProviderDriverKind.make("claudeAgent"),
        planLabel: null,
        credits: null,
        windows: [
          { kind: "five-hour", usedPercent: 88, resetsAt: 1_786_000_000, windowMinutes: 300 },
          { kind: "weekly", usedPercent: 13, resetsAt: 1_786_500_000, windowMinutes: 10_080 },
        ],
        status: null,
        capturedAt: CAPTURED_AT,
      });

      // Live adapter event carrying only the five-hour window, no utilization.
      const live = normalizeClaudeRateLimits(
        { status: "allowed", rateLimitType: "five_hour", resetsAt: 1_786_001_000 },
        { providerInstanceId: instanceId, capturedAt: "2026-08-04T12:05:00.000Z" },
      );
      yield* service.ingest(
        rateLimitsEvent(live, { eventId: "live", providerInstanceId: instanceId }),
      );

      const latest = yield* service.latest;
      const windows = latest.rateLimits[0]?.windows ?? [];
      expect(windows.map((window) => window.kind).sort()).toEqual(["five-hour", "weekly"]);
      expect(windows.find((window) => window.kind === "weekly")?.usedPercent).toBe(13);
      expect(windows.find((window) => window.kind === "five-hour")?.resetsAt).toBe(1_786_001_000);
      expect(latest.rateLimits[0]?.status).toBe("allowed");
    }).pipe(Effect.provide(AccountRateLimits.layer)),
  );
});
