import {
  connectionProjectionPhase,
  type SupervisorConnectionState,
} from "@aqqua/client-runtime/connection";
import type { EnvironmentCatalogState } from "@aqqua/client-runtime/state/connections";
import type {
  EnvironmentShellState,
  EnvironmentThreadShell,
} from "@aqqua/client-runtime/state/shell";
import type { EnvironmentId } from "@aqqua/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { hasLiveActiveAgent, isDesktopWakeEligibleEnvironment } from "../agentAwake";
import { environmentCatalog } from "../connection/catalog";
import { environmentShell } from "./shell";
import { environmentThreadShells } from "./threads";

export function createDesktopAgentAwakeReportAtom<ConnectionError, ShellError>(input: {
  readonly catalogAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly connectionStateAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<AsyncResult.AsyncResult<SupervisorConnectionState, ConnectionError>>;
  readonly shellStateAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<AsyncResult.AsyncResult<EnvironmentShellState, ShellError>>;
  readonly threadShellsAtom: Atom.Atom<ReadonlyArray<EnvironmentThreadShell>>;
}) {
  return Atom.make((get) => {
    const catalog = get(input.catalogAtom);
    if (!catalog.isReady) return null;

    const liveEnvironmentIds = new Set<EnvironmentId>();
    for (const [environmentId, entry] of catalog.entries) {
      if (!isDesktopWakeEligibleEnvironment(entry.target)) continue;

      const shell = Option.getOrNull(AsyncResult.value(get(input.shellStateAtom(environmentId))));
      if (shell?.status === "live") {
        liveEnvironmentIds.add(environmentId);
        continue;
      }

      const connection = Option.getOrNull(
        AsyncResult.value(get(input.connectionStateAtom(environmentId))),
      );
      if (
        connection === null ||
        (connection.phase === "available" && !connection.desired) ||
        connectionProjectionPhase(connection) !== "disconnected"
      ) {
        return null;
      }
    }

    if (liveEnvironmentIds.size === 0) return false;
    return hasLiveActiveAgent(get(input.threadShellsAtom), liveEnvironmentIds);
  }).pipe(Atom.withLabel("desktop-agent-awake-report"));
}

export const desktopAgentAwakeReportAtom = createDesktopAgentAwakeReportAtom({
  catalogAtom: environmentCatalog.catalogValueAtom,
  connectionStateAtom: environmentCatalog.stateAtom,
  shellStateAtom: environmentShell.stateAtom,
  threadShellsAtom: environmentThreadShells.threadShellsAtom,
});
