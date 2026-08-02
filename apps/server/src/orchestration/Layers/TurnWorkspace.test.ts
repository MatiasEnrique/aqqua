import {
  CommandId,
  EventId,
  ProjectId,
  ProviderDriverKind,
  ThreadId,
  TurnId,
  type ProviderRuntimeEvent,
} from "@aqqua/contracts";
import { describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  appendCommandCwd,
  commandCwdKey,
  createTurnWorkspace,
  MAX_COMMAND_CWDS,
  planWorkspaceMetaUpdates,
  workspaceCandidateCwds,
  type ResolvedTurnWorkspace,
  type TurnWorkspaceDeps,
} from "./TurnWorkspace.ts";

const threadId = ThreadId.make("thread-1");
const turnId = TurnId.make("turn-1");
const projectId = ProjectId.make("project-1");

function commandItemEvent(input: {
  readonly cwd?: string;
  readonly itemType?: string;
  readonly type?: "item.started" | "item.updated" | "item.completed";
  readonly turnId?: TurnId;
}): ProviderRuntimeEvent {
  return {
    type: input.type ?? "item.completed",
    eventId: EventId.make("evt-command"),
    provider: ProviderDriverKind.make("codex"),
    createdAt: "2026-01-01T00:00:00.000Z",
    threadId,
    turnId: input.turnId ?? turnId,
    itemId: "item-1",
    payload: {
      itemType: input.itemType ?? "command_execution",
      status: "completed",
      ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
    },
  } as ProviderRuntimeEvent;
}

function turnCompletedEvent(): Extract<ProviderRuntimeEvent, { type: "turn.completed" }> {
  return {
    type: "turn.completed",
    eventId: EventId.make("evt-turn-completed"),
    provider: ProviderDriverKind.make("codex"),
    createdAt: "2026-01-01T00:00:00.000Z",
    threadId,
    turnId,
    payload: { state: "completed" },
  };
}

function mockPath(): TurnWorkspaceDeps["path"] {
  return {
    resolve: (...parts: string[]) => parts.join("/"),
    isAbsolute: (value: string) => value.startsWith("/"),
  } as unknown as TurnWorkspaceDeps["path"];
}

function mockFileSystem(): TurnWorkspaceDeps["fileSystem"] {
  return {
    realPath: (value: string) => Effect.succeed(value),
  } as unknown as TurnWorkspaceDeps["fileSystem"];
}

describe("appendCommandCwd", () => {
  it("skips consecutive duplicate CWDs", () => {
    const first = appendCommandCwd([], "/repo");
    const second = appendCommandCwd(first, "/repo");
    expect(second).toBe(first);
    expect(second).toEqual(["/repo"]);
  });

  it("appends distinct CWDs and caps history at MAX_COMMAND_CWDS", () => {
    let history: readonly string[] = [];
    for (let i = 0; i < MAX_COMMAND_CWDS + 5; i += 1) {
      history = appendCommandCwd(history, `/cwd-${i}`);
    }
    expect(history).toHaveLength(MAX_COMMAND_CWDS);
    expect(history[0]).toBe("/cwd-5");
    expect(history.at(-1)).toBe(`/cwd-${MAX_COMMAND_CWDS + 4}`);
  });
});

describe("workspaceCandidateCwds", () => {
  it("prefers recent command CWDs, then session, then persisted", () => {
    expect(
      workspaceCandidateCwds({
        commandCwds: ["/cmd-old", "/cmd-new"],
        sessionCwd: "/session",
        persistedCwd: "/persisted",
      }),
    ).toEqual(["/cmd-new", "/cmd-old", "/session", "/persisted"]);
  });

  it("omits missing session and persisted CWDs", () => {
    expect(
      workspaceCandidateCwds({
        commandCwds: ["/cmd"],
        sessionCwd: undefined,
        persistedCwd: undefined,
      }),
    ).toEqual(["/cmd"]);
  });
});

describe("planWorkspaceMetaUpdates", () => {
  const resolved: ResolvedTurnWorkspace = {
    cwd: "/worktree",
    rootPath: "/worktree",
    worktreePath: "/worktree",
    branch: "feature/sync",
  };

  it("updates the completing thread worktree and peers that share the resolved root", () => {
    const updates = planWorkspaceMetaUpdates({
      completingThreadId: threadId,
      projectId,
      resolved,
      threads: [
        {
          id: threadId,
          projectId,
          branch: "main",
          worktreePath: null,
        },
        {
          id: ThreadId.make("thread-peer"),
          projectId,
          branch: "stale",
          worktreePath: "/worktree",
        },
        {
          id: ThreadId.make("thread-other-root"),
          projectId,
          branch: "other",
          worktreePath: "/other",
        },
        {
          id: ThreadId.make("thread-other-project"),
          projectId: ProjectId.make("project-2"),
          branch: "main",
          worktreePath: "/worktree",
        },
      ],
      canonicalRootForThread: (worktreePath) => worktreePath ?? "/project",
    });

    expect(updates).toEqual([
      {
        threadId,
        branch: "feature/sync",
        expectedBranch: "main",
        worktreePath: "/worktree",
      },
      {
        threadId: ThreadId.make("thread-peer"),
        branch: "feature/sync",
        expectedBranch: "stale",
        worktreePath: undefined,
      },
    ]);
  });

  it("skips threads whose branch and worktree already match", () => {
    const updates = planWorkspaceMetaUpdates({
      completingThreadId: threadId,
      projectId,
      resolved,
      threads: [
        {
          id: threadId,
          projectId,
          branch: "feature/sync",
          worktreePath: "/worktree",
        },
      ],
      canonicalRootForThread: (worktreePath) => worktreePath ?? "/project",
    });
    expect(updates).toEqual([]);
  });
});

