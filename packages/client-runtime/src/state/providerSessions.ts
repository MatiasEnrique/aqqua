import { WS_METHODS, type OrchestrationThreadActivity } from "@aqqua/contracts";
import type { Atom } from "effect/unstable/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";

import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export interface AdoptedSessionReference {
  readonly sessionId: string;
  readonly boundaryUuid: string;
  readonly messageCount: number | null;
}

export function adoptedSessionReference(
  activity: OrchestrationThreadActivity | null | undefined,
): AdoptedSessionReference | null {
  if (activity?.kind !== "session.resumed") return null;
  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId : null;
  const boundaryUuid = typeof payload?.boundaryUuid === "string" ? payload.boundaryUuid : null;
  if (!sessionId || !boundaryUuid) return null;
  return {
    sessionId,
    boundaryUuid,
    messageCount:
      typeof payload?.messageCount === "number" && Number.isFinite(payload.messageCount)
        ? Math.max(0, Math.floor(payload.messageCount))
        : null,
  };
}

/** Shared external-session discovery and lazy transcript queries. */
export function createProviderSessionsEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    listSessions: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:provider:list-sessions",
      tag: WS_METHODS.providerListSessions,
      staleTimeMs: 30_000,
      idleTtlMs: 5 * 60_000,
    }),
    readSession: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:provider:read-session",
      tag: WS_METHODS.providerReadSession,
      staleTimeMs: Number.POSITIVE_INFINITY,
      idleTtlMs: 5 * 60_000,
    }),
  };
}
