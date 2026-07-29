import type { ServerProviderSkill } from "@t3tools/contracts";

const REPO_SKILL_SCOPES = new Set(["repo", "project", "workspace", "local"]);

export type ProviderSkillSourceKind = "repo" | "global";

export type ProviderSkillSourceBadge = "Repo" | "Global";

function titleCaseWords(value: string): string {
  const words: string[] = [];
  for (const segment of value.split(/[\s:_-]+/)) {
    if (segment.length === 0) continue;
    words.push(segment.charAt(0).toUpperCase() + segment.slice(1));
  }
  return words.join(" ");
}

function normalizePathSeparators(pathValue: string): string {
  return pathValue.replaceAll("\\", "/");
}

export function isPluginBackedProviderSkillPath(pathValue: string): boolean {
  const normalizedPath = normalizePathSeparators(pathValue);
  return (
    normalizedPath.includes("/.codex/plugins/") || normalizedPath.includes("/.agents/plugins/")
  );
}

export function classifyProviderSkillSource(
  skill: Pick<ServerProviderSkill, "path" | "scope">,
): ProviderSkillSourceKind {
  const normalizedScope = skill.scope?.trim().toLowerCase() ?? "";
  if (REPO_SKILL_SCOPES.has(normalizedScope)) {
    return "repo";
  }
  return "global";
}

export function formatProviderSkillSourceBadge(
  skill: Pick<ServerProviderSkill, "path" | "scope">,
): ProviderSkillSourceBadge {
  return classifyProviderSkillSource(skill) === "repo" ? "Repo" : "Global";
}

export function formatProviderSkillDisplayName(
  skill: Pick<ServerProviderSkill, "name" | "displayName">,
): string {
  const displayName = skill.displayName?.trim();
  if (displayName) {
    return displayName;
  }
  return titleCaseWords(skill.name);
}

/**
 * Fine-grained install provenance (App, System, Personal, Project, …).
 * Prefer {@link formatProviderSkillSourceBadge} for the compact Repo/Global chip.
 */
export function formatProviderSkillInstallSource(
  skill: Pick<ServerProviderSkill, "path" | "scope">,
): string | null {
  if (isPluginBackedProviderSkillPath(skill.path)) {
    return "App";
  }

  const normalizedScope = skill.scope?.trim().toLowerCase();
  if (normalizedScope === "system") {
    return "System";
  }
  if (
    normalizedScope === "repo" ||
    normalizedScope === "project" ||
    normalizedScope === "workspace" ||
    normalizedScope === "local"
  ) {
    return "Project";
  }
  if (normalizedScope === "user" || normalizedScope === "personal") {
    return "Personal";
  }
  if (normalizedScope) {
    return titleCaseWords(normalizedScope);
  }

  return null;
}

/**
 * Secondary provenance label such as `Global · App` or `Global · System`.
 * Returns just the badge when there is no finer useful detail.
 */
export function formatProviderSkillSourceDetail(
  skill: Pick<ServerProviderSkill, "path" | "scope">,
): string {
  const badge = formatProviderSkillSourceBadge(skill);
  const installSource = formatProviderSkillInstallSource(skill);
  if (!installSource) {
    return badge;
  }
  // Repo skills already read as workspace-local; "Project" is redundant next to Repo.
  if (badge === "Repo" && installSource === "Project") {
    return badge;
  }
  if (installSource === badge) {
    return badge;
  }
  return `${badge} · ${installSource}`;
}

/**
 * Prefer the repo-scoped skill on name conflicts. Same-scope duplicates use path
 * as a stable tie breaker so the winner does not depend on provider response order.
 */
export function compareProviderSkillPreference(
  left: Pick<ServerProviderSkill, "name" | "path" | "scope">,
  right: Pick<ServerProviderSkill, "name" | "path" | "scope">,
): number {
  const leftKind = classifyProviderSkillSource(left);
  const rightKind = classifyProviderSkillSource(right);
  if (leftKind !== rightKind) {
    return leftKind === "repo" ? -1 : 1;
  }
  const pathCmp = left.path.localeCompare(right.path);
  if (pathCmp !== 0) {
    return pathCmp;
  }
  return left.name.localeCompare(right.name);
}

/**
 * Deduplicate by canonical skill name before search, ranking, limits, IDs, and
 * rendering. Repo skills always win over global skills with the same name.
 */
export function dedupeProviderSkillsByCanonicalName(
  skills: ReadonlyArray<ServerProviderSkill>,
): ServerProviderSkill[] {
  const winners = new Map<string, ServerProviderSkill>();

  for (const skill of skills) {
    const existing = winners.get(skill.name);
    if (existing === undefined || compareProviderSkillPreference(skill, existing) < 0) {
      winners.set(skill.name, skill);
    }
  }

  return [...winners.values()].sort((left, right) => {
    const nameCmp = left.name.localeCompare(right.name);
    if (nameCmp !== 0) {
      return nameCmp;
    }
    return left.path.localeCompare(right.path);
  });
}

export function providerSkillStableId(
  skill: Pick<ServerProviderSkill, "name" | "path">,
  providerKey?: string,
): string {
  const prefix = providerKey ? `skill:${providerKey}:` : "skill:";
  return `${prefix}${skill.name}\u0000${skill.path}`;
}

/**
 * Workspace query is the source of truth. While loading, only a global-only
 * snapshot fallback is safe — never surface repo skills from provider health.
 */
export function resolveProviderWorkspaceSkills(input: {
  readonly querySkills: ReadonlyArray<ServerProviderSkill> | null;
  readonly queryError: string | null;
  readonly queryPending: boolean;
  readonly snapshotSkills: ReadonlyArray<ServerProviderSkill>;
}): {
  readonly skills: ReadonlyArray<ServerProviderSkill>;
  readonly isPending: boolean;
  readonly error: string | null;
} {
  if (input.querySkills !== null) {
    return {
      skills: dedupeProviderSkillsByCanonicalName(input.querySkills),
      isPending: false,
      error: null,
    };
  }

  if (input.queryError) {
    return {
      skills: [],
      isPending: false,
      error: input.queryError,
    };
  }

  const globalSnapshot = input.snapshotSkills.filter(
    (skill) => classifyProviderSkillSource(skill) === "global",
  );

  return {
    skills: dedupeProviderSkillsByCanonicalName(globalSnapshot),
    isPending: input.queryPending,
    error: null,
  };
}
