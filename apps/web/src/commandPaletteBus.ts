import type { ScopedProjectRef } from "@t3tools/contracts";

// Tiny event bus allowing components to programmatically open the command palette
// without owning its React state.
const COMMAND_PALETTE_OPEN_EVENT = "t3code:open-command-palette";

export type CommandPaletteOpenDetail =
  | {
      /**
       * `new-worktree` skips the palette and opens the worktree dialog the
       * palette hosts, so callers do not have to own that dialog's state.
       */
      readonly open: "new-worktree";
      readonly context?: {
        readonly projectRef: ScopedProjectRef;
        /** Existing worktree branch to preselect as the new worktree's base. */
        readonly baseBranch: string;
      };
    }
  | {
      readonly open?: "add-project" | "new-thread-in";
      readonly context?: never;
    };

export function openCommandPalette(detail?: CommandPaletteOpenDetail): void {
  window.dispatchEvent(
    new CustomEvent(COMMAND_PALETTE_OPEN_EVENT, detail ? { detail } : undefined),
  );
}

export function onOpenCommandPalette(
  listener: (detail: CommandPaletteOpenDetail) => void,
): () => void {
  const handler = (event: Event) => {
    listener((event as CustomEvent<CommandPaletteOpenDetail>).detail ?? {});
  };
  window.addEventListener(COMMAND_PALETTE_OPEN_EVENT, handler);
  return () => window.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, handler);
}

/** Read at event time so consumers do not subscribe to transient dialog state. */
export function isCommandPaletteOpen(): boolean {
  return (
    typeof document !== "undefined" && document.querySelector("[data-command-palette]") !== null
  );
}
