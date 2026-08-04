import type { UsageBreakdownBy, UsageRange } from "@aqqua/contracts";
import * as Cause from "effect/Cause";
import { useCallback } from "react";

import { usePrimaryEnvironment } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";

export function useUsageOverview(range: UsageRange) {
  const environment = usePrimaryEnvironment();
  const environmentId = environment?.environmentId ?? null;
  const query = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.usageOverview({ environmentId, input: { range } }),
  );
  const refreshScanCommand = useAtomCommand(serverEnvironment.refreshUsageScan, {
    reportFailure: false,
  });
  const clearLedgerCommand = useAtomCommand(serverEnvironment.clearUsageLedger, {
    reportFailure: false,
  });
  const updateSettingsCommand = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });
  const refreshScan = useCallback(async () => {
    if (environmentId === null) throw new Error("No environment is selected.");
    const result = await refreshScanCommand({ environmentId, input: {} });
    if (result._tag === "Failure") throw Cause.squash(result.cause);
    await query.refresh();
    return result.value;
  }, [environmentId, query, refreshScanCommand]);
  const clearLedger = useCallback(async () => {
    if (environmentId === null) throw new Error("No environment is selected.");
    const result = await clearLedgerCommand({ environmentId, input: {} });
    if (result._tag === "Failure") throw Cause.squash(result.cause);
    await query.refresh();
  }, [clearLedgerCommand, environmentId, query]);
  const enableScanning = useCallback(async () => {
    if (environmentId === null) throw new Error("No environment is selected.");
    const result = await updateSettingsCommand({
      environmentId,
      input: { patch: { usage: { scanEnabled: true } } },
    });
    if (result._tag === "Failure") throw Cause.squash(result.cause);
    await query.refresh();
  }, [environmentId, query, updateSettingsCommand]);

  return {
    ...query,
    environment,
    refreshScan,
    clearLedger,
    enableScanning,
  };
}

export function useUsageBreakdown(range: UsageRange, by: UsageBreakdownBy) {
  const environment = usePrimaryEnvironment();
  const environmentId = environment?.environmentId ?? null;
  return useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.usageBreakdown({ environmentId, input: { range, by } }),
  );
}
