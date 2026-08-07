import {
  type ClientOrchestrationCommand,
  CommandId,
  ORCHESTRATION_WS_METHODS,
} from "@aqqua/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import type { EnvironmentSupervisor } from "../connection/supervisor.ts";
import {
  type EnvironmentRpcFailure,
  type EnvironmentRpcSuccess,
  type EnvironmentRpcUnavailableError,
  request,
} from "../rpc/client.ts";

type CommandType = ClientOrchestrationCommand["type"];
type CommandOf<T extends CommandType> = Extract<ClientOrchestrationCommand, { readonly type: T }>;
type CommandInput<T extends CommandType> = Omit<
  CommandOf<T>,
  "type" | "commandId" | "createdAt"
> & {
  readonly commandId?: CommandId;
} & ("createdAt" extends keyof CommandOf<T>
    ? {
        readonly createdAt?: CommandOf<T>["createdAt"];
      }
    : Record<never, never>);

export type CreateProjectInput = CommandInput<"project.create">;
export type UpdateProjectInput = CommandInput<"project.meta.update">;
export type DeleteProjectInput = CommandInput<"project.delete">;
export type CreateThreadInput = CommandInput<"thread.create">;
export type DeleteThreadInput = CommandInput<"thread.delete">;
export type ArchiveThreadInput = CommandInput<"thread.archive">;
export type UnarchiveThreadInput = CommandInput<"thread.unarchive">;
export type SettleThreadInput = CommandInput<"thread.settle">;
export type UnsettleThreadInput = CommandInput<"thread.unsettle">;
export type SnoozeThreadInput = CommandInput<"thread.snooze">;
export type UnsnoozeThreadInput = CommandInput<"thread.unsnooze">;
export type UpdateThreadMetadataInput = CommandInput<"thread.meta.update">;
export type SetThreadRuntimeModeInput = CommandInput<"thread.runtime-mode.set">;
export type SetThreadInteractionModeInput = CommandInput<"thread.interaction-mode.set">;
export type StartThreadTurnInput = CommandInput<"thread.turn.start">;
export type InterruptThreadTurnInput = CommandInput<"thread.turn.interrupt">;
export type RespondToThreadApprovalInput = CommandInput<"thread.approval.respond">;
export type RespondToThreadUserInputInput = CommandInput<"thread.user-input.respond">;
export type RevertThreadCheckpointInput = CommandInput<"thread.checkpoint.revert">;
export type StopThreadSessionInput = CommandInput<"thread.session.stop">;
export type CreateBoardInput = CommandInput<"board.create">;
export type UpdateBoardInput = CommandInput<"board.update">;
export type DeleteBoardInput = CommandInput<"board.delete">;
export type CreateCardInput = CommandInput<"card.create">;
export type ReleaseCardInput = CommandInput<"card.release">;
export type ContinueCardInput = CommandInput<"card.continue">;
export type RetryCardInput = CommandInput<"card.retry">;
export type ResetCardInput = CommandInput<"card.reset">;
export type SettleCardInput = CommandInput<"card.settle">;
export type UnsettleCardInput = CommandInput<"card.unsettle">;
export type ArchiveCardInput = CommandInput<"card.archive">;
export type UnarchiveCardInput = CommandInput<"card.unarchive">;
export type DeleteCardInput = CommandInput<"card.delete">;

type DispatchTag = typeof ORCHESTRATION_WS_METHODS.dispatchCommand;
type CommandEffect = Effect.Effect<
  EnvironmentRpcSuccess<DispatchTag>,
  EnvironmentRpcFailure<DispatchTag> | EnvironmentRpcUnavailableError,
  Crypto.Crypto | EnvironmentSupervisor
>;

function commandId(input: { readonly commandId?: CommandId }) {
  return Effect.gen(function* () {
    if (input.commandId !== undefined) {
      return input.commandId;
    }
    const crypto = yield* Crypto.Crypto;
    return yield* crypto.randomUUIDv4.pipe(Effect.orDie, Effect.map(CommandId.make));
  });
}

function timestampedCommandMetadata(input: {
  readonly commandId?: CommandId;
  readonly createdAt?: string;
}) {
  return Effect.all({
    commandId: commandId(input),
    createdAt:
      input.createdAt === undefined
        ? DateTime.now.pipe(Effect.map(DateTime.formatIso))
        : Effect.succeed(input.createdAt),
  });
}

function dispatch(command: ClientOrchestrationCommand) {
  return request(ORCHESTRATION_WS_METHODS.dispatchCommand, command);
}