describe("createTurnWorkspace", () => {
  it.effect("records command CWDs and prefers the latest same-repository command on resolve", () =>
    Effect.gen(function* () {
      const detect = vi.fn((input: { cwd: string }) => {
        if (input.cwd.startsWith("/foreign")) {
          return Effect.succeed({
            kind: "git" as const,
            repository: {
              kind: "git" as const,
              rootPath: "/foreign",
              metadataPath: "/foreign/.git",
              freshness: {
                source: "live-local" as const,
                observedAt: "2026-01-01T00:00:00.000Z" as never,
                expiresAt: Option.none(),
              },
            },
            driver: {} as never,
          });
        }
        const rootPath = input.cwd.startsWith("/worktree") ? "/worktree" : "/project";
        return Effect.succeed({
          kind: "git" as const,
          repository: {
            kind: "git" as const,
            rootPath,
            metadataPath: "/project/.git",
            freshness: {
              source: "live-local" as const,
              observedAt: "2026-01-01T00:00:00.000Z" as never,
              expiresAt: Option.none(),
            },
          },
          driver: {} as never,
        });
      });

      const refreshLocalStatus = vi.fn(() =>
        Effect.succeed({
          refName: "feature/workspace-sync",
        } as never),
      );
      const refreshStatus = vi.fn(() => Effect.void as Effect.Effect<never>);
      const workspaceRefresh = vi.fn(() => Effect.void);
      const dispatches: Array<unknown> = [];

      const deps: TurnWorkspaceDeps = {
        fileSystem: mockFileSystem(),
        path: mockPath(),
        vcsDriverRegistry: { detect },
        vcsStatusBroadcaster: {
          refreshLocalStatus,
          refreshStatus:
            refreshStatus as TurnWorkspaceDeps["vcsStatusBroadcaster"]["refreshStatus"],
        },
        workspaceEntries: { refresh: workspaceRefresh },
        projectionSnapshotQuery: {
          getThreadDetailById: () =>
            Effect.succeed(
              Option.some({
                id: threadId,
                projectId,
                worktreePath: null,
                branch: "main",
              } as never),
            ),
          getProjectShellById: () =>
            Effect.succeed(
              Option.some({
                id: projectId,
                workspaceRoot: "/project",
              } as never),
            ),
          getShellSnapshot: () =>
            Effect.succeed({
              projects: [{ id: projectId, workspaceRoot: "/project" }],
              threads: [
                {
                  id: threadId,
                  projectId,
                  branch: "main",
                  worktreePath: null,
                },
                {
                  id: ThreadId.make("thread-peer"),
                  projectId,
                  branch: "stale",
                  worktreePath: "/worktree",
                },
              ],
            } as never),
        },
        providerService: {
          listSessions: () =>
            Effect.succeed([
              {
                threadId,
                cwd: "/project",
              },
            ] as never),
        },
        orchestrationEngine: {
          dispatch: (command) => {
            dispatches.push(command);
            return Effect.succeed({ sequence: 1 });
          },
        },
        nextCommandId: Effect.succeed(CommandId.make("server:workspace-context-reconciled:test")),
      };

      const turnWorkspace = createTurnWorkspace(deps);

      yield* turnWorkspace.recordCommandCwd(
        commandItemEvent({ cwd: "/foreign/nested", type: "item.completed" }),
      );
      yield* turnWorkspace.recordCommandCwd(commandItemEvent({ cwd: "/worktree/nested" }));

      const resolved = yield* turnWorkspace.resolveForTurnCompletion(turnCompletedEvent());
      expect(resolved).toEqual({
        cwd: "/worktree",
        rootPath: "/worktree",
        worktreePath: "/worktree",
        branch: "feature/workspace-sync",
      });

      yield* turnWorkspace.reconcileAfterTurnCompletion(turnCompletedEvent(), resolved!);

      expect(dispatches).toEqual([
        {
          type: "thread.meta.update",
          commandId: CommandId.make("server:workspace-context-reconciled:test"),
          threadId,
          branch: "feature/workspace-sync",
          expectedBranch: "main",
          worktreePath: "/worktree",
        },
        {
          type: "thread.meta.update",
          commandId: CommandId.make("server:workspace-context-reconciled:test"),
          threadId: ThreadId.make("thread-peer"),
          branch: "feature/workspace-sync",
          expectedBranch: "stale",
        },
      ]);
      expect(workspaceRefresh).toHaveBeenCalledWith("/worktree");
      expect(refreshStatus).toHaveBeenCalledWith("/worktree");
    }),
  );

  it.effect("clears command CWDs so an aborted turn does not leak into the next resolve", () =>
    Effect.gen(function* () {
      const detect = vi.fn((input: { cwd: string }) =>
        Effect.succeed({
          kind: "git" as const,
          repository: {
            kind: "git" as const,
            rootPath: input.cwd.startsWith("/worktree") ? "/worktree" : "/project",
            metadataPath: "/project/.git",
            freshness: {
              source: "live-local" as const,
              observedAt: "2026-01-01T00:00:00.000Z" as never,
              expiresAt: Option.none(),
            },
          },
          driver: {} as never,
        }),
      );

      const turnWorkspace = createTurnWorkspace({
        fileSystem: mockFileSystem(),
        path: mockPath(),
        vcsDriverRegistry: { detect },
        vcsStatusBroadcaster: {
          refreshLocalStatus: () =>
            Effect.succeed({
              refName: "main",
            } as never),
          refreshStatus: () => Effect.succeed({} as never),
        },
        workspaceEntries: { refresh: () => Effect.void },
        projectionSnapshotQuery: {
          getThreadDetailById: () =>
            Effect.succeed(
              Option.some({
                id: threadId,
                projectId,
                worktreePath: null,
                branch: "main",
              } as never),
            ),
          getProjectShellById: () =>
            Effect.succeed(
              Option.some({
                id: projectId,
                workspaceRoot: "/project",
              } as never),
            ),
          getShellSnapshot: () => Effect.succeed({ projects: [], threads: [] } as never),
        },
        providerService: {
          listSessions: () =>
            Effect.succeed([
              {
                threadId,
                cwd: "/project",
              },
            ] as never),
        },
        orchestrationEngine: {
          dispatch: () => Effect.succeed({ sequence: 1 }),
        },
        nextCommandId: Effect.succeed(CommandId.make("cmd")),
      });

      yield* turnWorkspace.recordCommandCwd(commandItemEvent({ cwd: "/worktree/nested" }));
      yield* turnWorkspace.clearCommandCwds(threadId, turnId);

      const resolved = yield* turnWorkspace.resolveForTurnCompletion(turnCompletedEvent());
      expect(resolved).toEqual({
        cwd: "/project",
        rootPath: "/project",
        worktreePath: null,
        branch: "main",
      });
    }),
  );

  it.effect("ignores non-command items and items without a cwd", () =>
    Effect.gen(function* () {
      const turnWorkspace = createTurnWorkspace({
        fileSystem: mockFileSystem(),
        path: mockPath(),
        vcsDriverRegistry: {
          detect: () =>
            Effect.succeed({
              kind: "git",
              repository: {
                kind: "git",
                rootPath: "/project",
                metadataPath: "/project/.git",
                freshness: {
                  source: "live-local",
                  observedAt: "2026-01-01T00:00:00.000Z" as never,
                  expiresAt: Option.none(),
                },
              },
              driver: {} as never,
            }),
        },
        vcsStatusBroadcaster: {
          refreshLocalStatus: () => Effect.succeed({ refName: "main" } as never),
          refreshStatus: () => Effect.succeed({} as never),
        },
        workspaceEntries: { refresh: () => Effect.void },
        projectionSnapshotQuery: {
          getThreadDetailById: () =>
            Effect.succeed(
              Option.some({
                id: threadId,
                projectId,
                worktreePath: null,
                branch: "main",
              } as never),
            ),
          getProjectShellById: () =>
            Effect.succeed(
              Option.some({
                id: projectId,
                workspaceRoot: "/project",
              } as never),
            ),
          getShellSnapshot: () => Effect.succeed({ projects: [], threads: [] } as never),
        },
        providerService: {
          listSessions: () => Effect.succeed([{ threadId, cwd: "/project" }] as never),
        },
        orchestrationEngine: {
          dispatch: () => Effect.succeed({ sequence: 1 }),
        },
        nextCommandId: Effect.succeed(CommandId.make("cmd")),
      });

      yield* turnWorkspace.recordCommandCwd(
        commandItemEvent({ itemType: "agent_message", cwd: "/x" }),
      );
      yield* turnWorkspace.recordCommandCwd(commandItemEvent({}));

      // Key format stays stable for map lookups used by the tracker.
      expect(commandCwdKey(threadId, turnId)).toBe(`${threadId}\u0000${turnId}`);
      expect(commandCwdKey(threadId, undefined)).toBe(`${threadId}\u0000`);
    }),
  );
});
