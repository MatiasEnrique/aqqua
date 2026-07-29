const WORKSPACE_TERMINAL_OWNER_PREFIX = "workspace-root:";

export function normalizeTerminalWorkspaceRoot(workspaceRoot: string): string {
  const normalized = workspaceRoot.trim().replaceAll("\\", "/").replace(/\/+$/, "");
  return normalized.length > 0 ? normalized : "/";
}

export function workspaceTerminalOwnerThreadId(workspaceRoot: string): string {
  return `${WORKSPACE_TERMINAL_OWNER_PREFIX}${normalizeTerminalWorkspaceRoot(workspaceRoot)}`;
}

export function isWorkspaceTerminalOwnerThreadId(threadId: string): boolean {
  return threadId.startsWith(WORKSPACE_TERMINAL_OWNER_PREFIX);
}
