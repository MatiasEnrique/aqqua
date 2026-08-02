// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import { BoardArtifactError, CardId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";

import { writeFileStringAtomically } from "./atomicWrite.ts";
import { ServerConfig } from "./config.ts";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery.ts";

/**
 * Sanitize a board step name for use as a single path segment.
 *
 * Rejects path traversal and empty results after stripping unsafe characters.
 */
export function sanitizeBoardStepName(stepName: string): string | null {
  const trimmed = stepName.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.includes("\0") || trimmed.includes("/") || trimmed.includes("\\")) {
    return null;
  }
  if (trimmed.includes("..") || trimmed.startsWith(".")) {
    return null;
  }
  // Keep filenames portable: allow alphanumerics, dash, underscore, space, and
  // a few punctuation marks common in step labels; collapse the rest.
  const sanitized = trimmed.replace(/[^a-zA-Z0-9._\-\s]/g, "_").replace(/\s+/g, "-");
  if (
    sanitized.length === 0 ||
    sanitized === "." ||
    sanitized === ".." ||
    sanitized.startsWith(".")
  ) {
    return null;
  }
  if (sanitized.includes("..") || sanitized.includes("/") || sanitized.includes("\\")) {
    return null;
  }
  return sanitized;
}

export function boardArtifactsRoot(stateDir: string): string {
  return NodePath.join(stateDir, "board-artifacts");
}

export function resolveBoardArtifactPath(input: {
  readonly stateDir: string;
  readonly cardId: string;
  readonly stepName: string;
}): { readonly path: string; readonly sanitizedStepName: string } | null {
  const sanitizedStepName = sanitizeBoardStepName(input.stepName);
  if (sanitizedStepName === null) {
    return null;
  }
  // Card ids are branded entity ids (no path separators). Still resolve under
  // the artifacts root and reject any escape.
  if (
    input.cardId.includes("/") ||
    input.cardId.includes("\\") ||
    input.cardId.includes("..") ||
    input.cardId.includes("\0") ||
    input.cardId.startsWith(".")
  ) {
    return null;
  }

  const root = NodePath.resolve(boardArtifactsRoot(input.stateDir));
  const filePath = NodePath.resolve(root, input.cardId, `${sanitizedStepName}.md`);
  if (!filePath.startsWith(`${root}${NodePath.sep}`)) {
    return null;
  }
  return { path: filePath, sanitizedStepName };
}

export const readBoardArtifact = Effect.fn("readBoardArtifact")(function* (input: {
  readonly cardId: CardId;
  readonly stepName: string;
}) {
  const config = yield* ServerConfig;
  const snapshots = yield* ProjectionSnapshotQuery;
  const fs = yield* FileSystem.FileSystem;

  const card = yield* snapshots.getCardById(input.cardId).pipe(
    Effect.mapError(
      (cause) =>
        new BoardArtifactError({
          message: `Failed to look up card '${input.cardId}' for artifact read.`,
          cardId: input.cardId,
          stepName: input.stepName,
          cause,
        }),
    ),
  );
  if (Option.isNone(card)) {
    return yield* new BoardArtifactError({
      message: `Card '${input.cardId}' was not found.`,
      cardId: input.cardId,
      stepName: input.stepName,
    });
  }

  const resolved = resolveBoardArtifactPath({
    stateDir: config.stateDir,
    cardId: input.cardId,
    stepName: input.stepName,
  });
  if (resolved === null) {
    return yield* new BoardArtifactError({
      message: `Invalid flow artifact step name '${input.stepName}'.`,
      cardId: input.cardId,
      stepName: input.stepName,
    });
  }

  const exists = yield* fs.exists(resolved.path).pipe(
    Effect.mapError(
      (cause) =>
        new BoardArtifactError({
          message: `Failed to stat flow artifact for card '${input.cardId}'.`,
          cardId: input.cardId,
          stepName: input.stepName,
          cause,
        }),
    ),
  );
  if (!exists) {
    return {
      exists: false as const,
      content: null,
      path: resolved.path,
    };
  }

  const content = yield* fs.readFileString(resolved.path).pipe(
    Effect.mapError(
      (cause) =>
        new BoardArtifactError({
          message: `Failed to read flow artifact for card '${input.cardId}'.`,
          cardId: input.cardId,
          stepName: input.stepName,
          cause,
        }),
    ),
  );

  return {
    exists: true as const,
    content,
    path: resolved.path,
  };
});

export const writeBoardArtifact = Effect.fn("writeBoardArtifact")(function* (input: {
  readonly cardId: CardId;
  readonly stepName: string;
  readonly content: string;
}) {
  const config = yield* ServerConfig;
  const snapshots = yield* ProjectionSnapshotQuery;
  const fs = yield* FileSystem.FileSystem;

  const card = yield* snapshots.getCardById(input.cardId).pipe(
    Effect.mapError(
      (cause) =>
        new BoardArtifactError({
          message: `Failed to look up card '${input.cardId}' for artifact write.`,
          cardId: input.cardId,
          stepName: input.stepName,
          cause,
        }),
    ),
  );
  if (Option.isNone(card)) {
    return yield* new BoardArtifactError({
      message: `Card '${input.cardId}' was not found.`,
      cardId: input.cardId,
      stepName: input.stepName,
    });
  }

  const resolved = resolveBoardArtifactPath({
    stateDir: config.stateDir,
    cardId: input.cardId,
    stepName: input.stepName,
  });
  if (resolved === null) {
    return yield* new BoardArtifactError({
      message: `Invalid flow artifact step name '${input.stepName}'.`,
      cardId: input.cardId,
      stepName: input.stepName,
    });
  }

  yield* fs.makeDirectory(NodePath.dirname(resolved.path), { recursive: true }).pipe(
    Effect.mapError(
      (cause) =>
        new BoardArtifactError({
          message: `Failed to create flow artifact directory for card '${input.cardId}'.`,
          cardId: input.cardId,
          stepName: input.stepName,
          cause,
        }),
    ),
  );

  yield* writeFileStringAtomically({
    filePath: resolved.path,
    contents: input.content,
  }).pipe(
    Effect.mapError(
      (cause) =>
        new BoardArtifactError({
          message: `Failed to write flow artifact for card '${input.cardId}'.`,
          cardId: input.cardId,
          stepName: input.stepName,
          cause,
        }),
    ),
  );

  return {
    path: resolved.path,
  };
});
