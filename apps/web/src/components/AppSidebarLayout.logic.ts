export type AppSidebarVariant = "settings" | "regular" | "worktree";

export function resolveAppSidebarVariant(input: {
  readonly isOnSettings: boolean;
  readonly worktreeViewEnabled: boolean;
}): AppSidebarVariant {
  if (input.isOnSettings) return "settings";
  return input.worktreeViewEnabled ? "worktree" : "regular";
}
