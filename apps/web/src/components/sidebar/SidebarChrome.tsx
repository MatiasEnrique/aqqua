import { ChartNoAxesCombinedIcon, SettingsIcon } from "lucide-react";
import { memo, useCallback, type ReactNode } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { cn } from "../../lib/utils";
import { AqquaMark } from "../AqquaMark";
import { ConversationTabScrollControls } from "../chat/ConversationTabScrollControls";
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
  /** Search and navigation controls below the native titlebar. */
  trailing?: ReactNode;
}) {
  return (
    <SidebarHeader className={cn("shrink-0 gap-0 p-0", isElectron && "drag-region")}>
      {/* The row the tabs sit on across the divide. On desktop the traffic
        lights own its left and nothing owns its right, so the tab strip's
        paging arrows take that corner instead of eating room the tabs need.
        The row is always paid for, tabs or none: a surface without a strip —
        a flow with no card open, settings, usage — would otherwise drop it and
        pull every row beneath it up by the titlebar's height. */}
      <div className="hidden h-[var(--workspace-topbar-height)] shrink-0 items-center justify-end pr-3 md:flex">
        {/* A chevron's ink stops 4px short of its box, where the panel and
          folder glyphs below fill theirs. Sharing a box edge would leave the
          arrows visibly inset, so the group hangs into the padding to line
          the ink up instead. */}
        <ConversationTabScrollControls className="-mr-1" />
      </div>
      {/* The mark shares the controls row rather than holding a line of its
        own: on its own row it left the whole left half of this one empty. The
        row matches the titlebar height so it stacks cleanly under the row
        above it. */}
      <div className="flex h-[var(--workspace-topbar-height)] shrink-0 items-center gap-2 px-3 [-webkit-app-region:no-drag]">
        <div
          role="img"
          aria-label="aqqua"
          className="flex shrink-0 items-center text-sidebar-foreground"
        >
          <AqquaMark className="h-5 w-12" />
        </div>
        <div className="ml-auto flex items-center gap-1">
          {trailing}
          <SidebarTrigger
            className="size-7!"
            aria-label="Toggle main sidebar"
            title="Toggle main sidebar"
          />
        </div>
      </div>
    </SidebarHeader>
  );
});

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
    <SidebarFooter className="p-2 md:has-[>[data-slot=sidebar-menu]:only-child]:hidden">
      <SidebarProviderUpdatePill />
      <SidebarUpdatePill />
      <SidebarMenu className="md:hidden">
        <SidebarMenuItem>
          <SidebarMenuButton
            className="h-8 text-[13px]"
            isActive={pathname === "/usage"}
            onClick={handleUsageClick}
          >
            <ChartNoAxesCombinedIcon />
            <span>Usage</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton className="h-8 text-[13px]" onClick={handleSettingsClick}>
            <SettingsIcon />
            <span>Settings</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  );
});
