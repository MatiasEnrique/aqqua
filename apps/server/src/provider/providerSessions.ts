import type { ProviderExternalSession } from "@aqqua/contracts";

import type { ProviderInstance } from "./ProviderDriver.ts";
import type { ProviderRuntimeBinding } from "./Services/ProviderSessionDirectory.ts";

/** Remove provider-native sessions already bound to an aqqua thread. */
export function excludeOwnedProviderSessions(
  sessions: ReadonlyArray<ProviderExternalSession>,
  instance: Pick<ProviderInstance, "instanceId" | "matchesResumeCursor">,
  bindings: ReadonlyArray<ProviderRuntimeBinding>,
): ReadonlyArray<ProviderExternalSession> {
  return sessions.filter(
    (session) =>
      !bindings.some(
        (binding) =>
          binding.providerInstanceId === instance.instanceId &&
          instance.matchesResumeCursor(session.sessionId, binding.resumeCursor),
      ),
  );
}
