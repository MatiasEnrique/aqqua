import { BearerConnectionTarget, PrimaryConnectionTarget } from "@aqqua/client-runtime/connection";
import {
  AVAILABLE_CONNECTION_STATE,
  type SupervisorConnectionState,
} from "@aqqua/client-runtime/connection";
import type {
  EnvironmentShellState,
  EnvironmentThreadShell,
} from "@aqqua/client-runtime/state/shell";
import { EnvironmentId } from "@aqqua/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { createDesktopAgentAwakeReportAtom } from "./agentAwake";

const localEnvironmentId = EnvironmentId.make("local");
const remoteEnvironmentId = EnvironmentId.make("remote");

function thread(environmentId: EnvironmentId, status: "idle" | "running"): EnvironmentThreadShell {
  return {
    environmentId,
    session: { status },
  } as EnvironmentThreadShell;
}

function shellState(status: EnvironmentShellState["status"]): EnvironmentShellState {
  return {
    snapshot: Option.none(),
    status,
    error: Option.none(),
  };
}

function connectionState(patch: Partial<SupervisorConnectionState>): SupervisorConnectionState {
  return { ...AVAILABLE_CONNECTION_STATE, ...patch };
}

describe("desktopAgentAwakeReportAtom", () => {
  it("waits through cached state and reports only authoritative desktop-local activity", () => {
    const catalogAtom = Atom.make({
      isReady: true,
      entries: new Map([
        [
          localEnvironmentId,
          {
            target: new PrimaryConnectionTarget({
              environmentId: localEnvironmentId,
              httpBaseUrl: "http://127.0.0.1:3773",
              label: "This computer",
              wsBaseUrl: "ws://127.0.0.1:3773",
            }),
            profile: Option.none(),
          },
        ],
        [
          remoteEnvironmentId,
          {
            target: new BearerConnectionTarget({
              connectionId: "saved-remote",
              environmentId: remoteEnvironmentId,
              label: "Remote",
            }),
            profile: Option.none(),
          },
        ],
      ]),
    });
    const connectionAtoms = new Map([
      [
        localEnvironmentId,
        Atom.make(
          AsyncResult.success(
            connectionState({ desired: true, phase: "connecting", stage: "synchronizing" }),
          ),
        ),
      ],
    ]);
    const shellAtoms = new Map([
      [localEnvironmentId, Atom.make(AsyncResult.success(shellState("cached")))],
    ]);
    const threadShellsAtom = Atom.make<ReadonlyArray<EnvironmentThreadShell>>([
      thread(localEnvironmentId, "idle"),
      thread(remoteEnvironmentId, "running"),
    ]);
    const reportAtom = createDesktopAgentAwakeReportAtom({
      catalogAtom,
      connectionStateAtom: (environmentId) => connectionAtoms.get(environmentId)!,
      shellStateAtom: (environmentId) => shellAtoms.get(environmentId)!,
      threadShellsAtom,
    });
    const registry = AtomRegistry.make();

    expect(registry.get(reportAtom)).toBeNull();

    registry.set(shellAtoms.get(localEnvironmentId)!, AsyncResult.success(shellState("live")));
    registry.set(
      connectionAtoms.get(localEnvironmentId)!,
      AsyncResult.success(connectionState({ desired: true, phase: "connected" })),
    );
    expect(registry.get(reportAtom)).toBe(false);

    registry.set(threadShellsAtom, [thread(localEnvironmentId, "running")]);
    expect(registry.get(reportAtom)).toBe(true);

    registry.set(shellAtoms.get(localEnvironmentId)!, AsyncResult.success(shellState("cached")));
    registry.set(
      connectionAtoms.get(localEnvironmentId)!,
      AsyncResult.success(connectionState({ desired: true, phase: "backoff" })),
    );
    expect(registry.get(reportAtom)).toBe(false);
    registry.dispose();
  });
});
