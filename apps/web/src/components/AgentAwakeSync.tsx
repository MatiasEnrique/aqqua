import { useAtomValue } from "@effect/atom-react";
import type { ClientSettings } from "@aqqua/contracts/settings";
import { useEffect } from "react";

import { type DesktopAgentAwakeReport, resolveDesktopAgentAwakeReport } from "../agentAwake";
import { isElectron } from "../env";
import { useClientSettings, useClientSettingsHydrated } from "../hooks/useSettings";
import { desktopAgentAwakeReportAtom } from "../state/agentAwake";

const selectKeepScreenAwake = (settings: ClientSettings) => settings.keepScreenAwakeWhileAgentsRun;

function DesktopAgentAwakeReporter({ active, releaseOrphans }: DesktopAgentAwakeReport) {
  useEffect(() => {
    void window.desktopBridge?.setAgentAwake(active, { releaseOrphans }).catch(() => {});
  }, [active, releaseOrphans]);

  return null;
}

function DesktopAgentAwakeActivity() {
  const authoritativeActive = useAtomValue(desktopAgentAwakeReportAtom);
  const report = resolveDesktopAgentAwakeReport({
    settingsHydrated: true,
    enabled: true,
    authoritativeActive,
  });
  return report === null ? null : <DesktopAgentAwakeReporter {...report} />;
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
    return <DesktopAgentAwakeReporter {...immediateReport} />;
  }
  return settingsHydrated ? <DesktopAgentAwakeActivity /> : null;
}

export function AgentAwakeSync() {
  return isElectron ? <DesktopAgentAwakeSettingsGate /> : null;
}
