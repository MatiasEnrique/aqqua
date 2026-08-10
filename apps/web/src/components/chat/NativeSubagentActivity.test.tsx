import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/models";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { buildNativeSubagentActivityItems, NativeSubagentActivity } from "./NativeSubagentActivity";

const child = (
  id: string,
  createdAt: string,
  overrides: Partial<EnvironmentThreadShell> = {},
): EnvironmentThreadShell =>
  ({
    environmentId: "env",
    id,
    projectId: "project",
    parentThreadId: "owner",
    providerSubagent: {
      ownerThreadId: "owner",
      provider: "codex",
      childId: id,
    },
    title: id,
    modelSelection: { instanceId: "codex", model: "gpt" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    deletedAt: null,
    session: null,
    ...overrides,
  }) as unknown as EnvironmentThreadShell;

describe("buildNativeSubagentActivityItems", () => {
  it("keeps native children in spawn order and carries provider identity", () => {
    const items = buildNativeSubagentActivityItems([
      child("later", "2026-01-02T00:00:00.000Z", {
        providerSubagent: { ownerThreadId: "owner", provider: "claude", childId: "later" },
      } as never),
      child("earlier", "2026-01-01T00:00:00.000Z"),
    ]);

    expect(items.map((item) => [item.thread.id, item.providerLabel])).toEqual([
      ["earlier", "Codex"],
      ["later", "Claude"],
    ]);
  });

  it("ignores ordinary threads instead of asserting a native binding", () => {
    const ordinary = child("owner", "2026-01-01T00:00:00.000Z", {
      parentThreadId: null,
      providerSubagent: null,
    });

    expect(buildNativeSubagentActivityItems([ordinary])).toEqual([]);
  });
});

describe("NativeSubagentActivity", () => {
  it("renders every child as subordinate roster entries rather than conversation tabs", () => {
    const markup = renderToStaticMarkup(
      <NativeSubagentActivity
        ownerTitle="Ship native activity"
        agents={[
          child("Explore tests", "2026-01-01T00:00:00.000Z"),
          child("Audit reactor", "2026-01-02T00:00:00.000Z"),
        ]}
        activeChildId={null}
        onSelectThread={() => {}}
      />,
    );

    expect(markup).toContain("data-native-subagent-activity");
    expect(markup).toContain("Native agent activity for Ship native activity");
    expect(markup).toContain("Explore tests");
    expect(markup).toContain("Audit reactor");
    expect(markup).not.toContain("aria-current");
    expect(markup).not.toContain("data-conversation-tabbar");
    expect(markup).not.toContain("data-sub-agent-count");
  });

  it("marks the inspected child as current", () => {
    const markup = renderToStaticMarkup(
      <NativeSubagentActivity
        ownerTitle="Ship native activity"
        agents={[child("Explore tests", "2026-01-01T00:00:00.000Z")]}
        activeChildId={"Explore tests" as never}
        onSelectThread={() => {}}
      />,
    );

    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("Explore tests");
    expect(markup).toContain("Codex");
  });
});