export const createProject: (input: CreateProjectInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.createProject",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "project.create",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const updateProject: (input: UpdateProjectInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.updateProject",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "project.meta.update",
    commandId: yield* commandId(input),
  });
});

export const deleteProject: (input: DeleteProjectInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.deleteProject",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "project.delete",
    commandId: yield* commandId(input),
  });
});

export const createThread: (input: CreateThreadInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.createThread",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "thread.create",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const deleteThread: (input: DeleteThreadInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.deleteThread",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "thread.delete",
    commandId: yield* commandId(input),
  });
});

export const archiveThread: (input: ArchiveThreadInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.archiveThread",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "thread.archive",
    commandId: yield* commandId(input),
  });
});

export const unarchiveThread: (input: UnarchiveThreadInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.unarchiveThread",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "thread.unarchive",
    commandId: yield* commandId(input),
  });
});

export const settleThread: (input: SettleThreadInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.settleThread",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "thread.settle",
    commandId: yield* commandId(input),
  });
});

export const unsettleThread: (input: UnsettleThreadInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.unsettleThread",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "thread.unsettle",
    commandId: yield* commandId(input),
  });
});

export const snoozeThread: (input: SnoozeThreadInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.snoozeThread",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "thread.snooze",
    commandId: yield* commandId(input),
  });
});

export const unsnoozeThread: (input: UnsnoozeThreadInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.unsnoozeThread",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "thread.unsnooze",
    commandId: yield* commandId(input),
  });
});

export const updateThreadMetadata: (input: UpdateThreadMetadataInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.updateThreadMetadata",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "thread.meta.update",
    commandId: yield* commandId(input),
  });
});

export const setThreadRuntimeMode: (input: SetThreadRuntimeModeInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.setThreadRuntimeMode",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "thread.runtime-mode.set",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const setThreadInteractionMode: (input: SetThreadInteractionModeInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.setThreadInteractionMode")(function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.interaction-mode.set",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  });

export const startThreadTurn: (input: StartThreadTurnInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.startThreadTurn",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "thread.turn.start",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const interruptThreadTurn: (input: InterruptThreadTurnInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.interruptThreadTurn",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "thread.turn.interrupt",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const respondToThreadApproval: (input: RespondToThreadApprovalInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.respondToThreadApproval")(function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.approval.respond",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  });

export const respondToThreadUserInput: (input: RespondToThreadUserInputInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.respondToThreadUserInput")(function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.user-input.respond",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  });

export const revertThreadCheckpoint: (input: RevertThreadCheckpointInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.revertThreadCheckpoint")(function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.checkpoint.revert",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  });

export const stopThreadSession: (input: StopThreadSessionInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.stopThreadSession",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "thread.session.stop",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const createBoard: (input: CreateBoardInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.createBoard",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "board.create",
    commandId: yield* commandId(input),
  });
});

export const updateBoard: (input: UpdateBoardInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.updateBoard",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "board.update",
    commandId: yield* commandId(input),
  });
});

export const deleteBoard: (input: DeleteBoardInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.deleteBoard",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "board.delete",
    commandId: yield* commandId(input),
  });
});

export const createCard: (input: CreateCardInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.createCard",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "card.create",
    commandId: yield* commandId(input),
  });
});

export const releaseCard: (input: ReleaseCardInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.releaseCard",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "card.release",
    commandId: yield* commandId(input),
  });
});

export const continueCard: (input: ContinueCardInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.continueCard",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "card.continue",
    commandId: yield* commandId(input),
  });
});

export const retryCard: (input: RetryCardInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.retryCard",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "card.retry",
    commandId: yield* commandId(input),
  });
});

export const resetCard: (input: ResetCardInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.resetCard",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "card.reset",
    commandId: yield* commandId(input),
  });
});

export const settleCard: (input: SettleCardInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.settleCard",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "card.settle",
    commandId: yield* commandId(input),
  });
});

export const unsettleCard: (input: UnsettleCardInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.unsettleCard",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "card.unsettle",
    commandId: yield* commandId(input),
  });
});

export const archiveCard: (input: ArchiveCardInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.archiveCard",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "card.archive",
    commandId: yield* commandId(input),
  });
});

export const unarchiveCard: (input: UnarchiveCardInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.unarchiveCard",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "card.unarchive",
    commandId: yield* commandId(input),
  });
});

export const deleteCard: (input: DeleteCardInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.deleteCard",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "card.delete",
    commandId: yield* commandId(input),
  });
});
