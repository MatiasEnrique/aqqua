import type { ComposerCommandItem } from "./ComposerCommandMenu";

type BuiltInCommandItem = Extract<ComposerCommandItem, { type: "slash-command" }>;

export function buildComposerBuiltInSlashCommands(
  isLocalDraftThread: boolean,
): BuiltInCommandItem[] {
  return [
    {
      id: "slash:model",
      type: "slash-command",
      command: "model",
      label: "/model",
      description: "Switch response model for this thread",
    },
    {
      id: "slash:plan",
      type: "slash-command",
      command: "plan",
      label: "/plan",
      description: "Switch this thread into plan mode",
    },
    {
      id: "slash:default",
      type: "slash-command",
      command: "default",
      label: "/default",
      description: "Switch this thread back to normal build mode",
    },
    ...(isLocalDraftThread
      ? [
          {
            id: "slash:resume",
            type: "slash-command" as const,
            command: "resume" as const,
            label: "/resume",
            description: "Continue a Claude Code or Codex CLI conversation",
          },
        ]
      : []),
  ];
}

export function builtInComposerCommandNames(
  items: ReadonlyArray<BuiltInCommandItem>,
): ReadonlySet<string> {
  return new Set(items.map((item) => item.command));
}

export function pickerForComposerBuiltInCommand(
  command: BuiltInCommandItem["command"],
): "model" | "resume" | null {
  if (command === "model" || command === "resume") return command;
  return null;
}
