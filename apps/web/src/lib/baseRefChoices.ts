import type { VcsRef } from "@aqqua/contracts";

export interface BaseRefChoice {
  readonly id: string;
  readonly label: string;
  readonly local: VcsRef | null;
  readonly remote: VcsRef | null;
}

function remoteBranchName(ref: VcsRef): string {
  if (ref.remoteName && ref.name.startsWith(`${ref.remoteName}/`)) {
    return ref.name.slice(ref.remoteName.length + 1);
  }
  return ref.name;
}

export function buildBaseRefChoices(
  localRefs: ReadonlyArray<VcsRef>,
  remoteRefs: ReadonlyArray<VcsRef>,
): ReadonlyArray<BaseRefChoice> {
  const unusedRemoteRefs = new Set(remoteRefs);
  const pairedChoices = localRefs.map((local) => {
    const matches = remoteRefs.filter(
      (remote) => unusedRemoteRefs.has(remote) && remoteBranchName(remote) === local.name,
    );
    const remote =
      matches.find((candidate) => candidate.remoteName === "origin") ?? matches[0] ?? null;
    if (remote) unusedRemoteRefs.delete(remote);
    return {
      id: `local:${local.name}`,
      label: local.name,
      local,
      remote,
    };
  });

  const remoteOnlyChoices = remoteRefs
    .filter((remote) => unusedRemoteRefs.has(remote))
    .map((remote) => ({
      id: `remote:${remote.name}`,
      label: remote.name,
      local: null,
      remote,
    }));

  return [...pairedChoices, ...remoteOnlyChoices];
}

export interface RefPickerOption {
  readonly id: string;
  /** Ref name used as the selection value. */
  readonly value: string;
  readonly label: string;
  readonly badge: "remote" | null;
}

/**
 * Flattens paired local/remote choices into one row per ref so the picker reads
 * like the branch toolbar list instead of exposing a per-row remote toggle.
 */
export function toRefPickerOptions(
  choices: ReadonlyArray<BaseRefChoice>,
): ReadonlyArray<RefPickerOption> {
  const options: RefPickerOption[] = [];
  const seenValues = new Set<string>();
  const push = (id: string, ref: VcsRef, badge: "remote" | null) => {
    if (seenValues.has(ref.name)) return;
    seenValues.add(ref.name);
    options.push({ id, value: ref.name, label: ref.name, badge });
  };
  for (const choice of choices) {
    if (choice.local) push(`${choice.id}:local`, choice.local, null);
    if (choice.remote) push(`${choice.id}:remote`, choice.remote, "remote");
  }
  return options;
}

export function filterBaseRefChoices(
  choices: ReadonlyArray<BaseRefChoice>,
  query: string,
): ReadonlyArray<BaseRefChoice> {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) return choices;
  return choices.filter(
    (choice) =>
      choice.label.toLocaleLowerCase().includes(normalizedQuery) ||
      choice.local?.name.toLocaleLowerCase().includes(normalizedQuery) === true ||
      choice.remote?.name.toLocaleLowerCase().includes(normalizedQuery) === true,
  );
}
