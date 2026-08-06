/**
 * projectAvatar - deterministic gradient avatars for projects.
 *
 * A local port of vercel/avatar (https://github.com/vercel/avatar): the seed's
 * SHA-1 byte sum picks a hue, and the avatar is a diagonal gradient from that
 * hue to its triad partner. Rendering locally keeps icons working offline and
 * over relay, and keeps project names off the network.
 *
 * Surfaces render from these primitives natively (inline SVG on web, the SVG
 * string on mobile) so an avatar costs no request and no image decode.
 *
 * @module projectAvatar
 */
import { sha1 } from "@noble/hashes/legacy";

/** Saturation and lightness vercel/avatar fixes for the first gradient stop. */
const AVATAR_SATURATION = 0.95;
const AVATAR_LIGHTNESS = 0.5;
/** A triad rotation, which is where vercel/avatar takes the second stop from. */
const TRIAD_DEGREES = 120;

export const PROJECT_AVATAR_TEXT_MAX_LENGTH = 3;
export const PROJECT_AVATAR_SEED_MAX_LENGTH = 256;

/** Hues closer than this read as the same colour in a picker grid. */
const VARIANT_MIN_HUE_DISTANCE = 20;
const VARIANT_SEARCH_LIMIT = 512;

export interface ProjectAvatarGradient {
  readonly fromColor: string;
  readonly toColor: string;
}

/**
 * Hue for a seed, in `[0, 360)`.
 *
 * Sums the seed's SHA-1 bytes exactly as vercel/avatar does, so the same seed
 * yields the same colour here and on avatar.vercel.sh.
 */
export function projectAvatarHue(seed: string): number {
  let sum = 0;
  for (const byte of sha1(seed)) {
    sum += byte;
  }
  return sum % 360;
}

function hueToChannel(p: number, q: number, hue: number): number {
  const t = hue < 0 ? hue + 1 : hue > 1 ? hue - 1 : hue;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToHex(hueDegrees: number): string {
  const hue = hueDegrees / 360;
  const q =
    AVATAR_LIGHTNESS < 0.5
      ? AVATAR_LIGHTNESS * (1 + AVATAR_SATURATION)
      : AVATAR_LIGHTNESS + AVATAR_SATURATION - AVATAR_LIGHTNESS * AVATAR_SATURATION;
  const p = 2 * AVATAR_LIGHTNESS - q;
  const channels = [
    hueToChannel(p, q, hue + 1 / 3),
    hueToChannel(p, q, hue),
    hueToChannel(p, q, hue - 1 / 3),
  ];
  return `#${channels
    .map((channel) =>
      Math.round(channel * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** Gradient stops for a seed. */
export function projectAvatarGradient(seed: string): ProjectAvatarGradient {
  const hue = projectAvatarHue(seed);
  return {
    fromColor: hslToHex(hue),
    toColor: hslToHex((hue + TRIAD_DEGREES) % 360),
  };
}

/**
 * A stable SVG gradient id for a seed.
 *
 * Keyed by hue so inlining several avatars in one document never collides, and
 * so avatars that share a hue can share one gradient definition.
 */
export function projectAvatarGradientId(seed: string): string {
  return `aqqua-project-avatar-${projectAvatarHue(seed)}`;
}

/**
 * Default initials for a project title.
 *
 * Two words give their first letters ("Aqqua Server" -> "AS"); one word gives
 * its first two ("aqqua" -> "AQ"). Returns "" when the title has no letters or
 * digits to draw from, which renders a plain gradient.
 */
export function projectAvatarInitials(title: string): string {
  const words = title.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 0);
  const [first, second] = words;
  if (first === undefined) return "";
  const initials = second === undefined ? first.slice(0, 2) : `${first[0]}${second[0]}`;
  return initials.toUpperCase();
}

/**
 * Distinct seeds to offer in a picker, starting from `base`.
 *
 * Derived seeds keep the avatar reproducible from the stored string alone.
 * Candidates whose hue sits too close to one already chosen are skipped so the
 * grid reads as a set of choices rather than a row of near-duplicates.
 */
export function projectAvatarSeedVariants(base: string, count: number): ReadonlyArray<string> {
  const seeds: string[] = [];
  const hues: number[] = [];
  const baseDigest = Array.from(sha1(base), (byte) => byte.toString(16).padStart(2, "0")).join("");
  for (let attempt = 0; attempt < VARIANT_SEARCH_LIMIT && seeds.length < count; attempt += 1) {
    const suffix = attempt === 0 ? "" : `~${attempt}`;
    const seed =
      base.length + suffix.length <= PROJECT_AVATAR_SEED_MAX_LENGTH
        ? `${base}${suffix}`
        : `${base.slice(
            0,
            PROJECT_AVATAR_SEED_MAX_LENGTH - baseDigest.length - suffix.length - 1,
          )}~${baseDigest}${suffix}`;
    const hue = projectAvatarHue(seed);
    const tooClose = hues.some((taken) => {
      const distance = Math.abs(taken - hue);
      return Math.min(distance, 360 - distance) < VARIANT_MIN_HUE_DISTANCE;
    });
    if (tooClose) continue;
    seeds.push(seed);
    hues.push(hue);
  }
  return seeds;
}

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => XML_ESCAPES[character] ?? character);
}

/**
 * Render an avatar as a standalone SVG document.
 *
 * Mirrors vercel/avatar's markup, including its `size * 0.9 / length` text
 * sizing. Web renders the same shape as JSX instead; this string is for
 * surfaces that need an image source.
 */
export function projectAvatarSvg(input: {
  readonly seed: string;
  readonly text?: string | undefined;
  readonly size?: number | undefined;
  readonly rounded?: number | undefined;
}): string {
  const size = input.size ?? 120;
  const rounded = input.rounded ?? 0;
  const gradient = projectAvatarGradient(input.seed);
  const gradientId = projectAvatarGradientId(input.seed);
  const text = input.text ?? "";
  const label =
    text.length > 0
      ? `<text x="50%" y="50%" alignment-baseline="central" dominant-baseline="central" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="${(size * 0.9) / text.length}">${escapeXml(text)}</text>`
      : "";
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" version="1.1" xmlns="http://www.w3.org/2000/svg"><g><defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${gradient.fromColor}"/><stop offset="100%" stop-color="${gradient.toColor}"/></linearGradient></defs><rect fill="url(#${gradientId})" x="0" y="0" width="${size}" height="${size}" rx="${rounded}" ry="${rounded}"/>${label}</g></svg>`;
}
