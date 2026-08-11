import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/shell";
import { BearerConnectionTarget, PrimaryConnectionTarget } from "@aqqua/client-runtime/connection";
import { EnvironmentId } from "@aqqua/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  hasLiveActiveAgent,
  isDesktopWakeEligibleEnvironment,
  resolveDesktopAgentAwakeReport,
} from "./agentAwake";

const localEnvironmentId = EnvironmentId.make("local");
const remoteEnvironmentId = EnvironmentId.make("remote");

function thread(
  environmentId: EnvironmentId,
  status: "idle" | "starting" | "running" | "ready" | "error",
): EnvironmentThreadShell {
  return {
    environmentId,
    session: { status },
  } as EnvironmentThreadShell;
}

describe("hasLiveActiveAgent", () => {
  it.each(["starting", "running"] as const)(
    "keeps the screen awake for a connected %s session",
    (status) => {
      expect(
        hasLiveActiveAgent([thread(localEnvironmentId, status)], new Set([localEnvironmentId])),
      ).toBe(true);
    },
  );

  it.each(["idle", "ready", "error"] as const)(
    "releases the screen for a connected %s session",
    (status) => {
      expect(
        hasLiveActiveAgent([thread(localEnvironmentId, status)], new Set([localEnvironmentId])),
      ).toBe(false);
    },
  );

  it("ignores cached running state from a disconnected environment", () => {
    expect(
      hasLiveActiveAgent([thread(remoteEnvironmentId, "running")], new Set([localEnvironmentId])),
    ).toBe(false);
  });

  it("ignores provider-native child status in favor of its owning thread", () => {
    const nativeChild = {
      ...thread(localEnvironmentId, "running"),
      providerSubagent: {},
    } as EnvironmentThreadShell;

    expect(hasLiveActiveAgent([nativeChild], new Set([localEnvironmentId]))).toBe(false);
  });

  it("stays active until the final connected agent stops", () => {
    expect(
      hasLiveActiveAgent(
        [thread(localEnvironmentId, "ready"), thread(remoteEnvironmentId, "running")],
        new Set([localEnvironmentId, remoteEnvironmentId]),
      ),
    ).toBe(true);
  });
});

describe("isDesktopWakeEligibleEnvironment", () => {
  const primary = new PrimaryConnectionTarget({
    environmentId: localEnvironmentId,
    httpBaseUrl: "http://127.0.0.1:3773",
    label: "This computer",
    wsBaseUrl: "ws://127.0.0.1:3773",
  });
  const desktopLocal = new BearerConnectionTarget({
    connectionId: "local:wsl",
    environmentId: localEnvironmentId,
    label: "WSL",
  });
  const savedRemote = new BearerConnectionTarget({
    connectionId: "saved-remote",
    environmentId: remoteEnvironmentId,
    label: "Remote",
  });

  it("counts only host-local desktop environments", () => {
    expect(isDesktopWakeEligibleEnvironment(primary)).toBe(true);
    expect(isDesktopWakeEligibleEnvironment(desktopLocal)).toBe(true);
    expect(isDesktopWakeEligibleEnvironment(savedRemote)).toBe(false);
  });
});

describe("resolveDesktopAgentAwakeReport", () => {
  it.each([
    {
      name: "waits for client settings hydration",
      input: {
        settingsHydrated: false,
        enabled: false,
        authoritativeActive: null,
      },
      expected: null,
    },
    {
      name: "releases an existing blocker once the hydrated setting is disabled",
      input: {
        settingsHydrated: true,
        enabled: false,
        authoritativeActive: null,
      },
      expected: { active: false, releaseOrphans: true },
    },
    {
      name: "preserves an existing blocker while enabled shell state restores",
      input: {
        settingsHydrated: true,
        enabled: true,
        authoritativeActive: null,
      },
      expected: null,
    },
    {
      name: "reports the derived activity after state is authoritative",
      input: {
        settingsHydrated: true,
        enabled: true,
        authoritativeActive: true,
      },
      expected: { active: true, releaseOrphans: false },
    },
  ] as const)("$name", ({ input, expected }) => {
    expect(resolveDesktopAgentAwakeReport(input)).toEqual(expected);
  });
});
