# ACP agent hub

Design and implementation plan for `acp-hub`, a standalone, provider-agnostic Agent Client
Protocol (ACP) hub that lets any ACP UI orchestrate cross-provider agents, and for how aqqua
integrates with it.

Status: **milestone 1 in progress.** The crate lives at `native/acp-hub` and depends on nothing in
this repository. It is placed here so it can move with the ACP schema work; splitting it into its
own repository is a directory move.

## 1. Outcome

A user installs one binary, `acp-hub`, and points any ACP client at `acp-hub acp`. From then on:

- every session the UI opens runs on a provider of the user's choice: Claude, Codex, Gemini, Cursor,
  or any agent with an ACP adapter, configured by command line in `config.toml`;
- any agent can spawn headless sub-agents on any other provider, wait for them, send follow-ups,
  and exchange messages with parent, children, and siblings;
- spawned sub-agents show up live inside the parent session in every ACP UI, as standard tool calls,
  and are listed as sessions of their own through `session/list`;
- aqqua consumes the hub as a provider and renders its children as nested threads, using the same
  provider-native subagent model it already has for Codex and Claude.

Nothing here depends on aqqua's server, desktop app, or web UI.

## 2. Why a hub and not a shim over aqqua

ACP is symmetric enough to build the whole thing out of the protocol. The hub is an ACP **agent**
toward the UI and an ACP **client** toward every provider process. Agent-to-agent coordination rides
on MCP, which ACP already passes to agents at `session/new`. That keeps the hub free of provider
and UI specifics and free of aqqua.

The earlier plan, a stdio shim in front of the aqqua daemon, was dropped because it made the
"aqqua-agnostic" goal impossible and because aqqua's own value (native adapters, worktrees, board)
is better delivered as a hub _provider_ than as the hub itself. See §7.

## 3. Architecture

```
ACP UI (Zed, Devin Desktop, aqqua, ...)
        ⇅ stdio, ACP v1
   acp-hub acp                        one process per UI connection
        ├─ Agent side: initialize, session/new, session/prompt, session/cancel,
        │              session/list, session/set_mode
        ├─ unix socket: hub tools (MCP over newline JSON-RPC)
        └─ Client side: one provider process per hub session
               ⇅ stdio, ACP v1                     ⇅ stdio, MCP
        claude-agent-acp / codex-acp / ...   ←→  acp-hub mcp (shim)
```

Key choices:

- **Hub session ids are minted by the hub** before the provider session exists, so the id can be
  written into the MCP server declaration handed to the provider in `session/new`. That is how the
  shim knows which session it belongs to, and it means the caller identity for every tool call comes
  from the process the hub launched, never from the model.
- **One provider process per hub session.** Simple lifecycle, and dropping the connection kills the
  process group. Sharing a process per provider is a later optimization.
- **MCP over a stdio shim plus unix socket** rather than the SDK's MCP-over-ACP extension, because
  stdio MCP is the one transport every ACP agent must support.
- **Children are answered by policy**, not by a human. Permission requests from a headless child are
  auto-approved when `children.auto_approve` is set. Root session permission requests are forwarded
  to the UI unchanged.
- **Messaging is pull-based.** A message lands in the recipient's inbox; nothing is injected into
  a prompt and no turn is started on its behalf. That avoids prompt contamination, busy-turn races,
  and reply loops.

## 4. Protocol surface

Agent side, toward the UI:

