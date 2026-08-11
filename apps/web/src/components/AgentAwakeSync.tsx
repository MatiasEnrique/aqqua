import { useAtomValue } from "@effect/atom-react";
import type { ClientSettings } from "@aqqua/contracts/settings";
import { useEffect } from "react";

import { resolveDesktopAgentAwakeReport } from "../agentAwake";
import { isElectron } from "../env";
import { useClientSettings, useClientSettingsHydrated } from "../hooks/useSettings";
import { desktopAgentAwakeReportAtom } from "../state/agentAwake";

const selectKeepScreenAwake = (settings: ClientSettings) => settings.keepScreenAwakeWhileAgentsRun;

function DesktopAgentAwakeReporter({ active }: { readonly active: boolean }) {
  useEffect(() => {
    void window.desktopBridge?.setAgentAwake(active).catch(() => {});
  }, [active]);

  return null;
}

function DesktopAgentAwakeActivity() {
  const authoritativeActive = useAtomValue(desktopAgentAwakeReportAtom);
  const report = resolveDesktopAgentAwakeReport({
    settingsHydrated: true,
    enabled: true,
    authoritativeActive,
  });
  return report === null ? null : <DesktopAgentAwakeReporter active={report} />;
}

function DesktopAgentAwakeSettingsGate() {
  const settingsHydrated = useClientSettingsHydrated();
  const enabled = useClientSettings(selectKeepScreenAwake);
  const immediateReport = resolveDesktopAgentAwakeReport({
    settingsHydrated,
    enabled,
    authoritativeActive: null,
  });

  if (immediateReport !== null) {
    return <DesktopAgentAwakeReporter active={immediateReport} />;
  }
  return settingsHydrated ? <DesktopAgentAwakeActivity /> : null;
}

export function AgentAwakeSync() {
  return isElectron ? <DesktopAgentAwakeSettingsGate /> : null;
}
