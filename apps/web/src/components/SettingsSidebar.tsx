import { useLocation } from "@tanstack/react-router";
import { isElectron } from "../env";
import { SettingsSidebarNav } from "./settings/SettingsSidebarNav";
import { SidebarChromeHeader } from "./sidebar/SidebarChrome";

/** Section navigation shown only while the user is in Settings. */
export default function SettingsSidebar() {
  const pathname = useLocation({ select: (location) => location.pathname });

  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SettingsSidebarNav pathname={pathname} />
    </>
  );
}
