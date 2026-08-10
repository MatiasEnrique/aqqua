import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/shell";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@aqqua/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { PendingNewTask } from "../../state/use-pending-new-tasks";
import {
  buildThreadListV2Items,
  buildThreadListV2ListItems,
  isProviderSubagentThread,
  providerSubagentOwnerTitle,
  resolveProviderSubagentOwnerTitles,
  resolveProviderSubagentPresentation,
  resolveThreadListV2Enabled,
  resolveThreadListV2Status,
  sortThreadsForListV2,
} from "./threadListV2";

const environmentId = EnvironmentId.make("environment-1");

function makeThread(
  input: Partial<EnvironmentThreadShell> & Pick<EnvironmentThreadShell, "id" | "title">,
): EnvironmentThreadShell {
  return {
    environmentId,
    projectId: ProjectId.make("project-1"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...input,
  };
}

const NOW = "2026-06-02T00:00:00.000Z";

describe("resolveThreadListV2Enabled", () => {
  it("defaults on when the device has never chosen", () => {
    expect(resolveThreadListV2Enabled({ preference: undefined, preferencesLoaded: true })).toBe(
      true,
    );
  });

  it("honors an explicit device opt-out", () => {
    expect(resolveThreadListV2Enabled({ preference: false, preferencesLoaded: true })).toBe(false);
    expect(resolveThreadListV2Enabled({ preference: true, preferencesLoaded: true })).toBe(true);
  });

  it("holds the default while preferences are still loading so the list does not remount", () => {
    expect(resolveThreadListV2Enabled({ preference: undefined, preferencesLoaded: false })).toBe(
      true,
    );
  });
});

describe("resolveProviderSubagentPresentation", () => {
  const ownerThreadId = ThreadId.make("owner-thread");
  const owner = makeThread({ id: ownerThreadId, title: "Ship the migration" });
  const nativeChild = makeThread({
    id: ThreadId.make("native-child"),
    title: "Subagent c1",
    parentThreadId: ownerThreadId,
    providerSubagent: {
      ownerThreadId,
      provider: ProviderDriverKind.make("codex"),
      childId: "c1",
    },
  });

  it("returns nothing for an ordinary thread", () => {
    expect(
      resolveProviderSubagentPresentation({
        thread: makeThread({ id: ThreadId.make("t"), title: "t" }),
      }),
    ).toBeNull();
  });

  it("returns nothing for an aqqua-managed sub-agent, which owns its session", () => {
    expect(
      resolveProviderSubagentPresentation({
        thread: makeThread({
          id: ThreadId.make("managed"),
          title: "managed",
          parentThreadId: ownerThreadId,
        }),
      }),
    ).toBeNull();
  });

  it("names the harness and the owner conversation it runs inside", () => {
    expect(
      resolveProviderSubagentPresentation({
        thread: nativeChild,
        ownerTitle: "Ship the migration",
      }),
    ).toEqual({
      provider: "codex",
      label: "Codex subagent",
      ownerTitle: "Ship the migration",
      subtitle: "Codex subagent · Ship the migration",
    });
  });

  it("falls back to the bare provider identity when the owner is not on hand", () => {
    expect(resolveProviderSubagentPresentation({ thread: nativeChild })).toMatchObject({
      ownerTitle: null,
      subtitle: "Codex subagent",
    });
  });

  it("names a Claude child and humanizes an unknown driver", () => {
    expect(
      resolveProviderSubagentPresentation({
        thread: makeThread({
          id: ThreadId.make("claude-child"),
          title: "c",
          providerSubagent: {
            ownerThreadId,
            provider: ProviderDriverKind.make("claude"),
            childId: "c1",
          },
        }),
      })?.label,
    ).toBe("Claude subagent");

    expect(
      resolveProviderSubagentPresentation({
        thread: makeThread({
          id: ThreadId.make("other-child"),
          title: "c",
          providerSubagent: {
            ownerThreadId,
            provider: ProviderDriverKind.make("some-driver"),
            childId: "c1",
          },
        }),
      })?.label,
    ).toBe("Some Driver subagent");
  });

  it("gates composer submission on the binding, not on having a parent", () => {
    // `submitDraft` and `onSubmitQueuedMessages` return early on this; an
    // aqqua-managed sub-agent stays fully sendable.
    expect(isProviderSubagentThread(nativeChild)).toBe(true);
    expect(isProviderSubagentThread(owner)).toBe(false);
    expect(
      isProviderSubagentThread(
        makeThread({
          id: ThreadId.make("managed"),
          title: "managed",
          parentThreadId: ownerThreadId,
        }),
      ),
    ).toBe(false);
    expect(isProviderSubagentThread(null)).toBe(false);
  });

  it("keeps native children in the flat list alongside ordinary threads", () => {
    const layout = buildThreadListV2Items({
      threads: [owner, nativeChild],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });

    expect(layout.items.map((item) => item.thread.id)).toEqual([
      ThreadId.make("native-child"),
      ownerThreadId,
    ]);
  });
});

describe("resolveProviderSubagentOwnerTitles", () => {
  const ownerThreadId = ThreadId.make("owner-thread");
  const owner = makeThread({ id: ownerThreadId, title: "Ship the migration" });
  const nativeChild = makeThread({
    id: ThreadId.make("native-child"),
    title: "Subagent c1",
    parentThreadId: ownerThreadId,
    providerSubagent: {
      ownerThreadId,
      provider: ProviderDriverKind.make("codex"),
      childId: "c1",
    },
  });

  it("allocates nothing when the list holds no native child", () => {
    const titles = resolveProviderSubagentOwnerTitles([
      owner,
      makeThread({
        id: ThreadId.make("managed"),
        title: "m",
        parentThreadId: ownerThreadId,
      }),
    ]);

    expect(titles.size).toBe(0);
  });

  it("resolves the owner title once for the whole list", () => {
    const titles = resolveProviderSubagentOwnerTitles([owner, nativeChild]);

    expect(providerSubagentOwnerTitle({ thread: nativeChild, ownerTitleByKey: titles })).toBe(
      "Ship the migration",
    );
    expect(providerSubagentOwnerTitle({ thread: owner, ownerTitleByKey: titles })).toBeNull();
    // Only the owners actually referenced are kept, not every thread's title.
    expect(titles.size).toBe(1);
  });

  it("never borrows a same-id owner from another environment", () => {
    const otherEnvironmentOwner = makeThread({
      id: ownerThreadId,
      title: "Unrelated conversation",
    });
    const scoped = {
      ...otherEnvironmentOwner,
      environmentId: EnvironmentId.make("environment-2"),
    };

    const titles = resolveProviderSubagentOwnerTitles([scoped, nativeChild]);

    expect(providerSubagentOwnerTitle({ thread: nativeChild, ownerTitleByKey: titles })).toBeNull();
  });
});

describe("buildThreadListV2Items — provider-native owner context", () => {
  const ownerThreadId = ThreadId.make("owner-thread");
  const owner = makeThread({ id: ownerThreadId, title: "Ship the migration" });
  const nativeChild = makeThread({
    id: ThreadId.make("native-child"),
    title: "Subagent c1",
    parentThreadId: ownerThreadId,
    providerSubagent: {
      ownerThreadId,
      provider: ProviderDriverKind.make("codex"),
      childId: "c1",
    },
  });

  it("hands every row its owner context so no row has to look one up", () => {
    const layout = buildThreadListV2Items({
      threads: [owner, nativeChild],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });

    expect(layout.items.map((item) => [item.thread.id, item.providerSubagentOwnerTitle])).toEqual([
      [ThreadId.make("native-child"), "Ship the migration"],
      [ownerThreadId, null],
    ]);
  });

  it("still names the owner when the search filtered the owner's own row away", () => {
    const layout = buildThreadListV2Items({
      threads: [owner, nativeChild],
      environmentId: null,
      searchQuery: "subagent",
      now: NOW,
    });

    expect(layout.items.map((item) => item.thread.id)).toEqual([ThreadId.make("native-child")]);
    expect(layout.items[0]?.providerSubagentOwnerTitle).toBe("Ship the migration");
  });

  it("leaves ordinary rows untouched", () => {
    const layout = buildThreadListV2Items({
      threads: [owner, makeThread({ id: ThreadId.make("plain"), title: "Plain" })],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });

    expect(layout.items.every((item) => item.providerSubagentOwnerTitle === null)).toBe(true);
  });
});

describe("resolveThreadListV2Status", () => {
  it("prioritizes approval over a running session", () => {
    const thread = makeThread({
      id: ThreadId.make("t"),
      title: "t",
      hasPendingApprovals: true,
      session: {
        threadId: ThreadId.make("t"),
        status: "running",
        providerName: "Codex",
        providerInstanceId: ProviderInstanceId.make("codex"),
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError: null,
        updatedAt: NOW,
      },
    });
    expect(resolveThreadListV2Status(thread)).toBe("approval");
  });

  it("resolves ready for quiescent threads", () => {
    expect(resolveThreadListV2Status(makeThread({ id: ThreadId.make("t"), title: "t" }))).toBe(
      "ready",
    );
  });
});

describe("sortThreadsForListV2", () => {
  it("orders by creation time, newest first, ignoring activity", () => {
    const sorted = sortThreadsForListV2([
      { id: "oldest", createdAt: "2026-06-01T08:00:00.000Z" },
      { id: "newest", createdAt: "2026-06-01T12:00:00.000Z" },
      { id: "middle", createdAt: "2026-06-01T10:00:00.000Z" },
    ]);
    expect(sorted.map((thread) => thread.id)).toEqual(["newest", "middle", "oldest"]);
  });
});

describe("buildThreadListV2Items", () => {
  it("hides snoozed threads and counts them — visibility parity with web", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("active"), title: "Active" }),
        makeThread({
          id: ThreadId.make("snoozed"),
          title: "Snoozed",
          snoozedUntil: "2026-06-03T09:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("woken"),
          title: "Woken",
          // Wake time already passed: back in the active list.
          snoozedUntil: "2026-06-01T18:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });

    // Same createdAt → static sort tiebreaks by id; the point is the woken
    // thread is BACK in the card block and the snoozed one is gone.
    expect(layout.items.map((item) => item.thread.id)).toEqual(["active", "woken"]);
    expect(layout.snoozedCount).toBe(1);
  });

  it("classifies snooze with the second-precise clock and reports the next wake", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({
          id: ThreadId.make("just-woke"),
          title: "Just woke",
          // Woke 30s ago: hidden under the minute-floored clock, visible
          // under the precise one.
          snoozedUntil: "2026-06-02T00:00:30.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("still-snoozed"),
          title: "Still snoozed",
          snoozedUntil: "2026-06-02T09:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
      // Minute-floored partition clock vs precise snooze clock.
      now: "2026-06-02T00:01:00.000Z",
      snoozeNow: "2026-06-02T00:01:07.500Z",
    });

    expect(layout.items.map((item) => item.thread.id)).toEqual(["just-woke"]);
    expect(layout.snoozedCount).toBe(1);
    expect(layout.nextSnoozeWakeAt).toBe("2026-06-02T09:00:00.000Z");
  });

  it("keeps snoozed threads visible on environments without the snooze capability", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({
          id: ThreadId.make("snoozed"),
          title: "Snoozed",
          snoozedUntil: "2026-06-03T09:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
      snoozeEnvironmentIds: new Set(),
      now: NOW,
    });

    expect(layout.items.map((item) => item.thread.id)).toEqual(["snoozed"]);
    expect(layout.snoozedCount).toBe(0);
  });

  it("partitions settled threads into a slim tail with one divider", () => {
    const { items } = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("active"), title: "Active" }),
        makeThread({
          id: ThreadId.make("settled"),
          title: "Settled",
          settledOverride: "settled",
          settledAt: NOW,
        }),
        makeThread({
          id: ThreadId.make("settled-2"),
          title: "Settled 2",
          settledOverride: "settled",
          settledAt: NOW,
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });

    expect(items.map((item) => [item.thread.id, item.variant])).toEqual([
      ["active", "card"],
      ["settled", "slim"],
      ["settled-2", "slim"],
    ]);
    expect(items.map((item) => item.showSettledDivider)).toEqual([false, true, false]);
    expect(items.map((item) => item.isLast)).toEqual([false, false, true]);
  });

  it("keeps cards in creation order while settled sorts by recency", () => {
    const { items } = buildThreadListV2Items({
      threads: [
        makeThread({
          id: ThreadId.make("older-created"),
          title: "Older",
          createdAt: "2026-06-01T08:00:00.000Z",
          updatedAt: NOW, // recent activity must NOT promote it
        }),
        makeThread({
          id: ThreadId.make("newer-created"),
          title: "Newer",
          createdAt: "2026-06-01T12:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });

    expect(items.map((item) => item.thread.id)).toEqual(["newer-created", "older-created"]);
  });

  it("keeps settled threads in the tail and filters by search query", () => {
    const { items } = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("match"), title: "Fix login bug" }),
        makeThread({ id: ThreadId.make("miss"), title: "Greeting" }),
        makeThread({
          id: ThreadId.make("settled"),
          title: "Fix login again",
          settledOverride: "settled",
          settledAt: NOW,
        }),
      ],
      environmentId: null,
      searchQuery: "login",
      now: NOW,
    });

    expect(items.map((item) => [item.thread.id, item.variant])).toEqual([
      ["match", "card"],
      ["settled", "slim"],
    ]);
  });

  it("scopes the flat list to one project", () => {
    const otherProjectId = ProjectId.make("project-2");
    const { items } = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("included"), title: "Included" }),
        makeThread({
          id: ThreadId.make("excluded"),
          projectId: otherProjectId,
          title: "Excluded",
        }),
      ],
      environmentId: null,
      projectRefs: [{ environmentId, projectId: ProjectId.make("project-1") }],
      searchQuery: "",
      now: NOW,
    });

    expect(items.map((item) => item.thread.id)).toEqual(["included"]);
  });

  it("scopes the flat list to every environment member of a logical project", () => {
    const remoteEnvironmentId = EnvironmentId.make("environment-remote");
    const { items } = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("local"), title: "Local" }),
        makeThread({
          environmentId: remoteEnvironmentId,
          id: ThreadId.make("remote"),
          title: "Remote",
        }),
      ],
      environmentId: null,
      projectRefs: [
        { environmentId, projectId: ProjectId.make("project-1") },
        { environmentId: remoteEnvironmentId, projectId: ProjectId.make("project-1") },
      ],
      searchQuery: "",
      now: NOW,
    });

    expect(items.map((item) => item.thread.id)).toEqual(["local", "remote"]);
  });
});

