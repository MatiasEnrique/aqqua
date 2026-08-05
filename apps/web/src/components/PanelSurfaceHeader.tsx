import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface PanelSurfaceHeaderProps {
  readonly icon: LucideIcon;
  readonly title: ReactNode;
  readonly meta?: ReactNode;
  readonly actions?: ReactNode;
}

export function PanelSurfaceHeader({ icon: Icon, title, meta, actions }: PanelSurfaceHeaderProps) {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border px-3">
      <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 truncate">{title}</span>
        {meta !== undefined ? (
          <span className="min-w-0 truncate font-normal text-muted-foreground">{meta}</span>
        ) : null}
      </div>
      {actions !== undefined ? (
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      ) : null}
    </div>
  );
}
