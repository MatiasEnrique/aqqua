import { describe, expect, it } from "vite-plus/test";

import {
  buildComposerBuiltInSlashCommands,
  builtInComposerCommandNames,
  pickerForComposerBuiltInCommand,
} from "./composerBuiltInCommands";

describe("composer built-in slash commands", () => {
  it("offers /resume only for local drafts", () => {
    expect(buildComposerBuiltInSlashCommands(true).map((item) => item.command)).toContain("resume");
    expect(buildComposerBuiltInSlashCommands(false).map((item) => item.command)).not.toContain(
      "resume",
    );
  });

  it("reserves built-in command names so provider duplicates can be removed", () => {
    const names = builtInComposerCommandNames(buildComposerBuiltInSlashCommands(true));
    expect(["resume", "provider-only"].filter((name) => !names.has(name))).toEqual([
      "provider-only",
    ]);
  });

  it("routes accepting /resume to the resume picker", () => {
    expect(pickerForComposerBuiltInCommand("resume")).toBe("resume");
  });
});
