export type AppSidebarSurface = "settings" | "conversations";

export function resolveAppSidebarSurface(pathname: string): AppSidebarSurface {
  return pathname === "/settings" || pathname.startsWith("/settings/")
    ? "settings"
    : "conversations";
}
