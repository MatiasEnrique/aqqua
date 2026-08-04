/**
 * piSpawnSettings — the settings-derived pieces every pi invocation shares.
 *
 * The adapter (RPC sessions), provider probe/skills discovery, and text
 * generation all spawn the same binary with the same home override and model
 * slug convention; this module keeps those three call sites from drifting.
 *
 * @module piSpawnSettings
 */
import type { PiSettings } from "@aqqua/contracts";

import { expandHomePath } from "../../pathExpansion.ts";

/** Executable to spawn for every pi invocation (settings override, `pi` fallback). */
export function piExecutable(settings: PiSettings): string {
  return settings.binaryPath || "pi";
}

/** Child environment for pi processes: adds `PI_CODING_AGENT_DIR` when a home override is set. */
export function piEnvironment(
  settings: PiSettings,
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const homePath = settings.homePath.trim();
  return homePath.length === 0
    ? environment
    : { ...environment, PI_CODING_AGENT_DIR: expandHomePath(homePath) };
}

/**
 * aqqua stores pi models as `<provider>/<modelId>` joined at the FIRST slash;
 * the modelId itself may contain slashes (e.g. OpenRouter ids).
 */
export function splitPiModelSlug(
  slug: string,
): { readonly provider: string; readonly modelId: string } | null {
  const separatorIndex = slug.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === slug.length - 1) return null;
  return {
    provider: slug.slice(0, separatorIndex),
    modelId: slug.slice(separatorIndex + 1),
  };
}
