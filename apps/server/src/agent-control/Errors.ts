/**
 * Typed failures for orchestrator → sub-agent delegation.
 *
 * Error messages name profiles, thread ids, and roles — never provider instance
 * ids, credentials, worktree paths, or orchestration command shapes. These
 * messages are surfaced to the orchestrating agent, so anything in them is
 * effectively disclosed to a model.
 *
 * @module agent-control/Errors
 */
import { ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const ProfileName = Schema.String;

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
  | AgentParentNotFoundError
  | AgentNotOwnedError
  | AgentRecursionDeniedError
  | AgentConcurrencyLimitError
  | AgentBusyError
  | AgentLaunchFailedError
  | AgentTerminalRuntimeError
  | AgentDispatchError;
