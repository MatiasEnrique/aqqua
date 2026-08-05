/**
 * Typed failures for orchestrator → sub-agent delegation.
 *
 * Error messages name profiles, thread ids, and roles — never credentials,
 * worktree paths, or orchestration command shapes. These messages are surfaced
 * to the orchestrating agent, so anything in them is effectively disclosed to a
 * model.
 *
 * Model-catalog failures are the one place instance ids appear: an orchestrator
 * selects a row *by* instance id and lists them through `agent models`, so
 * naming the id it just typed discloses nothing it did not already hold. The
 * legacy profile errors keep hiding instance ids, because a profile's target is
 * machine-local configuration the caller never named.
 *
 * @module agent-control/Errors
 */
import { ProviderInstanceId, ThreadId } from "@aqqua/contracts";
import * as Schema from "effect/Schema";

const ProfileName = Schema.String;
const ModelSlug = Schema.String;

export class AgentProfileUnknownError extends Schema.TaggedErrorClass<AgentProfileUnknownError>()(
  "AgentProfileUnknownError",
  {
    profile: ProfileName,
    availableProfiles: Schema.Array(ProfileName),
  },
) {
  override get message(): string {
    const available =
      this.availableProfiles.length === 0
        ? "no agent profiles are configured"
        : `configured profiles: ${this.availableProfiles.join(", ")}`;
    return `Unknown agent profile '${this.profile}' (${available}).`;
  }
}

export class AgentProfileUnavailableError extends Schema.TaggedErrorClass<AgentProfileUnavailableError>()(
  "AgentProfileUnavailableError",
  {
    profile: ProfileName,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Agent profile '${this.profile}' is not usable: ${this.detail}`;
  }
}

export class AgentModelInstanceUnknownError extends Schema.TaggedErrorClass<AgentModelInstanceUnknownError>()(
  "AgentModelInstanceUnknownError",
  {
    instanceId: ProviderInstanceId,
    availableInstanceIds: Schema.Array(ProviderInstanceId),
  },
) {
  override get message(): string {
    const available =
      this.availableInstanceIds.length === 0
        ? "no provider instances are configured"
        : `configured instances: ${this.availableInstanceIds.join(", ")}`;
    return `Unknown provider instance '${this.instanceId}' (${available}).`;
  }
}

export class AgentModelInstanceUnavailableError extends Schema.TaggedErrorClass<AgentModelInstanceUnavailableError>()(
  "AgentModelInstanceUnavailableError",
  {
    instanceId: ProviderInstanceId,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Provider instance '${this.instanceId}' cannot run a sub-agent: ${this.detail}`;
  }
}

export class AgentModelUnknownError extends Schema.TaggedErrorClass<AgentModelUnknownError>()(
  "AgentModelUnknownError",
  {
    instanceId: ProviderInstanceId,
    model: ModelSlug,
    availableModels: Schema.Array(ModelSlug),
  },
) {
  override get message(): string {
    const available =
      this.availableModels.length === 0
        ? "it advertises no models"
        : `it offers: ${this.availableModels.join(", ")}`;
    return `Provider instance '${this.instanceId}' has no model '${this.model}' (${available}).`;
  }
}

export class AgentModelReasoningUnsupportedError extends Schema.TaggedErrorClass<AgentModelReasoningUnsupportedError>()(
  "AgentModelReasoningUnsupportedError",
  {
    instanceId: ProviderInstanceId,
    model: ModelSlug,
  },
) {
  override get message(): string {
    return `Model '${this.model}' on '${this.instanceId}' does not expose a reasoning level. Spawn it without one.`;
  }
}

export class AgentModelReasoningInvalidError extends Schema.TaggedErrorClass<AgentModelReasoningInvalidError>()(
  "AgentModelReasoningInvalidError",
  {
    instanceId: ProviderInstanceId,
    model: ModelSlug,
    reasoning: Schema.String,
    supported: Schema.Array(Schema.String),
  },
) {
  override get message(): string {
    return `Model '${this.model}' on '${this.instanceId}' does not support reasoning '${this.reasoning}' (supported: ${this.supported.join(", ")}).`;
  }
}

