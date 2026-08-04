import { describe, expect, it } from "vite-plus/test";
import type { OrchestrationThreadActivity } from "@aqqua/contracts";

import packageJson from "../../package.json" with { type: "json" };
import { adoptedSessionReference } from "./providerSessions.ts";

describe("provider sessions package export", () => {
  it("exposes the shared provider session query state", () => {
    expect(packageJson.exports["./state/provider-sessions"]).toEqual({
      types: "./src/state/providerSessions.ts",
      default: "./src/state/providerSessions.ts",
    });
  });
});

describe("adoptedSessionReference", () => {
  it("parses the lazy transcript boundary from the marker activity", () => {
    const activity = {
      kind: "session.resumed",
      payload: {
        sessionId: "external-session",
        boundaryUuid: "message-boundary",
        messageCount: 12.8,
      },
    } as OrchestrationThreadActivity;

    expect(adoptedSessionReference(activity)).toEqual({
      sessionId: "external-session",
      boundaryUuid: "message-boundary",
      messageCount: 12,
    });
  });

  it("rejects incomplete markers", () => {
    expect(
      adoptedSessionReference({
        kind: "session.resumed",
        payload: { sessionId: "missing-boundary" },
      } as OrchestrationThreadActivity),
    ).toBeNull();
  });
});
