import { useNavigate } from "@tanstack/react-router";
import { ChartNoAxesCombinedIcon, SettingsIcon } from "lucide-react";

/** Global utilities below the workspace, on the same surface as its sidebars. */
export function AppFooter() {
  const navigate = useNavigate();
  const actionClassName =
    "inline-flex size-6 cursor-pointer items-center justify-center rounded text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <footer
      data-app-footer
      aria-label="Workspace footer"
      className="hidden h-[var(--workspace-footer-height)] shrink-0 items-center gap-1 bg-sidebar px-2 pb-[env(safe-area-inset-bottom)] md:flex"
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Usage"
          title="Usage"
          className={actionClassName}
          onClick={() => void navigate({ to: "/usage" })}
        >
          <ChartNoAxesCombinedIcon aria-hidden className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Settings"
          title="Settings"
          className={actionClassName}
          onClick={() => void navigate({ to: "/settings" })}
        >
          <SettingsIcon aria-hidden className="size-4" />
        </button>
      </div>
    </footer>
  );
}
