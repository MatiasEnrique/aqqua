import {
  AVAILABLE_CONNECTION_STATE,
  connectionProjectionPhase,
  type SupervisorConnectionState,
} from "@aqqua/client-runtime/connection";
import {
  createEnvironmentShellAtoms,
  createEnvironmentShellSummaryAtom,
  createEnvironmentSnapshotAtom,
  createShellEnvironmentAtoms,
  type EnvironmentShellState,
} from "@aqqua/client-runtime/state/shell";
import type { EnvironmentId } from "@aqqua/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";

export const shellEnvironment = createShellEnvironmentAtoms(connectionAtomRuntime);
export const environmentShell = createEnvironmentShellAtoms(connectionAtomRuntime);
export const environmentSnapshotAtom = createEnvironmentSnapshotAtom(environmentShell.stateAtom);
export const environmentShellSummaryAtom = createEnvironmentShellSummaryAtom({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  shellStateValueAtom: environmentShell.stateValueAtom,
});

let previousLiveEnvironmentIds: ReadonlySet<EnvironmentId> = new Set();
export const liveEnvironmentShellIdsAtom = Atom.make((get) => {
  const next = new Set<EnvironmentId>();
  for (const environmentId of get(environmentCatalog.catalogValueAtom).entries.keys()) {
    if (get(environmentShell.stateValueAtom(environmentId)).status === "live") {
      next.add(environmentId);
    }
  }
  if (
    next.size === previousLiveEnvironmentIds.size &&
    [...next].every((environmentId) => previousLiveEnvironmentIds.has(environmentId))
  ) {
    return previousLiveEnvironmentIds;
  }
  previousLiveEnvironmentIds = next;
  return previousLiveEnvironmentIds;
}).pipe(Atom.withLabel("web-live-environment-shell-ids"));

interface EnvironmentShellBootstrapState {
  readonly shell: EnvironmentShellState;
  readonly connection: SupervisorConnectionState;
}

export function areEnvironmentShellsBootstrapped(
  states: ReadonlyArray<EnvironmentShellBootstrapState>,
): boolean {
  for (const { shell, connection } of states) {
    if (Option.isSome(shell.snapshot)) {
      continue;
    }
    // Runtime-backed connection atoms expose this placeholder while the
    // registry is still acquiring and connecting the real supervisor. Calling
    // it a completed disconnection creates a one-render window where restored
    // UI state can be pruned against an empty shell.
    if (
      connection.phase === "available" &&
      !connection.desired &&
      connection.attempt === 0 &&
      connection.generation === 0
    ) {
      return false;
    }
    if (connectionProjectionPhase(connection) !== "disconnected") {
      return false;
    }
    // A retrying environment is only transiently disconnected; give it its
    // first retries before letting the landing settle without its snapshot.
    if (connection.phase === "backoff" && connection.desired && connection.attempt <= 2) {
      return false;
    }
  }
  return true;
}

export const allEnvironmentShellsBootstrappedAtom = Atom.make((get) => {
  const catalog = AsyncResult.value(get(environmentCatalog.catalogAtom));
  if (Option.isNone(catalog)) {
    return false;
  }
  return areEnvironmentShellsBootstrapped(
    [...catalog.value.entries.keys()].map((environmentId) => ({
      shell: get(environmentShell.stateValueAtom(environmentId)),
      connection: Option.getOrElse(
        AsyncResult.value(get(environmentCatalog.stateAtom(environmentId))),
        () => AVAILABLE_CONNECTION_STATE,
      ),
    })),
  );
}).pipe(Atom.withLabel("web-all-environment-shells-bootstrapped"));
