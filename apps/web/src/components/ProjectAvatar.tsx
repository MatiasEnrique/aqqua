import type { ProjectIcon } from "@aqqua/contracts";
import { projectAvatarGradient, projectAvatarGradientId } from "@aqqua/shared/projectAvatar";
import { cn } from "~/lib/utils";

/**
 * A project's generated gradient avatar, drawn inline.
 *
 * Inline SVG rather than an image request: the artwork is a pure function of
 * the seed, so it paints on first render with no round trip and stays crisp at
 * every size a row asks for.
 */
export function ProjectAvatar({
  icon,
  className,
  title,
}: {
  readonly icon: ProjectIcon;
  readonly className?: string | undefined;
  readonly title?: string | undefined;
}) {
  const gradient = projectAvatarGradient(icon.seed);
  const gradientId = projectAvatarGradientId(icon.seed);
  const text = icon.text ?? "";

  return (
    <svg
      viewBox="0 0 120 120"
      className={cn(
        "size-3.5 shrink-0 rounded-sm outline -outline-offset-1 outline-black/10 dark:outline-white/10",
        className,
      )}
      role="img"
      aria-label={title === undefined ? "" : `${title} icon`}
      aria-hidden={title === undefined}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={gradient.fromColor} />
          <stop offset="100%" stopColor={gradient.toColor} />
        </linearGradient>
      </defs>
      <rect fill={`url(#${gradientId})`} x="0" y="0" width="120" height="120" />
      {text.length > 0 ? (
        <text
          x="50%"
          y="50%"
          dominantBaseline="central"
          textAnchor="middle"
          fill="#fff"
          fontFamily="sans-serif"
          fontSize={(120 * 0.9) / text.length}
        >
          {text}
        </text>
      ) : null}
    </svg>
  );
}
