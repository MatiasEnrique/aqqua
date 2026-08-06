import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./orchestration.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";
import { ServerProviderModel } from "./server.ts";

export const AgentRunStatus = Schema.Literals(["completed", "failed", "interrupted", "running"]);
export type AgentRunStatus = typeof AgentRunStatus.Type;

/**
 * What an orchestrator asks for when it delegates.
 *
 * Canonically the caller names a catalog row — `modelSelection` plus an
 * optional `reasoning` level resolved against that model's advertised choices.
 * Omitting both is also canonical and means "the project default, or the
 * catalog's deterministic fallback".
 *
 * `profile` is the legacy selector and stays decodable so un-migrated clients
 * and scripts keep working. Combining it with `modelSelection`/`reasoning` is
 * rejected at the transport seam rather than here, so the failure can name the
 * flag the caller actually typed.
 */
export const AgentSpawnRequest = Schema.Struct({
  task: Schema.String,
  title: Schema.optional(Schema.String),
  modelSelection: Schema.optional(ModelSelection),
  /** Semantic reasoning level; validated against the selected model's choices. */
  reasoning: Schema.optional(TrimmedNonEmptyString),
  /** @deprecated Legacy profile selector, retained for wire compatibility. */
  profile: Schema.optional(Schema.String),
});
export type AgentSpawnRequest = typeof AgentSpawnRequest.Type;

export const AgentStandaloneSpawnRequest = Schema.Struct({
  ...AgentSpawnRequest.fields,
  cwd: Schema.String,
});
export type AgentStandaloneSpawnRequest = typeof AgentStandaloneSpawnRequest.Type;

export const AgentSpawnResponse = Schema.Struct({
  threadId: Schema.String,
  profile: Schema.String,
  terminalId: Schema.NullOr(Schema.String),
});
export type AgentSpawnResponse = typeof AgentSpawnResponse.Type;

export const AgentSendRequest = Schema.Struct({
  threadId: Schema.String,
  message: Schema.String,
});
export type AgentSendRequest = typeof AgentSendRequest.Type;

export const AgentSendResponse = AgentSpawnResponse;
export type AgentSendResponse = typeof AgentSendResponse.Type;

export const AgentAwaitRequest = Schema.Struct({
  threadId: Schema.String,
  timeoutMs: Schema.optional(Schema.Number),
});
export type AgentAwaitRequest = typeof AgentAwaitRequest.Type;

export const AgentAwaitResponse = Schema.Struct({
  threadId: Schema.String,
  status: AgentRunStatus,
  finalMessage: Schema.NullOr(Schema.String),
  sequence: Schema.Number,
});
export type AgentAwaitResponse = typeof AgentAwaitResponse.Type;

export const AgentInterruptRequest = Schema.Struct({
  threadId: Schema.String,
});
export type AgentInterruptRequest = typeof AgentInterruptRequest.Type;

export const AgentInterruptResponse = Schema.Struct({
  interrupted: Schema.String,
});
export type AgentInterruptResponse = typeof AgentInterruptResponse.Type;

export const AgentListItem = Schema.Struct({
  threadId: Schema.String,
  profile: Schema.NullOr(Schema.String),
  title: Schema.String,
  status: AgentRunStatus,
  updatedAt: Schema.String,
});
export type AgentListItem = typeof AgentListItem.Type;

export const AgentListResponse = Schema.Struct({
  agents: Schema.Array(AgentListItem),
});
export type AgentListResponse = typeof AgentListResponse.Type;

export const AgentProfileListItem = Schema.Struct({
  name: Schema.String,
  runtime: Schema.String,
  driver: Schema.NullOr(Schema.String),
  /**
   * Model the profile resolves to right now — what a spawn would actually run.
   * `null` when the profile cannot resolve, in which case `unavailable` says why.
   */
  model: Schema.NullOr(Schema.String),
  /**
   * Whether the profile pins `model` itself. A profile that inherits instead
   * silently follows the project default, which is how a sub-agent ends up on a
   * model nobody chose — worth seeing before spawning, not after.
   */
  pinsModel: Schema.Boolean,
  titlePrefix: Schema.NullOr(Schema.String),
  /** `null` when the profile is ready to spawn; otherwise why it is not. */
  unavailable: Schema.NullOr(Schema.String),
});
export type AgentProfileListItem = typeof AgentProfileListItem.Type;

export const AgentProfilesResponse = Schema.Struct({
  profiles: Schema.Array(AgentProfileListItem),
});
export type AgentProfilesResponse = typeof AgentProfilesResponse.Type;

/**
 * One spawnable (or knowingly unspawnable) provider-instance/model pair.
 *
 * Rows are derived from the provider registry's current cached/live snapshots,
 * never by refreshing provider CLIs during catalog reads.
 * The whole `ServerProviderModel` rides along because reasoning choices live in
 * its `capabilities.optionDescriptors` — a client that renders a reasoning
 * picker needs the same data the server validates against.
 */
export const AgentModelListItem = Schema.Struct({
  instanceId: ProviderInstanceId,
  driver: ProviderDriverKind,
  providerName: Schema.String,
  model: ServerProviderModel,
  /** Whether a spawn against this row would be accepted right now. */
  available: Schema.Boolean,
  /** `null` when spawnable; otherwise why not, in the provider's own words. */
  unavailableReason: Schema.NullOr(Schema.String),
  /**
   * Whether an unselected spawn resolves here: the configured project default,
   * or the catalog fallback when the project has no configured default.
   * A configured-but-unavailable default remains marked and fails on resolution.
   */
  isProjectDefault: Schema.Boolean,
});
export type AgentModelListItem = typeof AgentModelListItem.Type;

export const AgentModelsResponse = Schema.Struct({
  models: Schema.Array(AgentModelListItem),
});
export type AgentModelsResponse = typeof AgentModelsResponse.Type;

export const AgentErrorResponse = Schema.Struct({
  error: Schema.String,
  message: Schema.String,
});
export type AgentErrorResponse = typeof AgentErrorResponse.Type;
