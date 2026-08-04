import type { AccountUsageSnapshot } from "@aqqua/contracts";

import { usePrimaryEnvironment } from "../state/environments";
import { useEnvironmentQuery, type EnvironmentQueryView } from "../state/query";
import { serverEnvironment } from "../state/server";

export function useAccountUsage(): EnvironmentQueryView<AccountUsageSnapshot> {
  const primaryEnvironment = usePrimaryEnvironment();
  const environmentId = primaryEnvironment?.environmentId ?? null;
  return useEnvironmentQuery(
    environmentId === null ? null : serverEnvironment.accountUsage({ environmentId, input: {} }),
  );
}
