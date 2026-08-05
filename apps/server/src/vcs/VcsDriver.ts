import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type {
  VcsDriverCapabilities,
  VcsError,
  VcsInitInput,
  VcsListRemotesResult,
  VcsListWorkspaceFilesResult,
  ReviewDiffPreviewInput,
  ReviewDiffPreviewResult,
  VcsRepositoryIdentity,
} from "@aqqua/contracts";
import { CheckpointRef } from "@aqqua/contracts";
import * as VcsProcess from "./VcsProcess.ts";

export interface VcsCaptureCheckpointInput {
  readonly cwd: string;
  readonly checkpointRef: CheckpointRef;
}

export interface VcsRestoreCheckpointInput {
  readonly cwd: string;
  readonly checkpointRef: CheckpointRef;
  readonly fallbackToHead?: boolean;
}

export interface VcsDiffCheckpointsInput {
  readonly cwd: string;
  readonly fromCheckpointRef: CheckpointRef;
  readonly toCheckpointRef: CheckpointRef;
  readonly fallbackFromToHead?: boolean;
  readonly ignoreWhitespace: boolean;
}

export interface VcsDeleteCheckpointRefsInput {
  readonly cwd: string;
  readonly checkpointRefs: ReadonlyArray<CheckpointRef>;
}

export interface VcsDiscardChangesInput {
  readonly cwd: string;
  /**
   * Repository-relative selections. Tracked selections restore from HEAD.
   * An untracked file is removed only when its exact path is listed; selecting
   * a directory does not remove untracked descendants. Ignored files follow the
   * same exact-selection rule.
   */
  readonly paths: ReadonlyArray<string>;
}

export type VcsConflictKind =
  | "both-modified"
  | "both-added"
  | "both-deleted"
  | "added-by-us"
  | "added-by-them"
  | "deleted-by-us"
  | "deleted-by-them";

export type VcsConflictOperation = "merge" | "rebase";

export interface VcsConflict {
  readonly path: string;
  readonly kind: VcsConflictKind;
}

export interface VcsConflictList {
  readonly operation: VcsConflictOperation | null;
  readonly conflicts: ReadonlyArray<VcsConflict>;
}

export interface VcsResolveConflictInput {
  readonly cwd: string;
  readonly path: string;
  /**
   * `ours` and `theirs` select Git's index stages. During a rebase, Git calls
   * the rebased-onto commit "ours" and the commit being replayed "theirs".
   */
  readonly resolution: "ours" | "theirs" | "content";
}

export interface VcsRebaseFromBaseInput {
  readonly cwd: string;
  readonly baseRef: string;
}

export type VcsRebaseFromBaseResult =
  | { readonly status: "rebased" }
  | ({ readonly status: "conflicts" } & VcsConflictList);

export interface VcsAbortConflictOperationInput {
  readonly cwd: string;
  readonly operation: VcsConflictOperation;
}

export interface VcsCheckpointOps {
  readonly captureCheckpoint: (input: VcsCaptureCheckpointInput) => Effect.Effect<void, VcsError>;
  readonly hasCheckpointRef: (
    input: Omit<VcsRestoreCheckpointInput, "fallbackToHead">,
  ) => Effect.Effect<boolean, VcsError>;
  readonly restoreCheckpoint: (
    input: VcsRestoreCheckpointInput,
  ) => Effect.Effect<boolean, VcsError>;
  readonly diffCheckpoints: (input: VcsDiffCheckpointsInput) => Effect.Effect<string, VcsError>;
  readonly deleteCheckpointRefs: (
    input: VcsDeleteCheckpointRefsInput,
  ) => Effect.Effect<void, VcsError>;
}

export class VcsDriver extends Context.Service<
  VcsDriver,
  {
    readonly capabilities: VcsDriverCapabilities;
    readonly execute: (
      input: Omit<VcsProcess.VcsProcessInput, "command">,
    ) => Effect.Effect<VcsProcess.VcsProcessOutput, VcsError>;
    readonly checkpoints?: VcsCheckpointOps;
    readonly detectRepository: (
      cwd: string,
    ) => Effect.Effect<VcsRepositoryIdentity | null, VcsError>;
    readonly isInsideWorkTree: (cwd: string) => Effect.Effect<boolean, VcsError>;
    readonly listWorkspaceFiles: (
      cwd: string,
    ) => Effect.Effect<VcsListWorkspaceFilesResult, VcsError>;
    readonly listRemotes: (cwd: string) => Effect.Effect<VcsListRemotesResult, VcsError>;
    readonly filterIgnoredPaths: (
      cwd: string,
      relativePaths: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<string>, VcsError>;
    readonly initRepository: (input: VcsInitInput) => Effect.Effect<void, VcsError>;
    readonly discardChanges?: (input: VcsDiscardChangesInput) => Effect.Effect<void, VcsError>;
    readonly listConflicts?: (cwd: string) => Effect.Effect<VcsConflictList, VcsError>;
    readonly resolveConflict?: (input: VcsResolveConflictInput) => Effect.Effect<void, VcsError>;
    readonly rebaseFromBase?: (
      input: VcsRebaseFromBaseInput,
    ) => Effect.Effect<VcsRebaseFromBaseResult, VcsError>;
    readonly abortConflictOperation?: (
      input: VcsAbortConflictOperationInput,
    ) => Effect.Effect<void, VcsError>;
    readonly getDiffPreview?: (
      input: ReviewDiffPreviewInput,
    ) => Effect.Effect<ReviewDiffPreviewResult, VcsError>;
  }
>()("aqqua/vcs/VcsDriver") {}
