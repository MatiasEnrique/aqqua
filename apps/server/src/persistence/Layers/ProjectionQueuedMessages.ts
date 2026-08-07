import { ChatAttachment, ModelSelection } from "@aqqua/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  ProjectionQueuedMessage,
  ProjectionQueuedMessageRepository,
  type ProjectionQueuedMessageRepositoryShape,
} from "../Services/ProjectionQueuedMessages.ts";

const AttachmentsJson = Schema.fromJsonString(Schema.Array(ChatAttachment));
const ModelSelectionJson = Schema.fromJsonString(ModelSelection);
const encodeAttachments = Schema.encodeSync(AttachmentsJson);
const encodeModelSelection = Schema.encodeSync(Schema.UnknownFromJsonString);

const ProjectionQueuedMessageDbRow = ProjectionQueuedMessage.mapFields(
  Struct.assign({
    attachments: AttachmentsJson,
    modelSelection: ModelSelectionJson,
  }),
);

const makeProjectionQueuedMessageRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ProjectionQueuedMessage,
    execute: (message) =>
      sql`
        INSERT INTO projection_queued_messages (
          message_id,
          thread_id,
          text,
          attachments_json,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          created_at,
          sequence
        ) VALUES (
          ${message.messageId},
          ${message.threadId},
          ${message.text},
          ${encodeAttachments(message.attachments)},
          ${encodeModelSelection(message.modelSelection)},
          ${message.runtimeMode},
          ${message.interactionMode},
          ${message.createdAt},
          ${message.sequence}
        )
        ON CONFLICT (message_id)
        DO UPDATE SET
          thread_id = excluded.thread_id,
          text = excluded.text,
          attachments_json = excluded.attachments_json,
          model_selection_json = excluded.model_selection_json,
          runtime_mode = excluded.runtime_mode,
          interaction_mode = excluded.interaction_mode,
          created_at = excluded.created_at,
          sequence = excluded.sequence
      `,
  });
  const listRows = SqlSchema.findAll({
    Request: Schema.Struct({ threadId: ProjectionQueuedMessage.fields.threadId }),
    Result: ProjectionQueuedMessageDbRow,
    execute: ({ threadId }) =>
      sql`
        SELECT
          message_id AS "messageId",
          thread_id AS "threadId",
          text,
          attachments_json AS "attachments",
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          created_at AS "createdAt",
          sequence
        FROM projection_queued_messages
        WHERE thread_id = ${threadId}
        ORDER BY sequence ASC
      `,
  });
  const deleteMessageRow = SqlSchema.void({
    Request: Schema.Struct({
      threadId: ProjectionQueuedMessage.fields.threadId,
      messageId: ProjectionQueuedMessage.fields.messageId,
    }),
    execute: ({ threadId, messageId }) =>
      sql`
        DELETE FROM projection_queued_messages
        WHERE thread_id = ${threadId}
          AND message_id = ${messageId}
      `,
  });
  const deleteThreadRows = SqlSchema.void({
    Request: Schema.Struct({ threadId: ProjectionQueuedMessage.fields.threadId }),
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_queued_messages
        WHERE thread_id = ${threadId}
      `,
  });

  return ProjectionQueuedMessageRepository.of({
    upsert: (input) =>
      upsertRow(input).pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionQueuedMessageRepository.upsert:query")),
      ),
    listByThreadId: (input) =>
      listRows(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionQueuedMessageRepository.listByThreadId:query"),
        ),
      ),
    deleteByMessageId: (input) =>
      deleteMessageRow(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionQueuedMessageRepository.deleteByMessageId:query"),
        ),
      ),
    deleteByThreadId: (input) =>
      deleteThreadRows(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionQueuedMessageRepository.deleteByThreadId:query"),
        ),
      ),
  } satisfies ProjectionQueuedMessageRepositoryShape);
});

export const ProjectionQueuedMessageRepositoryLive = Layer.effect(
  ProjectionQueuedMessageRepository,
  makeProjectionQueuedMessageRepository,
);
