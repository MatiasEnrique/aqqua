import { createProviderSkillsEnvironmentAtoms } from "@aqqua/client-runtime/state/provider-skills";

import { connectionAtomRuntime } from "../connection/runtime";

export const providerSkillsEnvironment =
  createProviderSkillsEnvironmentAtoms(connectionAtomRuntime);
