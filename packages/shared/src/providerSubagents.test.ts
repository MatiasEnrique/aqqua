import {
  CommandId,
  ProviderDriverKind,
  ThreadId,
  type ProviderSubagentBinding,
} from "@aqqua/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  expandClaimedThreadIdsWithProviderSubagents,
  isProviderSubagentBinding,
  isProviderSubagentRejectedCommandType,
  isProviderSubagentRejectedMetaUpdate,
  providerSubagentBinding,
  providerSubagentChildThreadId,
  providerSubagentCoalesceIdentity,
  providerSubagentCreateCommandId,
} from "./providerSubagents.ts";

describe("providerSubagents shared helpers", () => {
  const ownerA = ThreadId.make("thread-owner-a");
  const ownerB = ThreadId.make("thread-owner-b");
  const provider = ProviderDriverKind.make("codex");

  it("derives stable child thread ids scoped by owner and provider", () => {
    const first = providerSubagentChildThreadId({
      ownerThreadId: ownerA,
      provider,
      childId: "native-1",
    });
    const again = providerSubagentChildThreadId({
      ownerThreadId: ownerA,
      provider,
      childId: "native-1",
    });
    expect(first).toBe(again);
    expect(String(first).startsWith("psa_")).toBe(true);

    const otherOwner = providerSubagentChildThreadId({
      ownerThreadId: ownerB,
      provider,
      childId: "native-1",
    });
    expect(otherOwner).not.toBe(first);

    const otherProvider = providerSubagentChildThreadId({
      ownerThreadId: ownerA,
      provider: ProviderDriverKind.make("claudeAgent"),
      childId: "native-1",
    });
    expect(otherProvider).not.toBe(first);

    const otherChild = providerSubagentChildThreadId({
      ownerThreadId: ownerA,
      provider,
      childId: "native-2",
    });
    expect(otherChild).not.toBe(first);
  });

  it("derives stable create command ids", () => {
    const first = providerSubagentCreateCommandId({
      ownerThreadId: ownerA,
      provider,
      childId: "native-1",
    });
    const again = providerSubagentCreateCommandId({
      ownerThreadId: ownerA,
      provider,
      childId: "native-1",
    });
    expect(first).toBe(again);
    expect(CommandId.make(String(first))).toBe(first);
    expect(String(first).startsWith("psa_create_")).toBe(true);
  });

  it("coalesce identity is empty for root events and the native id otherwise", () => {
    expect(providerSubagentCoalesceIdentity(undefined)).toBe("");
    expect(providerSubagentCoalesceIdentity({ childId: "child-a" })).toBe("child-a");
  });

  it("builds bindings while preserving the contract's explicit null parent", () => {
    expect(
      providerSubagentBinding({ ownerThreadId: ownerA, provider, childId: "native-1" }),
    ).toEqual({ ownerThreadId: ownerA, provider, childId: "native-1" });
    expect(
      providerSubagentBinding({
        ownerThreadId: ownerA,
        provider,
        childId: "native-1",
        parentChildId: null,
      }),
    ).toEqual({ ownerThreadId: ownerA, provider, childId: "native-1", parentChildId: null });
  });

  it("recognizes present provider-subagent bindings", () => {
    const binding = providerSubagentBinding({
      ownerThreadId: ownerA,
      provider,
      childId: "native-1",
    });

    expect(isProviderSubagentBinding(binding)).toBe(true);
    expect(isProviderSubagentBinding(null)).toBe(false);
    expect(isProviderSubagentBinding(undefined)).toBe(false);
  });

  it("rejects direct control command types but not presentation or approval", () => {
    expect(isProviderSubagentRejectedCommandType("thread.turn.start")).toBe(true);
    expect(isProviderSubagentRejectedCommandType("thread.session.stop")).toBe(true);
    expect(isProviderSubagentRejectedCommandType("thread.checkpoint.revert")).toBe(true);
    expect(isProviderSubagentRejectedCommandType("thread.archive")).toBe(false);
    expect(isProviderSubagentRejectedCommandType("thread.delete")).toBe(false);
    expect(isProviderSubagentRejectedCommandType("thread.approval.respond")).toBe(false);
    expect(isProviderSubagentRejectedCommandType("thread.user-input.respond")).toBe(false);
    expect(isProviderSubagentRejectedCommandType("thread.meta.update")).toBe(false);
  });

  it("rejects meta updates that change model/branch/worktree", () => {
    expect(
      isProviderSubagentRejectedMetaUpdate({
        type: "thread.meta.update",
        modelSelection: { instanceId: "codex", model: "x" },
      }),
    ).toBe(true);
    expect(
      isProviderSubagentRejectedMetaUpdate({
        type: "thread.meta.update",
        title: "rename only",
      }),
    ).toBe(false);
  });

  it("expands claimed owner bindings onto native children", () => {
    const binding: ProviderSubagentBinding = {
      ownerThreadId: ownerA,
      provider,
      childId: "native-1",
    };
    const claimed = expandClaimedThreadIdsWithProviderSubagents(new Set([String(ownerA)]), [
      { id: String(ownerA) },
      {
        id: String(
          providerSubagentChildThreadId({
            ownerThreadId: ownerA,
            provider,
            childId: "native-1",
          }),
        ),
        providerSubagent: binding,
      },
      { id: String(ownerB) },
    ]);
    expect(claimed.has(String(ownerA))).toBe(true);
    expect(
      claimed.has(
        String(
          providerSubagentChildThreadId({
            ownerThreadId: ownerA,
            provider,
            childId: "native-1",
          }),
        ),
      ),
    ).toBe(true);
    expect(claimed.has(String(ownerB))).toBe(false);
  });
});
