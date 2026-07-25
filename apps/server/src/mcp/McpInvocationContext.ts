import {
  type EnvironmentId,
  PreviewAutomationUnavailableError,
  type ProviderInstanceId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

/**
 * Capabilities a provider-scoped credential may carry.
 *
 * - `preview`: collaborative browser automation.
 * - `agent-control`: orchestrator → sub-agent delegation, used by the `t3 agent`
 *   CLI. Holding it does not imply a thread may delegate; `AgentControl` refuses
 *   to delegate from a thread with a persisted parent edge.
 */
export type McpCapability = "preview" | "agent-control";

export interface McpInvocationScope {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly capabilities: ReadonlySet<McpCapability>;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export class McpInvocationContext extends Context.Service<
  McpInvocationContext,
  McpInvocationScope
>()("t3/mcp/McpInvocationContext") {}

/**
 * Assert the preview capability.
 *
 * Narrowed to `"preview"` because the failure it raises is preview-shaped.
 * Agent-control callers check `capabilities` directly and answer with their own
 * HTTP status rather than borrowing a browser-automation error.
 */
export const requireMcpCapability = Effect.fn("mcp.requireCapability")(function* (
  capability: Extract<McpCapability, "preview">,
) {
  const invocation = yield* McpInvocationContext;
  if (!invocation.capabilities.has(capability)) {
    return yield* new PreviewAutomationUnavailableError({
      capability,
      environmentId: invocation.environmentId,
      threadId: invocation.threadId,
      providerSessionId: invocation.providerSessionId,
      providerInstanceId: invocation.providerInstanceId,
    });
  }
  return invocation;
});