describe("buildThreadListV2Items settled paging", () => {
  it("caps the settled tail at settledLimit and reports the hidden count", () => {
    const threads = [
      makeThread({ id: ThreadId.make("active"), title: "Active" }),
      ...Array.from({ length: 4 }, (_, index) =>
        makeThread({
          id: ThreadId.make(`settled-${index}`),
          title: `Settled ${index}`,
          settledOverride: "settled",
          settledAt: NOW,
          latestUserMessageAt: `2026-06-01T0${index}:00:00.000Z`,
          // A turn adopted the message (same requestedAt): without it the
          // thread reads as a queued turn start, which never settles.
          latestTurn: {
            turnId: TurnId.make(`turn-${index}`),
            state: "completed",
            requestedAt: `2026-06-01T0${index}:00:00.000Z`,
            startedAt: `2026-06-01T0${index}:00:00.000Z`,
            completedAt: `2026-06-01T0${index}:10:00.000Z`,
            assistantMessageId: null,
          },
        }),
      ),
    ];

    const layout = buildThreadListV2Items({
      threads,
      environmentId: null,
      searchQuery: "",
      settledLimit: 2,
      now: NOW,
    });

    expect(layout.hiddenSettledCount).toBe(2);
    expect(layout.items.filter((item) => item.variant === "slim")).toHaveLength(2);
    // Most recent settled first — the hidden ones are the oldest.
    expect(layout.items.map((item) => item.thread.id)).toEqual([
      "active",
      "settled-3",
      "settled-2",
    ]);
  });
});

