export type AppSidebarVariant = "settings" | "regular" | "v2";

export function resolveAppSidebarVariant(input: {
  readonly isOnSettings: boolean;
  readonly sidebarV2Enabled: boolean;
}): AppSidebarVariant {
  if (input.isOnSettings) return "settings";
  return input.sidebarV2Enabled ? "v2" : "regular";
}
