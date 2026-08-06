import { ChartNoAxesCombinedIcon, SettingsIcon } from "lucide-react";
import { memo, useCallback, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";

import { cn } from "../../lib/utils";
import { AqquaMark } from "../AqquaMark";
import {
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdatePill } from "./SidebarUpdatePill";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
  trailing,
}: {
  isElectron: boolean;
  /**
   * Sits at the right edge of the brand row. The workspace switcher lives
   * here rather than above the list: it names the surface you are on, which
   * belongs with the app's own chrome and not with the list's filters.
   */
  trailing?: ReactNode;
}) {
  return (
    <SidebarHeader
      className={cn(
        "@container/sidebar-header relative h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center px-3 py-0 md:px-0",
        isElectron && "drag-region",
      )}
    >
      <SidebarTrigger className="relative z-10 md:hidden" />
      <SidebarBrand />
      {trailing ? <div className="relative z-10 ml-auto pr-3 md:pr-2">{trailing}</div> : null}
    </SidebarHeader>
  );
});

function SidebarBrand() {
  return (
    <Link
      aria-label="Go to threads"
      className="sidebar-brand z-10 h-7 w-fit min-w-0 shrink-0 items-center justify-center overflow-hidden rounded-md text-foreground outline-hidden ring-ring focus-visible:ring-2"
      to="/"
    >
      <BrandLogo />
    </Link>
  );
}

function BrandLogo() {
  // The crest is a wide lockup (340x105), not a square icon: fix the height and
  // let the width follow, or it distorts. Pure black on light and pure white on
  // dark — the mark is set harder than the surrounding ink on purpose, so it
  // does not inherit the foreground token.
  return <AqquaMark className="h-4 w-auto shrink-0 text-black dark:text-white" />;
}

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();
  const handleUsageClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/usage" });
  }, [isMobile, navigate, setOpenMobile]);
  const handleSettingsClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/settings" });
  }, [isMobile, navigate, setOpenMobile]);

  return (
    <SidebarFooter className="p-2">
      <SidebarProviderUpdatePill />
      <SidebarUpdatePill />
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton isActive={pathname === "/usage"} onClick={handleUsageClick}>
            <ChartNoAxesCombinedIcon />
            <span>Usage</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton onClick={handleSettingsClick}>
            <SettingsIcon />
            <span>Settings</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  );
});
