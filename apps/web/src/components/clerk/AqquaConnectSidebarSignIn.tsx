import { UserButton, useAuth } from "@clerk/react";
import { REMOTE_CONNECTIONS_UI_ENABLED } from "@aqqua/shared/productFeatures";
import { LogInIcon, SmartphoneIcon } from "lucide-react";

import { hasCloudPublicConfig } from "../../cloud/publicConfig";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { MobileClientsUserProfilePage } from "./MobileClientsUserProfilePage";
import { useAqquaConnectAuthPrompt } from "./useAqquaConnectAuthPrompt";

export function AqquaConnectSidebarSignIn() {
  if (!REMOTE_CONNECTIONS_UI_ENABLED || !hasCloudPublicConfig()) return null;

  return <ConfiguredAqquaConnectSidebarSignIn />;
}

export function AqquaConnectSidebarAvatar() {
  if (!REMOTE_CONNECTIONS_UI_ENABLED || !hasCloudPublicConfig()) return null;

  return <ConfiguredAqquaConnectSidebarAvatar />;
}

function ConfiguredAqquaConnectSidebarAvatar() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded || !isSignedIn) return null;

  return (
    <UserButton
      appearance={{
        elements: {
          avatarBox: "size-7",
          userButtonTrigger: "rounded-lg p-1 hover:bg-sidebar-row-hover",
        },
      }}
    >
      <UserButton.UserProfilePage
        label="Mobile clients"
        labelIcon={<SmartphoneIcon className="size-4" />}
        url="mobile-clients"
      >
        <MobileClientsUserProfilePage />
      </UserButton.UserProfilePage>
    </UserButton>
  );
}

function ConfiguredAqquaConnectSidebarSignIn() {
  const { isLoaded, isSignedIn } = useAuth();
  const { authPrompt, openAuthPrompt } = useAqquaConnectAuthPrompt();

  if (!isLoaded || isSignedIn) return null;

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="sm"
            className="h-8 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground/80 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
            onClick={openAuthPrompt}
          >
            <LogInIcon className="size-4 shrink-0" />
            <span>Sign in to aqqua Connect</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      {authPrompt}
    </>
  );
}
