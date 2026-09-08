# acp-hub

A provider-agnostic [Agent Client Protocol](https://agentclientprotocol.com/) hub. Any ACP UI
launches `acp-hub acp` as its agent. The hub runs real provider agents behind it, lets any agent
spawn headless sub-agents on any other provider, and gives agents a mailbox to coordinate.

It depends on nothing in the aqqua repository. Design notes live in
`docs/plans/acp-agent-hub.md`.

## Install

```bash
cargo install --path native/acp-hub
acp-hub init            # writes ~/.config/acp-hub/config.toml with claude and codex
acp-hub providers
```

`config.toml`:

```toml
default_provider = "claude"

[providers.claude]
command = "npx -y @agentclientprotocol/claude-agent-acp@latest"

[providers.codex]
command = "npx -y @agentclientprotocol/codex-acp@latest"

[providers.gemini]
command = "gemini --experimental-acp"
env = { GEMINI_API_KEY = "..." }

[children]
auto_approve = true            # headless children answer permission prompts by policy
max_children_per_session = 4
max_depth = 2
```

## Use from an ACP UI

Register `acp-hub acp` as an agent. In Zed, for example:

```json
{
  "agent_servers": {
    "Hub (Claude)": { "command": "acp-hub", "args": ["acp", "--provider", "claude"] },
    "Hub (Codex)": { "command": "acp-hub", "args": ["acp", "--provider", "codex"] }
  }
}
```

A client can also name the provider per session with `_meta: {"acp-hub": {"provider": "codex"}}`
on `session/new`.

## What agents can do

Every provider session receives an MCP server named `acp-hub` with these tools:

| Tool                    | Purpose                                                                |
| ----------------------- | ---------------------------------------------------------------------- |
| `list_providers`        | Providers available for delegation.                                    |
| `spawn_agent`           | Start a headless sub-agent on a provider with a task. Returns at once. |
| `await_agent`           | Wait for a sub-agent's turn and get its final message.                 |
| `send_agent`            | Follow-up prompt to an idle sub-agent.                                 |
| `list_agents`           | Parent, children, and siblings with status.                            |
| `send_message`, `inbox` | Mailbox between parent, children, and siblings.                        |
| `cancel_agent`          | Interrupt a sub-agent.                                                 |

Spawned sub-agents appear in the parent conversation as tool calls in every ACP UI, and as
sessions of their own through `session/list`. The `_meta["acp-hub"]` object on those tool calls
carries `childSessionId`, `provider`, and `parentSessionId` for clients that want to build a tree.

## Try it from a terminal

```bash
acp-hub prompt --provider codex "Summarize this repository"
acp-hub prompt --command "npx -y @agentclientprotocol/claude-agent-acp@latest" "hello"
```

## Test

```bash
cargo test
```

The end-to-end test uses `acp-hub test-agent`, a scripted provider with no model behind it, so
the suite needs no credentials or network.
