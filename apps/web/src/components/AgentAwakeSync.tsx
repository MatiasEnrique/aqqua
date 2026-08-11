import { useAtomValue } from "@effect/atom-react";
import { useEffect, useMemo } from "react";

import { hasLiveActiveAgent, isWakeEligibleEnvironment } from "../agentAwake";
import { isElectron } from "../env";
import { useClientSettings } from "../hooks/useSettings";
import { useThreadShells } from "../state/entities";
import { useEnvironments } from "../state/environments";
import { liveEnvironmentShellIdsAtom } from "../state/shell";

interface BrowserWakeLockSentinel {
  readonly release: () => Promise<void>;
  readonly addEventListener: (
    type: "release",
    listener: () => void,
    options?: { readonly once?: boolean },
  ) => void;
}

interface BrowserWakeLockManager {
  readonly request: (type: "screen") => Promise<BrowserWakeLockSentinel>;
}

function browserWakeLockManager(): BrowserWakeLockManager | null {
  const browserNavigator = navigator as Navigator & {
    readonly wakeLock?: BrowserWakeLockManager;
  };
  return browserNavigator.wakeLock ?? null;
}

export function AgentAwakeSync() {
  const enabled = useClientSettings((settings) => settings.keepScreenAwakeWhileAgentsRun);
  const threads = useThreadShells();
  const { environments } = useEnvironments();
  const liveEnvironmentIds = useAtomValue(liveEnvironmentShellIdsAtom);
  const wakeEligibleEnvironmentIds = useMemo(
    () =>
      new Set(
        environments
          .filter(
            (environment) =>
              liveEnvironmentIds.has(environment.environmentId) &&
              isWakeEligibleEnvironment(environment.entry.target, isElectron),
          )
          .map((environment) => environment.environmentId),
      ),
    [environments, liveEnvironmentIds],
  );
  const active = enabled && hasLiveActiveAgent(threads, wakeEligibleEnvironmentIds);

  useEffect(() => {
    const desktopBridge = window.desktopBridge;
    if (desktopBridge?.setAgentAwake) {
      void desktopBridge.setAgentAwake(active).catch(() => {});
      return () => {
        if (active) void desktopBridge.setAgentAwake(false).catch(() => {});
      };
    }

    if (!active) return;
    const wakeLock = browserWakeLockManager();
    if (wakeLock === null) return;

    let disposed = false;
    let sentinel: BrowserWakeLockSentinel | null = null;

    const acquire = async () => {
      if (disposed || sentinel !== null || document.visibilityState !== "visible") return;
      try {
        const acquired = await wakeLock.request("screen");
        if (disposed || document.visibilityState !== "visible") {
          await acquired.release();
          return;
        }
        sentinel = acquired;
        acquired.addEventListener(
          "release",
          () => {
            if (sentinel === acquired) sentinel = null;
          },
          { once: true },
        );
      } catch {
        // Browser support and power policy decide whether a screen wake lock is available.
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    void acquire();

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (sentinel !== null) void sentinel.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);

  return null;
}
