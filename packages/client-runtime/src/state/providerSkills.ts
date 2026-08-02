import type {
  EnvironmentId,
  ProviderInstanceId,
  ProviderListSkillsInput,
  ProviderListSkillsResult,
  ServerProviderSkill,
} from "@aqqua/contracts";
import { WS_METHODS } from "@aqqua/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcQueryAtomFamily, environmentRpcKey } from "./runtime.ts";

import {
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
  type ProviderSkillSourceBadge,
  type ProviderSkillSourceKind,
} from "./providerSkillPresentation.ts";

export type { ProviderSkillSourceBadge, ProviderSkillSourceKind };
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
};

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

export interface ProviderWorkspaceSkillsState {
  readonly skills: ReadonlyArray<ServerProviderSkill>;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
}

/**
 * Minimal query view required by the shared workspace-skills hook.
 * Surface `useEnvironmentQuery` bindings satisfy this structurally.
 */
export interface ProviderWorkspaceSkillsQueryView {
  readonly data: ProviderListSkillsResult | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: () => void;
}

export type ProviderWorkspaceSkillsListSkillsTarget = {
  readonly environmentId: EnvironmentId;
  readonly input: ProviderListSkillsInput;
};

/**
 * Injected memo hook (React `useMemo`). Kept as a dependency so this module never
 * imports React — package consumers already on a cached Vite export map can keep
 * resolving `@aqqua/client-runtime/state/provider-skills` without a new subpath.
 */
export type ProviderWorkspaceSkillsUseMemo = <T>(factory: () => T, deps: readonly unknown[]) => T;

export interface CreateUseProviderWorkspaceSkillsOptions<TAtom> {
  readonly useMemo: ProviderWorkspaceSkillsUseMemo;
  readonly useEnvironmentQuery: (atom: TAtom | null) => ProviderWorkspaceSkillsQueryView;
  readonly listSkills: (target: ProviderWorkspaceSkillsListSkillsTarget) => TAtom;
}

/**
 * Shared workspace-skills hook factory for web and mobile.
 *
 * Surfaces inject their React `useMemo`, environment query hook, and listSkills
 * atom family. Target normalization, ready gating, snapshot/error/pending
 * resolution, refresh passthrough, and memoization dependencies live here once.
 *
 * Exported from the existing `state/provider-skills` subpath (not a new export)
 * so live Vite servers with a cached package export map still resolve it.
 */
export function createUseProviderWorkspaceSkills<TAtom>(
  options: CreateUseProviderWorkspaceSkillsOptions<TAtom>,
): (
  target: ProviderWorkspaceSkillsTarget,
  snapshotSkills?: ReadonlyArray<ServerProviderSkill>,
) => ProviderWorkspaceSkillsState {
  const { useMemo, useEnvironmentQuery, listSkills } = options;

  return function useProviderWorkspaceSkills(
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
        ? listSkills({
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
  };
}
