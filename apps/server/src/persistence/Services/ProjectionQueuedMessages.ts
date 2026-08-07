import {
  OrchestrationQueuedMessage,
  ThreadId,
  MessageId,
  type OrchestrationQueuedMessage as OrchestrationQueuedMessageType,
} from "@aqqua/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionQueuedMessage = Schema.Struct({
  threadId: ThreadId,
  ...OrchestrationQueuedMessage.fields,
});
export type ProjectionQueuedMessage = typeof ProjectionQueuedMessage.Type;

export interface ProjectionQueuedMessageRepositoryShape {
  readonly upsert: (
    input: { readonly threadId: ThreadId } & OrchestrationQueuedMessageType,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listByThreadId: (input: {
    readonly threadId: ThreadId;
  }) => Effect.Effect<ReadonlyArray<ProjectionQueuedMessage>, ProjectionRepositoryError>;
  readonly deleteByMessageId: (input: {
    readonly messageId: MessageId;
  }) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly deleteByThreadId: (input: {
    readonly threadId: ThreadId;
  }) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionQueuedMessageRepository extends Context.Service<
  ProjectionQueuedMessageRepository,
  ProjectionQueuedMessageRepositoryShape
>()("aqqua/persistence/Services/ProjectionQueuedMessages/ProjectionQueuedMessageRepository") {}
