import type { EnvironmentId } from "@aqqua/contracts";
import { isProjectFaviconFallbackUrl } from "@aqqua/shared/projectFavicon";
import { FolderIcon } from "lucide-react";
import type { ComponentType } from "react";
import { useState } from "react";
import { useAssetUrl } from "../assets/assetUrls";
import { useProjectIcon } from "~/state/entities";
import { cn } from "~/lib/utils";
import { ProjectAvatar } from "./ProjectAvatar";

const loadedProjectFaviconSrcs = new Set<string>();

/**
 * A project's icon: the avatar its owner chose, else the favicon discovered in
 * its workspace, else a folder glyph.
 */
export function ProjectFavicon(input: {
  environmentId: EnvironmentId;
  cwd: string;
  className?: string | undefined;
  fallbackIcon?: ComponentType<{ className?: string }>;
}) {
  const icon = useProjectIcon(input.environmentId, input.cwd);

  // A chosen avatar renders from the read model alone, so it never asks for a
  // signed asset URL.
  if (icon !== null) {
    return <ProjectAvatar icon={icon} className={input.className} />;
  }

  return (
    <ProjectFaviconFromWorkspace
      environmentId={input.environmentId}
      cwd={input.cwd}
      className={input.className}
      {...(input.fallbackIcon !== undefined ? { fallbackIcon: input.fallbackIcon } : {})}
    />
  );
}

function ProjectFaviconFromWorkspace(input: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly className?: string | undefined;
  readonly fallbackIcon?: ComponentType<{ className?: string }>;
}) {
  const src = useAssetUrl(input.environmentId, {
    _tag: "project-favicon",
    cwd: input.cwd,
  });
  const FallbackIcon = input.fallbackIcon ?? FolderIcon;

  if (!src || isProjectFaviconFallbackUrl(src)) {
    return <ProjectFaviconFallback className={input.className} icon={FallbackIcon} />;
  }

  return (
    <ProjectFaviconImage
      key={src}
      src={src}
      className={input.className}
      fallbackIcon={FallbackIcon}
    />
  );
}

function ProjectFaviconFallback({
  className,
  icon: Icon,
}: {
  readonly className?: string | undefined;
  readonly icon: ComponentType<{ className?: string }>;
}) {
  return <Icon className={cn("size-3.5 shrink-0 text-muted-foreground/50", className)} />;
}

function ProjectFaviconImage({
  src,
  className,
  fallbackIcon: FallbackIcon,
}: {
  readonly src: string;
  readonly className?: string | undefined;
  readonly fallbackIcon: ComponentType<{ className?: string }>;
}) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(() =>
    loadedProjectFaviconSrcs.has(src) ? "loaded" : "loading",
  );

  return (
    <>
      {status !== "loaded" ? (
        <ProjectFaviconFallback className={className} icon={FallbackIcon} />
      ) : null}
      <img
        src={src}
        alt=""
        className={cn(
          "size-3.5 shrink-0 rounded-sm object-contain",
          status !== "loaded" && "hidden",
          className,
        )}
        onLoad={() => {
          loadedProjectFaviconSrcs.add(src);
          setStatus("loaded");
        }}
        onError={() => setStatus("error")}
      />
    </>
  );
}
