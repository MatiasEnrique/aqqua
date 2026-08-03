import type { DesktopBridge, DesktopWslState } from "@aqqua/contracts";
import { REMOTE_CONNECTIONS_UI_ENABLED } from "@aqqua/shared/productFeatures";

type WslEnableBridge = Pick<DesktopBridge, "setWslBackendEnabled" | "setWslDistro" | "setWslOnly">;

export function resolveConnectionsSettingsAvailability(input: {
  readonly canManageLocalBackend: boolean;
  readonly hasDesktopBridge: boolean;
  readonly addBackendDialogOpen: boolean;
  readonly savedBackendMode: "remote" | "ssh";
}) {
  const remoteControlsVisible = REMOTE_CONNECTIONS_UI_ENABLED;

  return {
    localBackendControlsVisible: input.canManageLocalBackend,
    remoteControlsVisible,
    loadAccessManagement: remoteControlsVisible && input.canManageLocalBackend,
    loadNetworkAccess:
      remoteControlsVisible && input.canManageLocalBackend && input.hasDesktopBridge,
    loadSshHosts:
      remoteControlsVisible &&
      input.hasDesktopBridge &&
      input.addBackendDialogOpen &&
      input.savedBackendMode === "ssh",
  } as const;
}

export async function applyWslEnableSelection(input: {
  readonly bridge: WslEnableBridge;
  readonly mode: "both" | "wsl-only";
  readonly nextDistro: string | null;
  readonly persistedDistro: string | null;
}): Promise<DesktopWslState> {
  const { bridge, mode, nextDistro, persistedDistro } = input;

  // Stage every preference before enabling. The desktop only relaunches for
  // mode/distro changes while WSL is active, so the final enable observes the
  // complete selection and is the only call that may relaunch.
  await bridge.setWslOnly(mode === "wsl-only");
  if (persistedDistro !== nextDistro) {
    await bridge.setWslDistro(nextDistro);
  }
  return await bridge.setWslBackendEnabled(true);
}
