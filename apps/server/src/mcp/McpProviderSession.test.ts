import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";

import { agentSessionEnvironment, type McpProviderSessionConfig } from "./McpProviderSession.ts";

it("builds the canonical agent session environment and strips the bearer prefix", () => {
  const session: McpProviderSessionConfig = {
    environmentId: EnvironmentId.make("environment-1"),
    threadId: ThreadId.make("thread-1"),
    providerSessionId: "provider-session-1",
    providerInstanceId: ProviderInstanceId.make("cursor"),
    endpoint: "http://127.0.0.1:5173/mcp",
    origin: "http://127.0.0.1:5173",
    authorizationHeader: "Bearer agent-token",
  };

  expect(agentSessionEnvironment(session)).toEqual({
    T3_AGENT_TOKEN: "agent-token",
    T3_AGENT_API: "http://127.0.0.1:5173",
    T3_THREAD_ID: "thread-1",
  });
});
