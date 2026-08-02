import { createUseProviderWorkspaceSkills } from "@aqqua/client-runtime/state/provider-skills";
import { useMemo } from "react";

import { useEnvironmentQuery } from "../state/query";
import { providerSkillsEnvironment } from "../state/providerSkills";

export type { ProviderWorkspaceSkillsState } from "@aqqua/client-runtime/state/provider-skills";

export const useProviderWorkspaceSkills = createUseProviderWorkspaceSkills({
  useMemo,
  useEnvironmentQuery,
  listSkills: providerSkillsEnvironment.listSkills,
});
