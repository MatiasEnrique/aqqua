export function formatAppDisplayName(input: {
  readonly baseName: string;
  readonly stageLabel: string;
}): string {
  if (input.stageLabel.trim().toLowerCase() === "latest") {
    return input.baseName;
  }

  return `${input.baseName} (${input.stageLabel})`;
}

/**
 * Whether the worktree view is on by default for a build stage.
 *
 * It always is: the worktree sidebar and its header tab strip are the app's
 * shape, not an experiment, so every stage lands there unless the user turns it
 * off in Settings → Beta. Kept as a function (rather than inlined `true`)
 * because the stage is the input a staged rollback would key on, and callers
 * already thread it through.
 */
export function resolveSidebarV2Default(_stageLabel: string): boolean {
  return true;
}

/**
 * Resolved worktree view state: an explicit choice if the user has made one,
 * otherwise the default for this build stage.
 *
 * A stored `enabled: true` counts as an explicit choice even without the
 * companion flag. `true` was never the schema default, so it can only have come
 * from the Settings → Beta toggle — settings written before that flag existed
 * would otherwise lose the opt-in and drop such users back to the regular
 * sidebar. Mirrors how `normalizeDesktopSettingsDocument` treats a legacy
 * `settingsHydrated` guards the startup window: client settings load
 * asynchronously and the pre-hydration snapshot is just the schema defaults, so
 * resolving against it would mount one sidebar and swap it out a tick later,
 * remounting the tree. While hydrating, hold the stage default — where every
 * user who has not opted out already ends up, so the common path never sees the
 * swap. An explicit opt-out pays one remount instead of everyone paying it.
 */
export function resolveSidebarV2Enabled(input: {
  readonly enabled: boolean;
  readonly configuredByUser: boolean;
  readonly settingsHydrated: boolean;
  readonly stageLabel: string;
}): boolean {
  if (!input.settingsHydrated) {
    return resolveSidebarV2Default(input.stageLabel);
  }

  return input.configuredByUser || input.enabled
    ? input.enabled
    : resolveSidebarV2Default(input.stageLabel);
}

export function resolveServerBackedAppStageLabel(input: {
  readonly primaryServerVersion: string | null | undefined;
  readonly fallbackStageLabel: string;
}): string {
  return input.fallbackStageLabel;
}

export function resolveServerBackedAppDisplayName(input: {
  readonly baseName: string;
  readonly fallbackDisplayName: string;
  readonly fallbackStageLabel: string;
  readonly primaryServerVersion: string | null | undefined;
}): string {
  return input.fallbackDisplayName;
}
