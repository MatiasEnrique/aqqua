const NIGHTLY_SERVER_VERSION_PATTERN = /-nightly\.\d{8}\.\d+$/;

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
 * Whether the worktree view beta is on by default for a build stage.
 *
 * It never is: the worktree view is opt-in everywhere, including nightly and
 * local dev, so every build stage shows the same regular sidebar until the
 * user flips Settings → Beta → Worktree view. Kept as a function (rather than
 * inlined `false`) because the stage is the input a future staged rollout
 * would key on, and callers already thread it through.
 */
export function resolveSidebarV2Default(_stageLabel: string): boolean {
  return false;
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
 * stored `updateChannel: "nightly"` as user-configured.
 *
 * `settingsHydrated` guards the startup window: client settings load
 * asynchronously and the pre-hydration snapshot is just the schema defaults, so
 * resolving against it would mount one sidebar and swap it out a tick later,
 * remounting the tree. While hydrating, hold the regular sidebar — where both
 * paths already start.
 */
export function resolveSidebarV2Enabled(input: {
  readonly enabled: boolean;
  readonly configuredByUser: boolean;
  readonly settingsHydrated: boolean;
  readonly stageLabel: string;
}): boolean {
  if (!input.settingsHydrated) {
    return false;
  }

  return input.configuredByUser || input.enabled
    ? input.enabled
    : resolveSidebarV2Default(input.stageLabel);
}

export function resolveServerBackedAppStageLabel(input: {
  readonly primaryServerVersion: string | null | undefined;
  readonly fallbackStageLabel: string;
}): string {
  return input.primaryServerVersion &&
    NIGHTLY_SERVER_VERSION_PATTERN.test(input.primaryServerVersion)
    ? "Nightly"
    : input.fallbackStageLabel;
}

export function resolveServerBackedAppDisplayName(input: {
  readonly baseName: string;
  readonly fallbackDisplayName: string;
  readonly fallbackStageLabel: string;
  readonly primaryServerVersion: string | null | undefined;
}): string {
  const stageLabel = resolveServerBackedAppStageLabel({
    primaryServerVersion: input.primaryServerVersion,
    fallbackStageLabel: input.fallbackStageLabel,
  });

  return stageLabel === input.fallbackStageLabel
    ? input.fallbackDisplayName
    : formatAppDisplayName({ baseName: input.baseName, stageLabel });
}
