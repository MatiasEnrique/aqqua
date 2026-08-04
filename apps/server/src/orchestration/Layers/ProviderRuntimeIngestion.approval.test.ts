import {
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeRequestId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@aqqua/contracts";
import { describe, expect, it } from "vite-plus/test";

import { runtimeEventToActivities } from "./ProviderRuntimeIngestion.ts";

describe("runtimeEventToActivities approval details", () => {
  it("preserves complete multiline command details", () => {
    const detail = `bun run release -- ${"long-argument ".repeat(20)}\nsecond line`;
    const event = {
      type: "request.opened",
      eventId: EventId.make("evt-request-opened"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-07-18T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      requestId: RuntimeRequestId.make("approval-1"),
      payload: {
        requestType: "command_execution_approval",
        detail,
      },
    } satisfies ProviderRuntimeEvent;

    const [activity] = runtimeEventToActivities(event);

    expect(activity?.kind).toBe("approval.requested");
    expect((activity?.payload as Record<string, unknown> | undefined)?.detail).toBe(detail);
  });

  it("does not turn account rate-limit updates into thread activities", () => {
    const event = {
      type: "account.rate-limits.updated",
      eventId: EventId.make("evt-rate-limits"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-08-04T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      payload: {
        rateLimits: {
          providerInstanceId: ProviderInstanceId.make("codex"),
          provider: ProviderDriverKind.make("codex"),
          planLabel: "pro",
          credits: null,
          windows: [],
          status: null,
          capturedAt: "2026-08-04T00:00:00.000Z",
        },
      },
    } satisfies ProviderRuntimeEvent;

    expect(runtimeEventToActivities(event)).toEqual([]);
  });
});
