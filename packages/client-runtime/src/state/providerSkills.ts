import type {
  EnvironmentId,
  ProviderInstanceId,
  ProviderListSkillsInput,
} from "@t3tools/contracts";
import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcQueryAtomFamily, environmentRpcKey } from "./runtime.ts";

export type {
  ProviderSkillSourceBadge,
  ProviderSkillSourceKind,
} from "./providerSkillPresentation.ts";
export {
  classifyProviderSkillSource,
  compareProviderSkillPreference,
  dedupeProviderSkillsByCanonicalName,
  formatProviderSkillDisplayName,
  formatProviderSkillInstallSource,
  formatProviderSkillSourceBadge,
  formatProviderSkillSourceDetail,
  isPluginBackedProviderSkillPath,
  providerSkillStableId,
  resolveProviderWorkspaceSkills,
} from "./providerSkillPresentation.ts";

export interface ProviderWorkspaceSkillsTarget {
  readonly environmentId: EnvironmentId | null;
  readonly instanceId: ProviderInstanceId | null;
  readonly cwd: string | null;
}

/**
 * Prefer the instance id from a fully resolved provider status/snapshot.
 * Timeline UIs may fall back to a default provider when the preferred thread
 * identity is null; that resolved status's instanceId must drive the query.
 */
export function resolveProviderWorkspaceSkillsInstanceId(
  resolvedStatus: { readonly instanceId: ProviderInstanceId } | null | undefined,
): ProviderInstanceId | null {
  return resolvedStatus?.instanceId ?? null;
}

/** Non-actionable footer/empty copy while the workspace skill query is pending. */
export const PROVIDER_WORKSPACE_SKILLS_LOADING_LABEL = "Searching workspace skills…";

/**
 * Show a loading footer even when safe global fallback rows are already visible.
 * The footer must never become a selectable menu item.
 */
export function shouldShowProviderWorkspaceSkillsLoadingFooter(input: {
  readonly isPending: boolean;
  readonly isSkillTrigger: boolean;
}): boolean {
  return input.isPending && input.isSkillTrigger;
}

export function normalizeProviderWorkspaceSkillsTarget(
  target: ProviderWorkspaceSkillsTarget,
): ProviderWorkspaceSkillsTarget {
  const cwd = target.cwd?.trim() || null;
  return {
    environmentId: target.environmentId,
    instanceId: target.instanceId,
    cwd,
  };
}

export function isProviderWorkspaceSkillsTargetReady(
  target: ProviderWorkspaceSkillsTarget,
): target is {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly cwd: string;
} {
  return target.environmentId !== null && target.instanceId !== null && target.cwd !== null;
}

/**
 * Stable query identity for environment + provider instance + effective cwd.
 * Distinct keys revalidate independently when any axis changes.
 */
export function providerWorkspaceSkillsQueryKey(target: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly cwd: string;
}): string {
  const input = {
    instanceId: target.instanceId,
    cwd: target.cwd,
  } satisfies ProviderListSkillsInput;
  return environmentRpcKey({
    environmentId: target.environmentId,
    input,
  });
}

export function createProviderSkillsEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    listSkills: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:provider:list-skills",
      tag: WS_METHODS.providerListSkills,
      staleTimeMs: 30_000,
      idleTtlMs: 5 * 60_000,
    }),
  };
}
