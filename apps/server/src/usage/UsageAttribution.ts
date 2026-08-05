export interface UsageAttributionRoot {
  readonly projectId: string;
  readonly projectTitle: string;
  readonly path: string;
}

export type UsageAttribution =
  | {
      readonly kind: "aqqua";
      readonly projectId: string;
      readonly projectTitle: string;
      readonly rootPath: string;
    }
  | {
      readonly kind: "external";
    };

function normalizePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalized.length === 0 ? "/" : normalized;
}

function isWithinRoot(cwd: string, root: string): boolean {
  return cwd === root || cwd.startsWith(root === "/" ? root : `${root}/`);
}

export function attributeUsagePath(
  cwd: string | null,
  roots: ReadonlyArray<UsageAttributionRoot>,
): UsageAttribution {
  if (cwd === null || cwd.trim().length === 0) {
    return { kind: "external" };
  }

  const normalizedCwd = normalizePath(cwd);
  let best: UsageAttributionRoot | null = null;
  let bestLength = -1;

  for (const root of roots) {
    const normalizedRoot = normalizePath(root.path);
    if (!isWithinRoot(normalizedCwd, normalizedRoot) || normalizedRoot.length <= bestLength) {
      continue;
    }
    best = { ...root, path: normalizedRoot };
    bestLength = normalizedRoot.length;
  }

  return best === null
    ? { kind: "external" }
    : {
        kind: "aqqua",
        projectId: best.projectId,
        projectTitle: best.projectTitle,
        rootPath: best.path,
      };
}

/**
 * Persisted attribution key. Deliberately excludes the project title: the key
 * lands in the `usage_daily_rollup` primary key, and a mutable title would
 * split one project across rows after a rename. Titles resolve at read time.
 */
export function usageProjectAttributionKey(
  cwd: string | null,
  roots: ReadonlyArray<UsageAttributionRoot>,
): string {
  const attribution = attributeUsagePath(cwd, roots);
  return attribution.kind === "aqqua" ? `aqqua:${attribution.projectId}` : "external";
}
