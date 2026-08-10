/**
 * Provider-native subagent contracts.
 *
 * A provider harness may spawn nested agents that share the owner's real
 * provider session. aqqua materializes each native child as an ordinary durable
 * child thread for display and projection, while keeping the owner thread as
 * the only session authority.
 *
 * @module providerSubagents
 */
import * as Schema from "effect/Schema";

import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderDriverKind } from "./providerInstance.ts";

/**
 * Optional target on a `ProviderRuntimeEvent` that identifies a native harness
 * subagent. `ProviderRuntimeEvent.threadId` remains the aqqua owner thread that
 * holds the real provider session; ingestion derives a deterministic child
 * thread id from this target and routes the event there.
 */
export const ProviderSubagentTarget = Schema.Struct({
  /** Provider-local native child identifier (scoped by owner + provider). */
  childId: TrimmedNonEmptyString,
  /**
   * Optional native parent child id when the provider nests subagents.
   * Ingestion maps this to the deterministic aqqua parent thread id; the
   * provider parent does not need to have arrived first.
   */
  parentChildId: Schema.optional(TrimmedNonEmptyString),
  /** Optional display title for first-time materialization. */
  title: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderSubagentTarget = typeof ProviderSubagentTarget.Type;

/**
 * Durable binding stored on a materialised native-child thread.
 *
 * `parentThreadId` alone is insufficient: AgentControl interprets that edge as
 * an aqqua-managed sub-agent. This binding marks the thread as provider-native
 * display state whose session authority is `ownerThreadId`.
 */
export const ProviderSubagentBinding = Schema.Struct({
  ownerThreadId: ThreadId,
  provider: ProviderDriverKind,
  childId: TrimmedNonEmptyString,
  /** Echo of the native parent child id when one was supplied at creation. */
  parentChildId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});
export type ProviderSubagentBinding = typeof ProviderSubagentBinding.Type;
