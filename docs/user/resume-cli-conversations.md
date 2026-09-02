# Resume a CLI conversation

Use `/resume` in a new thread draft to continue work that you started in the Claude Code or Codex terminal UI.

1. Select the same Claude or Codex provider instance that owns the CLI conversation.
2. Type `/resume` in the composer and choose a conversation.
3. Write the next message and send it.

aqqua creates a new thread that adopts the provider session. The timeline shows one collapsed **Earlier conversation** block. Expand it when you want to read the earlier messages; aqqua fetches that transcript only on demand.

Only CLI conversations from the current project are shown. A conversation is eligible when its recorded working directory is the project root or one of that project's aqqua-managed worktrees. Claude and Codex conversations created by other desktop apps, IDE integrations, or aqqua itself are excluded.

Resuming is only available before the thread is created. After the first turn, aqqua will not redirect the thread to a different provider session.

If a conversation is missing, check that:

- the draft uses the provider instance and account that created it;
- the CLI conversation was started in the current project or one of its aqqua worktrees;
- the provider supports session adoption (currently Claude Code and Codex);
- the conversation is not already owned by another aqqua thread.

## Continue an aqqua Claude conversation in the TUI

Start Claude Code from the same working directory and with the same Claude home used by the aqqua provider. Run `/resume` in Claude's TUI and select the aqqua conversation from the normal picker. No aqqua-specific command or session ID is required.