export class AgentModelCatalogEmptyError extends Schema.TaggedErrorClass<AgentModelCatalogEmptyError>()(
  "AgentModelCatalogEmptyError",
  {},
) {
  override get message(): string {
    return "No configured provider can run a sub-agent right now. Enable, install, or sign in to a provider in aqqua settings.";
  }
}

export type AgentModelCatalogError =
  | AgentModelInstanceUnknownError
  | AgentModelInstanceUnavailableError
  | AgentModelUnknownError
  | AgentModelReasoningUnsupportedError
  | AgentModelReasoningInvalidError
  | AgentModelCatalogEmptyError;

export class AgentParentNotFoundError extends Schema.TaggedErrorClass<AgentParentNotFoundError>()(
  "AgentParentNotFoundError",
  {
    parentThreadId: ThreadId,
  },
) {
  override get message(): string {
    return `Thread '${this.parentThreadId}' cannot delegate because it no longer exists or is archived.`;
  }
}

export class AgentWorkspaceNotFoundError extends Schema.TaggedErrorClass<AgentWorkspaceNotFoundError>()(
  "AgentWorkspaceNotFoundError",
  {},
) {
  override get message(): string {
    return "The current directory is not inside an aqqua project or one of its worktrees. Add the project in aqqua or run the command from one of its worktrees.";
  }
}

export class AgentNotOwnedError extends Schema.TaggedErrorClass<AgentNotOwnedError>()(
  "AgentNotOwnedError",
  {
    parentThreadId: ThreadId,
    childThreadId: ThreadId,
  },
) {
  override get message(): string {
    return `Thread '${this.childThreadId}' is not a sub-agent of thread '${this.parentThreadId}'.`;
  }
}

export class AgentRecursionDeniedError extends Schema.TaggedErrorClass<AgentRecursionDeniedError>()(
  "AgentRecursionDeniedError",
  {
    parentThreadId: ThreadId,
  },
) {
  override get message(): string {
    return `Thread '${this.parentThreadId}' is itself a sub-agent and may not delegate further.`;
  }
}

export class AgentConcurrencyLimitError extends Schema.TaggedErrorClass<AgentConcurrencyLimitError>()(
  "AgentConcurrencyLimitError",
  {
    parentThreadId: ThreadId,
    limit: Schema.Number,
  },
) {
  override get message(): string {
    return `Thread '${this.parentThreadId}' already has ${this.limit} sub-agents running. Wait for one to finish before spawning another.`;
  }
}

export class AgentBusyError extends Schema.TaggedErrorClass<AgentBusyError>()("AgentBusyError", {
  childThreadId: ThreadId,
}) {
  override get message(): string {
    return `Sub-agent '${this.childThreadId}' is still working on its current task.`;
  }
}

export class AgentLaunchFailedError extends Schema.TaggedErrorClass<AgentLaunchFailedError>()(
  "AgentLaunchFailedError",
  {
    profile: ProfileName,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Failed to start a '${this.profile}' sub-agent: ${this.detail}`;
  }
}

export class AgentTerminalRuntimeError extends Schema.TaggedErrorClass<AgentTerminalRuntimeError>()(
  "AgentTerminalRuntimeError",
  {
    childThreadId: ThreadId,
    operation: Schema.String,
  },
) {
  override get message(): string {
    return `Sub-agent '${this.childThreadId}' runs as an interactive CLI in its own terminal, so '${this.operation}' does not apply. Open its thread to watch or drive it.`;
  }
}

export class AgentDispatchError extends Schema.TaggedErrorClass<AgentDispatchError>()(
  "AgentDispatchError",
  {
    operation: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Agent control operation '${this.operation}' failed: ${this.detail}`;
  }
}

export type AgentControlError =
  | AgentProfileUnknownError
  | AgentProfileUnavailableError
  | AgentModelCatalogError
  | AgentParentNotFoundError
  | AgentWorkspaceNotFoundError
  | AgentNotOwnedError
  | AgentRecursionDeniedError
  | AgentConcurrencyLimitError
  | AgentBusyError
  | AgentLaunchFailedError
  | AgentTerminalRuntimeError
  | AgentDispatchError;
