import {
  isProviderWorkspaceSkillsTargetReady,
  normalizeProviderWorkspaceSkillsTarget,
  resolveProviderWorkspaceSkills,
  type ProviderWorkspaceSkillsTarget,
} from "@t3tools/client-runtime/state/provider-skills";
import type { ServerProviderSkill } from "@t3tools/contracts";
import { useMemo } from "react";

import { useEnvironmentQuery } from "../state/query";
import { providerSkillsEnvironment } from "../state/providerSkills";

export interface ProviderWorkspaceSkillsState {
  readonly skills: ReadonlyArray<ServerProviderSkill>;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
}

export function useProviderWorkspaceSkills(
  target: ProviderWorkspaceSkillsTarget,
  snapshotSkills: ReadonlyArray<ServerProviderSkill> = [],
): ProviderWorkspaceSkillsState {
  const normalizedTarget = useMemo(
    () => normalizeProviderWorkspaceSkillsTarget(target),
    [target.cwd, target.environmentId, target.instanceId],
  );
  const ready = isProviderWorkspaceSkillsTargetReady(normalizedTarget);
  const result = useEnvironmentQuery(
    ready
      ? providerSkillsEnvironment.listSkills({
          environmentId: normalizedTarget.environmentId,
          input: {
            instanceId: normalizedTarget.instanceId,
            cwd: normalizedTarget.cwd,
          },
        })
      : null,
  );

  return useMemo(
    () => ({
      ...resolveProviderWorkspaceSkills({
        querySkills: result.data?.skills ?? null,
        queryError: result.error,
        queryPending: ready && result.isPending,
        snapshotSkills,
      }),
      refresh: result.refresh,
    }),
    [ready, result.data?.skills, result.error, result.isPending, result.refresh, snapshotSkills],
  );
}
