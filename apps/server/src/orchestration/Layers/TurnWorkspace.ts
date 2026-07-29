/**
 * TurnWorkspace — command-CWD tracking, repository/worktree resolution, and
 * thread workspace reconciliation for completed turns.
 *
 * CheckpointReactor owns checkpoint capture; this module owns only the workspace
 * context that feeds capture and keeps thread meta in sync with where the turn
 * actually ran.
 *
 * @module TurnWorkspace
 */
import {
  CommandId,
  type GitManagerServiceError,
  type ProjectId,
  type ProviderRuntimeEvent,
  type ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";

import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import { VcsDriverRegistry } from "../../vcs/VcsDriverRegistry.ts";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import * as WorkspaceEntries from "../../workspace/WorkspaceEntries.ts";
import type { OrchestrationDispatchError } from "../Errors.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";

/** Maximum command CWDs retained per turn key (ring buffer). */
export const MAX_COMMAND_CWDS = 32;

/**
 * Resolved workspace for a completed turn — the repository root the turn ran
 * in, plus branch/worktree metadata for thread reconciliation.
 */
export interface ResolvedTurnWorkspace {
  readonly cwd: string;
  readonly rootPath: string;
  readonly worktreePath: string | null;
  readonly branch: string | null;
}

export type TurnWorkspaceResolveError =
  | PlatformError.PlatformError
  | GitManagerServiceError
  | ProjectionRepositoryError;

export type TurnWorkspaceReconcileError =
  | PlatformError.PlatformError
  | GitManagerServiceError
  | ProjectionRepositoryError
  | OrchestrationDispatchError;

/**
 * Narrow API for turn workspace inference and reconciliation.
 */
export interface TurnWorkspace {
  /**
   * Record a command_execution item's CWD for the event's thread/turn.
   * No-ops for non-command items or missing cwd.
   */
  readonly recordCommandCwd: (event: ProviderRuntimeEvent) => Effect.Effect<void>;

  /**
   * Drop tracked command CWDs for a turn (and the thread-level unscoped key).
   * Call on turn abort and after turn-completion processing finishes.
   */
  readonly clearCommandCwds: (
    threadId: ThreadId,
    turnId: TurnId | undefined,
  ) => Effect.Effect<void>;

  /**
   * Prefer recent command CWD, then session runtime CWD, then persisted
   * workspace; keep the first candidate that belongs to the project repository.
   */
  readonly resolveForTurnCompletion: (
    event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>,
  ) => Effect.Effect<ResolvedTurnWorkspace | undefined, TurnWorkspaceResolveError>;

  /**
   * Update branch/worktree meta for the completing thread and peers that share
   * the resolved workspace root, then refresh workspace entries and VCS status.
   */
  readonly reconcileAfterTurnCompletion: (
    event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>,
    resolved: ResolvedTurnWorkspace,
  ) => Effect.Effect<void, TurnWorkspaceReconcileError>;
}

export interface TurnWorkspaceDeps {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly vcsDriverRegistry: Pick<VcsDriverRegistry["Service"], "detect">;
  readonly vcsStatusBroadcaster: Pick<
    VcsStatusBroadcaster["Service"],
    "refreshLocalStatus" | "refreshStatus"
  >;
  readonly workspaceEntries: Pick<WorkspaceEntries.WorkspaceEntries["Service"], "refresh">;
  readonly projectionSnapshotQuery: Pick<
    ProjectionSnapshotQuery["Service"],
    "getThreadDetailById" | "getProjectShellById" | "getShellSnapshot"
  >;
  readonly providerService: Pick<ProviderServiceShape, "listSessions">;
  readonly orchestrationEngine: Pick<OrchestrationEngineShape, "dispatch">;
  readonly nextCommandId: Effect.Effect<CommandId, PlatformError.PlatformError>;
}

/** Stable map key for per-turn command CWD history. */
export function commandCwdKey(threadId: ThreadId, turnId: TurnId | undefined): string {
  return `${threadId}\u0000${turnId ?? ""}`;
}

/**
 * Append a command CWD to history: skip consecutive duplicates, keep at most
 * {@link MAX_COMMAND_CWDS} entries (oldest dropped).
 */
export function appendCommandCwd(history: readonly string[], cwd: string): readonly string[] {
  if (history.at(-1) === cwd) {
    return history;
  }
  return [...history.slice(-(MAX_COMMAND_CWDS - 1)), cwd];
}

/**
 * Build preferred CWD candidates: most recent command CWDs first, then session
 * runtime, then persisted thread/project workspace.
 */
export function workspaceCandidateCwds(input: {
  readonly commandCwds: readonly string[];
  readonly sessionCwd: string | undefined;
  readonly persistedCwd: string | undefined;
}): readonly string[] {
  return [
    ...input.commandCwds.toReversed(),
    ...(input.sessionCwd ? [input.sessionCwd] : []),
    ...(input.persistedCwd ? [input.persistedCwd] : []),
  ];
}

/**
 * Decide which threads need meta updates after a turn resolves a workspace.
 * Pure planning step so reconcile can stay a thin Effect over dispatch/refresh.
 */
export function planWorkspaceMetaUpdates(input: {
  readonly completingThreadId: ThreadId;
  readonly projectId: ProjectId;
  readonly resolved: ResolvedTurnWorkspace;
  readonly threads: ReadonlyArray<{
    readonly id: ThreadId;
    readonly projectId: ProjectId;
    readonly branch: string | null;
    readonly worktreePath: string | null;
  }>;
  readonly canonicalRootForThread: (worktreePath: string | null) => string;
}): ReadonlyArray<{
  readonly threadId: ThreadId;
  readonly branch: string | null;
  readonly expectedBranch: string | null;
  readonly worktreePath: string | null | undefined;
}> {
  const updates: Array<{
    readonly threadId: ThreadId;
    readonly branch: string | null;
    readonly expectedBranch: string | null;
    readonly worktreePath: string | null | undefined;
  }> = [];

  for (const candidate of input.threads) {
    if (candidate.projectId !== input.projectId) continue;
    const isCompletingThread = candidate.id === input.completingThreadId;
    const candidateRoot = input.canonicalRootForThread(candidate.worktreePath);
    const sharesResolvedWorkspace = candidateRoot === input.resolved.rootPath;
    if (!isCompletingThread && !sharesResolvedWorkspace) continue;

    const nextWorktreePath = isCompletingThread
      ? input.resolved.worktreePath
      : candidate.worktreePath;
    if (candidate.branch === input.resolved.branch && candidate.worktreePath === nextWorktreePath) {
      continue;
    }

    updates.push({
      threadId: candidate.id,
      branch: input.resolved.branch,
      expectedBranch: candidate.branch,
      worktreePath: isCompletingThread ? input.resolved.worktreePath : undefined,
    });
  }

  return updates;
}

/**
 * Construct a {@link TurnWorkspace} from explicit dependencies (production and tests).
 */
export function createTurnWorkspace(deps: TurnWorkspaceDeps): TurnWorkspace {
  const commandCwdsByTurn = new Map<string, string[]>();

  const clearCommandCwds = (threadId: ThreadId, turnId: TurnId | undefined) =>
    Effect.sync(() => {
      commandCwdsByTurn.delete(commandCwdKey(threadId, turnId));
      commandCwdsByTurn.delete(commandCwdKey(threadId, undefined));
    });

  const recordCommandCwd = (event: ProviderRuntimeEvent) =>
    Effect.sync(() => {
      if (
        (event.type !== "item.started" &&
          event.type !== "item.updated" &&
          event.type !== "item.completed") ||
        event.payload.itemType !== "command_execution" ||
        !event.payload.cwd
      ) {
        return;
      }
      const key = commandCwdKey(event.threadId, event.turnId);
      const current = commandCwdsByTurn.get(key) ?? [];
      const next = appendCommandCwd(current, event.payload.cwd);
      if (next === current) {
        return;
      }
      commandCwdsByTurn.set(key, [...next]);
    });

  const canonicalPath = Effect.fn("TurnWorkspace.canonicalPath")(function* (value: string) {
    return yield* deps.fileSystem
      .realPath(value)
      .pipe(Effect.orElseSucceed(() => deps.path.resolve(value)));
  });

  const repositoryMetadataPath = Effect.fn("TurnWorkspace.repositoryMetadataPath")(
    function* (input: { readonly rootPath: string; readonly metadataPath: string | null }) {
      const value =
        input.metadataPath === null
          ? input.rootPath
          : deps.path.isAbsolute(input.metadataPath)
            ? input.metadataPath
            : deps.path.resolve(input.rootPath, input.metadataPath);
      return yield* canonicalPath(value);
    },
  );

  const resolveSessionCwd = Effect.fn("TurnWorkspace.resolveSessionCwd")(function* (
    threadId: ThreadId,
  ): Effect.fn.Return<string | undefined> {
    const sessions = yield* deps.providerService.listSessions();
    const session = sessions.find((entry) => entry.threadId === threadId);
    return session?.cwd;
  });

  const resolveForTurnCompletion = Effect.fn("TurnWorkspace.resolveForTurnCompletion")(function* (
    event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>,
  ) {
    const thread = yield* deps.projectionSnapshotQuery
      .getThreadDetailById(event.threadId)
      .pipe(Effect.map(Option.getOrUndefined));
    if (!thread) return undefined;

    const project = yield* deps.projectionSnapshotQuery
      .getProjectShellById(thread.projectId)
      .pipe(Effect.map(Option.getOrUndefined));
    if (!project) return undefined;
    const projects = [project];

    const projectRepository = yield* deps.vcsDriverRegistry
      .detect({ cwd: project.workspaceRoot })
      .pipe(Effect.orElseSucceed(() => null));
    if (!projectRepository) return undefined;
    const projectMetadataPath = yield* repositoryMetadataPath(projectRepository.repository);
    const sessionCwd = yield* resolveSessionCwd(event.threadId);
    const persistedCwd = resolveThreadWorkspaceCwd({ thread, projects });
    const commandCwds = [
      ...(commandCwdsByTurn.get(commandCwdKey(event.threadId, event.turnId)) ?? []),
      ...(commandCwdsByTurn.get(commandCwdKey(event.threadId, undefined)) ?? []),
    ];
    const candidates = workspaceCandidateCwds({
      commandCwds,
      sessionCwd,
      persistedCwd,
    });

    for (const candidate of candidates) {
      const detected = yield* deps.vcsDriverRegistry
        .detect({ cwd: candidate })
        .pipe(Effect.orElseSucceed(() => null));
      if (!detected || detected.kind !== projectRepository.kind) continue;
      const candidateMetadataPath = yield* repositoryMetadataPath(detected.repository);
      if (candidateMetadataPath !== projectMetadataPath) continue;

      const rootPath = yield* canonicalPath(detected.repository.rootPath);
      const projectRoot = yield* canonicalPath(project.workspaceRoot);
      const status = yield* deps.vcsStatusBroadcaster.refreshLocalStatus(rootPath);
      return {
        cwd: rootPath,
        rootPath,
        worktreePath: rootPath === projectRoot ? null : rootPath,
        branch: status.refName,
      } satisfies ResolvedTurnWorkspace;
    }
    return undefined;
  });

  const reconcileAfterTurnCompletion = Effect.fn("TurnWorkspace.reconcileAfterTurnCompletion")(
    function* (
      event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>,
      resolved: ResolvedTurnWorkspace,
    ) {
      const thread = yield* deps.projectionSnapshotQuery
        .getThreadDetailById(event.threadId)
        .pipe(Effect.map(Option.getOrUndefined));
      if (!thread) return;
      const shell = yield* deps.projectionSnapshotQuery.getShellSnapshot();
      const project = shell.projects.find((entry) => entry.id === thread.projectId);
      if (!project) return;

      const canonicalRoots = new Map<string, string>();
      for (const candidate of shell.threads) {
        if (candidate.projectId !== thread.projectId) continue;
        const rawRoot = candidate.worktreePath ?? project.workspaceRoot;
        if (!canonicalRoots.has(rawRoot)) {
          canonicalRoots.set(rawRoot, yield* canonicalPath(rawRoot));
        }
      }

      const updates = planWorkspaceMetaUpdates({
        completingThreadId: event.threadId,
        projectId: thread.projectId,
        resolved,
        threads: shell.threads,
        canonicalRootForThread: (worktreePath) => {
          const rawRoot = worktreePath ?? project.workspaceRoot;
          return canonicalRoots.get(rawRoot) ?? rawRoot;
        },
      });

      for (const update of updates) {
        yield* deps.orchestrationEngine.dispatch({
          type: "thread.meta.update",
          commandId: yield* deps.nextCommandId,
          threadId: update.threadId,
          branch: update.branch,
          expectedBranch: update.expectedBranch,
          ...(update.worktreePath !== undefined ? { worktreePath: update.worktreePath } : {}),
        });
      }

      yield* deps.workspaceEntries.refresh(resolved.rootPath);
      yield* deps.vcsStatusBroadcaster.refreshStatus(resolved.rootPath);
    },
  );

  return {
    recordCommandCwd,
    clearCommandCwds,
    resolveForTurnCompletion,
    reconcileAfterTurnCompletion,
  };
}

/**
 * Acquire platform/services and build a live {@link TurnWorkspace}.
 */
export const makeTurnWorkspace = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const vcsDriverRegistry = yield* VcsDriverRegistry;
  const vcsStatusBroadcaster = yield* VcsStatusBroadcaster;
  const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const providerService = yield* ProviderService;
  const orchestrationEngine = yield* OrchestrationEngineService;

  return createTurnWorkspace({
    fileSystem,
    path,
    vcsDriverRegistry,
    vcsStatusBroadcaster,
    workspaceEntries,
    projectionSnapshotQuery,
    providerService,
    orchestrationEngine,
    nextCommandId: crypto.randomUUIDv4.pipe(
      Effect.map((uuid) => CommandId.make(`server:workspace-context-reconciled:${uuid}`)),
    ),
  });
});
