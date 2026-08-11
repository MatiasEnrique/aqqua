import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/shell";
import type { ConnectionTarget } from "@aqqua/client-runtime/connection";
import type { EnvironmentId } from "@aqqua/contracts";

import { isDesktopLocalConnectionTarget } from "./connection/desktopLocal";

export function isDesktopWakeEligibleEnvironment(target: ConnectionTarget): boolean {
  return target._tag === "PrimaryConnectionTarget" || isDesktopLocalConnectionTarget(target);
}

export interface DesktopAgentAwakeReport {
  readonly active: boolean;
  readonly releaseOrphans: boolean;
}

export function resolveDesktopAgentAwakeReport(input: {
  readonly settingsHydrated: boolean;
  readonly enabled: boolean;
  readonly authoritativeActive: boolean | null;
}): DesktopAgentAwakeReport | null {
  if (!input.settingsHydrated) return null;
  if (!input.enabled) return { active: false, releaseOrphans: true };
  return input.authoritativeActive === null
    ? null
    : { active: input.authoritativeActive, releaseOrphans: false };
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
