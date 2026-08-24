# aqqua

aqqua is a fork of T3 code 

Works with your subscriptions on Claude Code, Codex, Cursor, Grok Build, and OpenCode. If they're set up on your computer, aqqua can control them.

## "Wait, what are you selling me?"

Nothing. We built aqqua because we wanted the best possible development experience with agents. We were inspired by existing solutions like the Codex desktop app, Conductor, Claude Desktop and Cursor Glass, but none met our bar.

We wanted something performant, remote-ready, and truly open. If we ever go the wrong direction, we want you to have everything you need to fork and build the editor that you want.

## Installation

> [!WARNING]
> aqqua currently supports Codex, Claude, Cursor, Grok Build and OpenCode. Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - Cursor: install [Cursor CLI](https://cursor.com/cli) and run `cursor-agent login`
> - Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`

### Desktop app

Install the latest desktop app from this repository's releases, or from your favorite package registry. On first launch, the packaged app installs its bundled `aqqua` command into the aqqua home directory and exposes it to the agents it runs.

No separate CLI or npm installation is required for desktop-managed agents. To invoke the bundled command from a separate terminal, add `~/.aqqua/bin` to your `PATH`.

With the desktop app running, start an agent from any directory inside an aqqua project or one of its existing worktrees:

```bash
aqqua agent models
aqqua agent spawn --instance codex --model gpt-5.6-sol --task "Fix the failing test"
```

`aqqua agent models` lists every advertised provider-instance/model row, including unavailable rows and the reason they cannot currently spawn. `spawn` names an available row exactly. Add `--reasoning high` to pick a reasoning level, or drop `--instance`/`--model` to use the project's default.

The new thread appears in the desktop app. From a project directory it uses the project root; from an existing aqqua worktree it uses that worktree and branch.

#### Windows (`winget`)

```bash
winget install Aqqua.Aqqua
```

#### macOS (Homebrew)

```bash
brew install --cask aqqua
```

#### Arch Linux (AUR)

```bash
yay -S aqqua-bin
```

## Some notes

We are very very early in this project. Expect bugs.

We are (mostly) not accepting contributions yet. Small fixes may be considered. Big features will not be.

There's no public docs site yet, checkout the miscellaneous markdown files in [docs](./docs).

## Documentation

- [Getting started](./docs/getting-started/quick-start.md)
- [Agent models](./docs/user/agent-models.md)
- [Flows](./docs/user/agentic-board.md)
- [Remote access](./docs/user/remote-access.md)
- [Keeping aqqua in sync](./docs/user/server-updates.md)
- [Architecture overview](./docs/architecture/overview.md)
- [Provider guides](./docs/providers/codex.md)
- [Operations](./docs/operations/ci.md)
- [Reference](./docs/reference/encyclopedia.md)

## If you REALLY want to contribute still.... read this first

### Install `vp`

aqqua uses Vite+ so you'll need to install the global `vp` command-line tool.

#### macOS / Linux

```bash
curl -fsSL https://vite.plus | bash
```

#### Windows

```bash
irm https://vite.plus/ps1 | iex
```

Checkout their getting started guide for more information: https://viteplus.dev/guide/

### Install dependencies

```bash
vp i
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
