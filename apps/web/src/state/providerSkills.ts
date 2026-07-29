import { createProviderSkillsEnvironmentAtoms } from "@t3tools/client-runtime/state/provider-skills";

import { connectionAtomRuntime } from "../connection/runtime";

export const providerSkillsEnvironment =
  createProviderSkillsEnvironmentAtoms(connectionAtomRuntime);
