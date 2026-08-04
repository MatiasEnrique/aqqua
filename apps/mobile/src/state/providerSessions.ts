import { createProviderSessionsEnvironmentAtoms } from "@aqqua/client-runtime/state/provider-sessions";

import { connectionAtomRuntime } from "../connection/runtime";

export const providerSessionsEnvironment =
  createProviderSessionsEnvironmentAtoms(connectionAtomRuntime);
