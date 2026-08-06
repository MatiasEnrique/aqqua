import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ConversationTabs } from "./ConversationTabs";
import type { ConversationTab } from "./openConversationTabs";

const threadRef = (threadId: string) => ({ environmentId: "local", threadId }) as never;

const tab = (overrides: Partial<Extract<ConversationTab, { _tag: "thread" }>> = {}) =>
  ({
    _tag: "thread",
    key: `local:${overrides.title ?? "tab"}`,
    threadRef: threadRef("thread-1"),
    title: "Fix palette warmth",
    state: "working",
    isActive: false,
    ...overrides,
  }) as ConversationTab;

const render = (tabs: readonly ConversationTab[]) =>
  renderToStaticMarkup(
    <ConversationTabs
      tabs={tabs}
      onSelectThread={() => {}}
      onSelectDraft={() => {}}
      onCloseTab={() => {}}
      onNewThread={() => {}}
      newThreadLabel="New conversation in colors"
    />,
  );

describe("ConversationTabs", () => {
  it("renders each tab as its own bordered white shell", () => {
    const markup = render([
      tab(),
      tab({ key: "b", title: "Ship flows beta", state: "needsInput" }),
    ]);

    expect(markup).toContain("bg-card");
    expect(markup).toContain("rounded-xl border");
    // The design's final state removed both enclosing rules.
    expect(markup).not.toContain("border-b border-border");
  });

  it("distinguishes the routed tab by weight and border", () => {
    const markup = render([tab({ isActive: true }), tab({ key: "b", title: "Ship flows beta" })]);

    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("font-semibold text-foreground");
    expect(markup).toContain('data-active-tab="true"');
    expect(markup).toContain('data-active-tab="false"');
  });

  it("gives every tab a close control that only closes it", () => {
    const markup = render([tab()]);

    expect(markup).toContain('aria-label="Close Fix palette warmth"');
    // Nothing in the strip offers to settle, snooze or delete.
    expect(markup).not.toContain("Settle");
    expect(markup).not.toContain("Delete");
  });

  it("carries each conversation's state as its dot", () => {
    expect(render([tab({ state: "failed" })])).toContain("text-red-600");
    expect(render([tab({ state: "working" })])).toContain("text-sky-600");
    expect(render([tab({ state: "done" })])).toContain("text-emerald-600");
  });

  it("names the plus control with the worktree it creates in", () => {
    expect(render([])).toContain('aria-label="New conversation in colors"');
  });

  it("keeps the strip out of the desktop drag region", () => {
    expect(render([tab()])).toContain("app-region:no-drag");
  });

  it("does not group tabs by worktree", () => {
    const markup = render([tab(), tab({ key: "b", title: "Landing hero copy" })]);
    const shells = markup.match(/data-active-tab=/g) ?? [];

    expect(shells).toHaveLength(2);
    expect(markup).not.toContain("worktree");
  });
});
