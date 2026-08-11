import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/shell";
import type { ConnectionTarget } from "@aqqua/client-runtime/connection";
import type { EnvironmentId } from "@aqqua/contracts";

import { isDesktopLocalConnectionTarget } from "./connection/desktopLocal";

export function isWakeEligibleEnvironment(target: ConnectionTarget, desktop: boolean): boolean {
  return (
    !desktop || target._tag === "PrimaryConnectionTarget" || isDesktopLocalConnectionTarget(target)
  );
}

export function hasLiveActiveAgent(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  liveEnvironmentIds: ReadonlySet<EnvironmentId>,
): boolean {
  return threads.some(
    (thread) =>
      liveEnvironmentIds.has(thread.environmentId) &&
      (thread.providerSubagent ?? null) === null &&
      (thread.session?.status === "starting" || thread.session?.status === "running"),
  );
}
