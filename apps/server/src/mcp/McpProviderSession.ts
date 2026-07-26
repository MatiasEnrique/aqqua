import type { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";

export interface McpProviderSessionConfig {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly endpoint: string;
  /**
   * Server origin behind `endpoint`, e.g. `http://127.0.0.1:5173`.
   *
   * Adapters pass this into the provider process so the `t3 agent` CLI can reach
   * this environment's agent API without being told where the server lives.
   */
  readonly origin: string;
  readonly authorizationHeader: string;
}

/**
 * Delegation identity for the `t3 agent` CLI, which runs inside the provider
 * session's shell. The parent thread is resolved server-side from the token,
 * so an agent cannot impersonate another thread even though it writes the
 * command line. `T3_THREAD_ID` is informational only.
 */
export function agentSessionEnvironment(session: McpProviderSessionConfig): Record<string, string> {
  return {
    T3_AGENT_TOKEN: session.authorizationHeader.replace(/^Bearer\s+/, ""),
    T3_AGENT_API: session.origin,
    T3_THREAD_ID: session.threadId,
  };
}

const sessionsByThread = new Map<ThreadId, McpProviderSessionConfig>();

export function setMcpProviderSession(config: McpProviderSessionConfig): void {
  sessionsByThread.set(config.threadId, config);
}

export function readMcpProviderSession(threadId: ThreadId): McpProviderSessionConfig | undefined {
  return sessionsByThread.get(threadId);
}

export function clearMcpProviderSession(threadId: ThreadId): void {
  sessionsByThread.delete(threadId);
}

export function clearAllMcpProviderSessions(): void {
  sessionsByThread.clear();
}
