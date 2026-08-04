# pi

pi is an open-source, bring-your-own-key coding agent by Mario Zechner and earendil-works. It uses
one agent loop across Anthropic, OpenAI, Google, xAI, GitHub Copilot, DeepSeek, OpenRouter, local
llama.cpp models, and many other providers. pi is licensed under the MIT License.

## Install pi

Install pi globally:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

Once pi is installed, update it from the command line:

```bash
pi update --self
```

aqqua can also update pi from Settings.

## Authenticate

Start pi, then run `/login`:

```bash
pi
```

```text
/login
```

You can also provide API keys through the environment, such as `ANTHROPIC_API_KEY` or
`OPENAI_API_KEY`. The required variable depends on the model provider you use.

## Configure pi in aqqua

Add or edit the pi provider in aqqua Settings.

Available settings:

- **Binary path** overrides the path to the `pi` executable.
- **PI_CODING_AGENT_DIR path** sets pi's home and configuration directory through
  `PI_CODING_AGENT_DIR`.
- **Trust project files** passes pi's `--approve` flag, allowing `.pi` project extensions, skills,
  and prompts to load. This is off by default. Without it, RPC sessions ignore project files.

aqqua shows pi models as `<provider>/<model>` slugs. You can switch the model and thinking level
while a session is running.

## Known Gaps

### No Approvals

pi has no permission prompts by design. Approval-required and auto-accept-edits modes use a
read-only tool allowlist (`read`, `grep`, `find`, and `ls`) instead of gating individual actions.
Full-access and auto modes grant all tools.

### No MCP

aqqua's `preview_*` and `board_complete` tools are unavailable in pi threads. As a result, Flows
cards cannot complete themselves from a pi thread.

`aqqua agent` sub-agent delegation does work because it uses the environment and CLI rather than
MCP.

### No Plan Mode

The interaction-mode toggle is hidden for pi.
