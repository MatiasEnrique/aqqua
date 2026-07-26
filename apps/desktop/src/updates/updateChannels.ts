import type { DesktopUpdateChannel } from "@t3tools/contracts";

const NIGHTLY_VERSION_PATTERN = /-nightly\.\d{8}\.\d+$/;
/** A build produced from a working copy by `dist:desktop:sigma`. The suffix is
    the whole channel signal: both the build script and the running app read the
    version string, so nothing else has to be threaded through the bundle. */
const SIGMA_VERSION_PATTERN = /-sigma(?:\.[0-9A-Za-z-]+)*$/;

export function isNightlyDesktopVersion(version: string): boolean {
  return NIGHTLY_VERSION_PATTERN.test(version);
}

/**
 * Sigma is the self-built channel: a build made from a working copy that
 * installs beside a released app rather than over it, with its own bundle id,
 * user data, T3 home and no update feed. Sigma is never published, so it is not
 * a `DesktopUpdateChannel`.
 */
export function isSigmaDesktopVersion(version: string): boolean {
  return SIGMA_VERSION_PATTERN.test(version);
}

export function resolveDefaultDesktopUpdateChannel(appVersion: string): DesktopUpdateChannel {
  return isNightlyDesktopVersion(appVersion) ? "nightly" : "latest";
}