function makePendingTask(id: string): PendingNewTask {
  return {
    message: {
      environmentId,
      threadId: ThreadId.make(`thread-${id}`),
      messageId: MessageId.make(id),
      commandId: CommandId.make(`command-${id}`),
      text: id,
      attachments: [],
      createdAt: NOW,
      creation: {
        projectId: ProjectId.make("project-1"),
        workspaceMode: "worktree",
        branch: null,
        worktreePath: null,
      },
    },
    creation: {
      projectId: ProjectId.make("project-1"),
      workspaceMode: "worktree",
      branch: null,
      worktreePath: null,
    },
    title: id,
  };
}

describe("buildThreadListV2ListItems", () => {
  const layout = buildThreadListV2Items({
    threads: [
      makeThread({ id: ThreadId.make("active"), title: "active" }),
      makeThread({
        id: ThreadId.make("settled"),
        title: "settled",
        settledOverride: "settled",
        settledAt: NOW,
      }),
    ],
    environmentId: null,
    searchQuery: "",
    now: NOW,
  });

  it("splices queued tasks between the active block and the settled tail", () => {
    const items = buildThreadListV2ListItems({
      items: layout.items,
      pendingTasks: [makePendingTask("queued-1"), makePendingTask("queued-2")],
    });

    expect(
      items.map((item) =>
        item.type === "v2-pending" ? item.pendingTask.title : item.item.thread.id,
      ),
    ).toEqual(["active", "queued-1", "queued-2", "settled"]);
    // Only the leading queued row labels the section, exactly like Settled.
    expect(
      items.filter((item) => item.type === "v2-pending" && item.showPendingDivider),
    ).toHaveLength(1);
  });

  it("ends the list with queued tasks when nothing has settled yet", () => {
    const activeOnly = buildThreadListV2Items({
      threads: [makeThread({ id: ThreadId.make("active"), title: "active" })],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });
    const items = buildThreadListV2ListItems({
      items: activeOnly.items,
      pendingTasks: [makePendingTask("queued-1")],
    });

    expect(items.map((item) => item.type)).toEqual(["v2-thread", "v2-pending"]);
  });

  it("leaves the thread order untouched when nothing is queued", () => {
    const items = buildThreadListV2ListItems({ items: layout.items, pendingTasks: [] });

    expect(items.map((item) => item.key)).toEqual([
      `v2-thread:${environmentId}:active`,
      `v2-thread:${environmentId}:settled`,
    ]);
  });
});
