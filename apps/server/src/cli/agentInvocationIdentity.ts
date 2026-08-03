import { HostProcessPlatform } from "@aqqua/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

export const AGENT_TOKEN_ENV = "AQQUA_AGENT_TOKEN";
export const AGENT_API_ENV = "AQQUA_AGENT_API";
export const AGENT_THREAD_ENV = "AQQUA_THREAD_ID";

const AGENT_IDENTITY_MARKERS = [AGENT_TOKEN_ENV, AGENT_API_ENV, AGENT_THREAD_ENV].map(
  (name) => `${name}=`,
);
const MAX_ANCESTORS = 64;

export type AgentInvocationAncestry = "agent-session" | "ordinary-terminal" | "unknown";

export interface AgentInvocationAncestor {
  readonly pid: number;
  readonly parentPid: number;
  /** Kept opaque: identity values are inspected in-memory and never logged. */
  readonly environment: string;
}

const hasAgentIdentityMarker = (environment: string): boolean =>
  AGENT_IDENTITY_MARKERS.some((marker) => environment.includes(marker));

/**
 * Classify a chain that begins at the CLI's direct parent.
 *
 * A clear result is only possible when the chain reaches the host process root.
 * Truncation or an unreadable process stays unknown and must not be treated as
 * proof that the invocation came from an ordinary terminal.
 */
export function classifyAgentInvocationAncestors(
  ancestors: ReadonlyArray<AgentInvocationAncestor>,
): AgentInvocationAncestry {
  for (const ancestor of ancestors) {
    if (hasAgentIdentityMarker(ancestor.environment)) {
      return "agent-session";
    }
  }
  const last = ancestors.at(-1);
  return last !== undefined && last.parentPid <= 1 ? "ordinary-terminal" : "unknown";
}

const readLinuxAncestor = Effect.fn("agentCli.readLinuxAncestor")(function* (pid: number) {
  const fileSystem = yield* FileSystem.FileSystem;
  const status = yield* fileSystem.readFileString(`/proc/${pid}/status`);
  const parentPid = Number(/^PPid:\s+(\d+)$/m.exec(status)?.[1]);
  if (!Number.isSafeInteger(parentPid)) {
    return yield* Effect.fail("process parent is unavailable");
  }
  return {
    pid,
    parentPid,
    environment: yield* fileSystem.readFileString(`/proc/${pid}/environ`),
  };
});

const readDarwinAncestor = Effect.fn("agentCli.readDarwinAncestor")(function* (pid: number) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const output = yield* spawner
    .string(
      ChildProcess.make("/bin/ps", ["eww", "-p", String(pid), "-o", "ppid=", "-o", "command="]),
    )
    .pipe(Effect.map((value) => value.trim()));
  const match = /^(\d+)\s+([\s\S]*)$/.exec(output);
  const parentPid = Number(match?.[1]);
  if (!Number.isSafeInteger(parentPid) || match === null) {
    return yield* Effect.fail("process parent is unavailable");
  }
  return { pid, parentPid, environment: match[2] ?? "" };
});

/**
 * Inspect process ancestry instead of trusting the current environment. An
 * agent may delete its child's AQQUA_AGENT_* variables, but it cannot mutate
 * the already-running provider ancestor that aqqua launched.
 *
 * This is deliberately a provenance guard, not a same-user security sandbox.
 * Unsupported or unreadable ancestry remains `unknown`; standalone mode then
 * relies on the separate interactive, default-deny user-presence check.
 */
export const detectAgentInvocationAncestry = Effect.fn("agentCli.detectAgentInvocationAncestry")(
  function* () {
    const platform = yield* HostProcessPlatform;
    const readAncestor =
      platform === "linux"
        ? readLinuxAncestor
        : platform === "darwin"
          ? readDarwinAncestor
          : undefined;
    if (readAncestor === undefined) return "unknown";

    const ancestors: Array<AgentInvocationAncestor> = [];
    let pid = process.ppid;
    return yield* Effect.gen(function* () {
      for (let depth = 0; depth < MAX_ANCESTORS && pid > 1; depth += 1) {
        const ancestor = yield* readAncestor(pid);
        ancestors.push(ancestor);
        if (hasAgentIdentityMarker(ancestor.environment)) return "agent-session";
        pid = ancestor.parentPid;
      }
      return classifyAgentInvocationAncestors(ancestors);
    }).pipe(Effect.orElseSucceed(() => "unknown" as const));
  },
);