| Method                                        | Behaviour                                                                                                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initialize`                                  | Advertises `session_capabilities.list`. No `load_session` yet.                                                                                                                        |
| `session/new`                                 | Picks the provider from `_meta["acp-hub"].provider`, `_meta.provider`, the `--provider` flag, or the config default. Spawns the provider, forwards `cwd`, injects the hub MCP server. |
| `session/prompt`                              | Forwarded. All `session/update` notifications are relayed with the hub session id.                                                                                                    |
| `session/cancel`                              | Forwarded.                                                                                                                                                                            |
| `session/list`                                | Every session, root and child, flat. `_meta["acp-hub"]` carries provider, parent, depth.                                                                                              |
| `session/set_mode`                            | Forwarded.                                                                                                                                                                            |
| `session/request_permission` (agent → client) | Forwarded for roots, answered by policy for children.                                                                                                                                 |

Client side, toward providers: `initialize`, `session/new` with the shim as an MCP server,
`session/prompt`, `session/cancel`, `session/set_mode`. Client capabilities are the defaults, so
providers use their own file and terminal access.

Hub tools (MCP), available to every provider session:

| Tool                     | Purpose                                                                          |
| ------------------------ | -------------------------------------------------------------------------------- |
| `list_providers`         | Names and descriptions of configured providers.                                  |
| `spawn_agent`            | Start a headless child on a provider with a task. Returns immediately.           |
| `await_agent`            | Wait for a child's turn, return its final message. Returns `running` on timeout. |
| `send_agent`             | Follow-up prompt to an idle child.                                               |
| `list_agents`            | Parent, children, siblings with status.                                          |
| `send_message` / `inbox` | Mailbox between parent, children, and siblings.                                  |
| `cancel_agent`           | Interrupt a child.                                                               |

Child projection into the parent session:

- On spawn: `tool_call` with id = child session id, title `provider: title`, status `in_progress`,
  `rawInput` `{sessionId, provider, task}`, and `_meta["acp-hub"]` `{childSessionId, provider,
parentSessionId}`.
- On turn end: `tool_call_update` with status `completed` or `failed`, the child's assistant text as
  content, and `rawOutput` `{sessionId, provider, status, stopReason}`.

The `_meta["acp-hub"]` object is the hub's only extension. Generic clients ignore it; aqqua reads it.

## 5. What the protocol cannot do

ACP v1 has no notification that a new session exists. A UI sees a child as a separate conversation
only when it calls `session/list` again. Inside the parent conversation the child is visible
immediately through the tool call. This is a protocol limit, not a hub limit, and it applies equally
to every ACP client.

## 6. Milestones

1. **Core hub** (this milestone): config, `acp-hub acp`, provider spawning, prompt and cancel
   forwarding, session list, permission forwarding, MCP tools, shim, child projection, mailbox,
   `acp-hub prompt` dev client, `acp-hub test-agent` scripted provider for end-to-end tests.
2. **Durability and load**: persist sessions and mailbox to disk, `session/load` with transcript
   replay, reconnect to still-running provider processes after the UI restarts.
3. **Daemon mode**: `acp-hub serve` owning sessions across UI connections, thin `acp-hub acp`
   attaching over the socket, launchd LaunchAgent on macOS and systemd unit on Linux, `acp-hub
install --ui zed|...` writing UI configs.
4. **Provider polish**: process sharing per provider, model and mode passthrough, client capability
   forwarding for file and terminal access on root sessions, streaming child text into the parent
   tool call with throttling.
5. **Verification against real clients**: Zed, Devin Desktop, aqqua, with Claude and Codex adapters.

## 7. aqqua integration

- **Hub as an aqqua provider.** Implement the generic ACP driver that the "ACP Registry" option in
  `AddProviderInstanceDialog.tsx` already promises but the server does not have, reusing
  `apps/server/src/provider/acp/`. Read `_meta["acp-hub"]` on `tool_call` in `AcpRuntimeModel.ts` and
  emit a `providerSubagent` target, so `ProviderRuntimeIngestion` materializes the child as a nested
  thread exactly as it does for Codex and Claude native children. Opening the child uses
  `session/load` once milestone 2 lands.
- **aqqua as a hub provider.** An `aqqua acp` subcommand that exposes aqqua threads as ACP sessions,
  so hub users on other UIs get aqqua's native adapters and worktrees. Second priority.
- **Setup.** aqqua's onboarding calls `acp-hub install` and shows status. The hub owns UI registration.

## 8. Risks

1. Third-party ACP adapters drift; the hub must tolerate missing capabilities and unstable fields.
2. The same-user process boundary means any local process can reach the tool socket. The socket
   lives in the temp directory with user-only permissions; a per-run token in the handshake is a
   cheap hardening step for milestone 2.
3. Blocking tool calls hit client-side MCP timeouts in some providers; `await_agent` returns
   `running` on a bounded timeout so callers poll rather than block.
4. Provider credential access under launchd on macOS is unverified for everything except Claude.
