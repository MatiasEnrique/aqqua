/**
 * Deterministic ids and predicates for provider-native subagent threads.
 *
 * Contracts own the schemas; this module owns the runtime helpers that
 * ingestion, coalescing, and server invariants share.
 *
 * @module providerSubagents
 */
import type {
  CommandId,
  ProviderDriverKind,
  ProviderSubagentBinding,
  ProviderSubagentTarget,
  ThreadId,
} from "@aqqua/contracts";
import { CommandId as CommandIdSchema, ThreadId as ThreadIdSchema } from "@aqqua/contracts";
import { sha256 } from "@noble/hashes/sha2";
import * as Encoding from "effect/Encoding";

const utf8 = new TextEncoder();

function digestHex(parts: ReadonlyArray<string>): string {
  return Encoding.encodeHex(sha256(utf8.encode(parts.join("\0"))));
}

/**
 * Deterministic aqqua `ThreadId` for a native provider child, scoped by owner
 * thread + provider driver + native child id.
 */
export function providerSubagentChildThreadId(input: {
  readonly ownerThreadId: ThreadId | string;
  readonly provider: ProviderDriverKind | string;
  readonly childId: string;
}): ThreadId {
  const digest = digestHex([
    "aqqua.provider-subagent.thread",
    String(input.ownerThreadId),
    String(input.provider),
    input.childId,
  ]).slice(0, 32);
  return ThreadIdSchema.make(`psa_${digest}`);
}

/**
 * Deterministic create `CommandId` for materialising a native child so command
 * receipts make replay idempotent and a deleted child is never recreated by a
 * later event that reuses the same native id (existence + soft-delete checks
 * still apply).
 */
export function providerSubagentCreateCommandId(input: {
  readonly ownerThreadId: ThreadId | string;
  readonly provider: ProviderDriverKind | string;
  readonly childId: string;
}): CommandId {
  const digest = digestHex([
    "aqqua.provider-subagent.create",
    String(input.ownerThreadId),
    String(input.provider),
    input.childId,
  ]).slice(0, 32);
  return CommandIdSchema.make(`psa_create_${digest}`);
}

export function providerSubagentBinding(input: {
  readonly ownerThreadId: ThreadId;
  readonly provider: ProviderDriverKind;
  readonly childId: string;
  readonly parentChildId?: string | null | undefined;
}): ProviderSubagentBinding {
  return {
    ownerThreadId: input.ownerThreadId,
    provider: input.provider,
    childId: input.childId,
    ...(input.parentChildId !== undefined ? { parentChildId: input.parentChildId } : {}),
  };
}

/** Coalescing / flush identity for a runtime event's optional native child. */
export function providerSubagentCoalesceIdentity(
  target: ProviderSubagentTarget | null | undefined,
): string {
  return target?.childId ?? "";
}

export function isProviderSubagentBinding(
  value: ProviderSubagentBinding | null | undefined,
): value is ProviderSubagentBinding {
  return value != null;
}

/**
 * Direct control commands that must not target a provider-native child thread.
 * Presentation actions (rename/archive/snooze/settle/delete) and provider-
 * originated approval / user-input responses remain allowed.
 */
const PROVIDER_SUBAGENT_REJECTED_COMMAND_TYPES = new Set<string>([
  "thread.turn.start",
  "thread.turn.interrupt",
  "thread.message.enqueue",
  "thread.message.submit",
  "thread.message.dequeue",
  "thread.session.stop",
  "thread.runtime-mode.set",
  "thread.interaction-mode.set",
  "thread.checkpoint.revert",
]);

export function isProviderSubagentRejectedCommandType(commandType: string): boolean {
  return PROVIDER_SUBAGENT_REJECTED_COMMAND_TYPES.has(commandType);
}

/**
 * `thread.meta.update` may rename a native child, but model/branch/worktree
 * changes are session/source-control concerns owned by the owner thread.
 */
export function isProviderSubagentRejectedMetaUpdate(command: {
  readonly type: string;
  readonly title?: unknown;
  readonly modelSelection?: unknown;
  readonly branch?: unknown;
  readonly worktreePath?: unknown;
}): boolean {
  if (command.type !== "thread.meta.update") {
    return false;
  }
  return (
    command.modelSelection !== undefined ||
    command.branch !== undefined ||
    command.worktreePath !== undefined
  );
}

/**
 * Expand provider-directory claims so a native child is treated as claimed
 * while its owner binding is claimed.
 */
export function expandClaimedThreadIdsWithProviderSubagents(
  claimedThreadIds: ReadonlySet<string>,
  threads: ReadonlyArray<{
    readonly id: string;
    readonly providerSubagent?: ProviderSubagentBinding | null | undefined;
  }>,
): ReadonlySet<string> {
  const claimed = new Set(claimedThreadIds);
  for (const thread of threads) {
    const ownerThreadId = thread.providerSubagent?.ownerThreadId;
    if (ownerThreadId !== undefined && claimed.has(ownerThreadId)) {
      claimed.add(thread.id);
    }
  }
  return claimed;
}
