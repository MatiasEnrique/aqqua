import { assert, it } from "@effect/vitest";

import { classifyAgentInvocationAncestors } from "./agentInvocationIdentity.ts";

it("recognizes an agent ancestor after the direct child deletes every identity variable", () => {
  assert.equal(
    classifyAgentInvocationAncestors([
      { pid: 30, parentPid: 20, environment: "PATH=/usr/bin\u0000" },
      {
        pid: 20,
        parentPid: 1,
        environment:
          "PATH=/usr/bin\u0000AQQUA_AGENT_TOKEN=secret\u0000AQQUA_AGENT_API=http://127.0.0.1\u0000AQQUA_THREAD_ID=thread-1\u0000",
      },
    ]),
    "agent-session",
  );
});

it("recognizes an ordinary terminal only after inspecting the complete ancestor chain", () => {
  assert.equal(
    classifyAgentInvocationAncestors([
      { pid: 30, parentPid: 20, environment: "PATH=/usr/bin\u0000" },
      { pid: 20, parentPid: 1, environment: "SHELL=/bin/zsh\u0000" },
    ]),
    "ordinary-terminal",
  );
  assert.equal(
    classifyAgentInvocationAncestors([
      { pid: 30, parentPid: 20, environment: "PATH=/usr/bin\u0000" },
    ]),
    "unknown",
  );
});
