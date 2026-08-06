import type { ProjectIcon } from "@aqqua/contracts";
import { projectAvatarSvg } from "@aqqua/shared/projectAvatar";
import { useMemo } from "react";
import { SvgXml } from "react-native-svg";

/** A locally generated project avatar shared by mobile rows, headers, and pickers. */
export function ProjectAvatar(props: {
  readonly icon: ProjectIcon;
  readonly projectTitle: string;
  readonly size: number;
}) {
  const xml = useMemo(
    () =>
      projectAvatarSvg({
        seed: props.icon.seed,
        text: props.icon.text,
        size: props.size,
        rounded: Math.round(props.size * 0.16),
      }),
    [props.icon.seed, props.icon.text, props.size],
  );

  return (
    <SvgXml
      xml={xml}
      width={props.size}
      height={props.size}
      accessibilityLabel={`${props.projectTitle} icon`}
    />
  );
}
