import type { ProjectScript, VcsRef } from "@aqqua/contracts";
import { describe, expect, it } from "vite-plus/test";

import { NO_WORKTREE_SETUP_SCRIPT_ID } from "~/projectScripts";
import {
  buildSetupActionOptions,
  normalizeWorktreeBranchName,
  resolveDefaultBaseBranch,
  resolveDefaultSetupActionValue,
  validateWorktreeBranchName,
} from "./NewWorktreeThreadDialog.logic";

const script = (overrides: Partial<ProjectScript> & Pick<ProjectScript, "id">): ProjectScript => ({
  name: overrides.id,
  command: "echo hi",
  icon: "play",
  runOnWorktreeCreate: false,
  ...overrides,
});

const ref = (overrides: Partial<VcsRef> & Pick<VcsRef, "name">): VcsRef => ({
  current: false,
  isDefault: false,
  worktreePath: null,
  ...overrides,
});

describe("normalizeWorktreeBranchName", () => {
  it("keeps a plain typed name as-is instead of forcing a feature/ prefix", () => {
    expect(normalizeWorktreeBranchName("fix-login")).toBe("fix-login");
  });

  it("preserves a namespace the user typed", () => {
    expect(normalizeWorktreeBranchName("release/2026-01")).toBe("release/2026-01");
  });

  it("sanitizes spaces and casing into a git-legal ref", () => {
    expect(normalizeWorktreeBranchName("  Fix The Login  ")).toBe("fix-the-login");
  });

  it("returns empty when nothing addressable survives", () => {
    expect(normalizeWorktreeBranchName("///")).toBe("");
    expect(normalizeWorktreeBranchName("!!!")).toBe("");
  });
});

describe("validateWorktreeBranchName", () => {
  it("accepts a usable name", () => {
    expect(validateWorktreeBranchName({ value: "fix-login", existingBranchNames: ["main"] })).toBe(
      null,
    );
  });

  it("rejects an empty name", () => {
    expect(validateWorktreeBranchName({ value: "   ", existingBranchNames: [] })).toBe(
      "Enter a name for the new worktree.",
    );
  });

  it("rejects a name with no letters or numbers", () => {
    expect(validateWorktreeBranchName({ value: "///", existingBranchNames: [] })).toBe(
      "Use letters or numbers so this can become a branch name.",
    );
  });

  it("reports a collision against the normalized name rather than auto-suffixing", () => {
    expect(
      validateWorktreeBranchName({
        value: "Fix Login",
        existingBranchNames: ["main", "fix-login"],
      }),
    ).toBe('A branch named "fix-login" already exists.');
  });

  it("compares collisions case-insensitively", () => {
    expect(
      validateWorktreeBranchName({ value: "fix-login", existingBranchNames: ["FIX-LOGIN"] }),
    ).toBe('A branch named "fix-login" already exists.');
  });
});

describe("buildSetupActionOptions", () => {
  it("marks the project's worktree-create script as the default and always offers an opt-out", () => {
    expect(
      buildSetupActionOptions([
        script({ id: "setup", name: "Setup", runOnWorktreeCreate: true }),
        script({ id: "seed", name: "Seed" }),
      ]),
    ).toEqual([
      { value: "setup", label: "Setup (default)" },
      { value: "seed", label: "Seed" },
      { value: NO_WORKTREE_SETUP_SCRIPT_ID, label: "No action" },
    ]);
  });

  it("offers only the opt-out when the project has no scripts", () => {
    expect(buildSetupActionOptions([])).toEqual([
      { value: NO_WORKTREE_SETUP_SCRIPT_ID, label: "No action" },
    ]);
  });
});

describe("resolveDefaultSetupActionValue", () => {
  it("preselects the flagged script", () => {
    expect(
      resolveDefaultSetupActionValue([
        script({ id: "seed", name: "Seed" }),
        script({ id: "setup", name: "Setup", runOnWorktreeCreate: true }),
      ]),
    ).toBe("setup");
  });

  it("preselects the opt-out when nothing is flagged", () => {
    expect(resolveDefaultSetupActionValue([script({ id: "seed", name: "Seed" })])).toBe(
      NO_WORKTREE_SETUP_SCRIPT_ID,
    );
  });
});

describe("resolveDefaultBaseBranch", () => {
  it("prefers the repository default branch", () => {
    expect(
      resolveDefaultBaseBranch([
        ref({ name: "feature/wip", current: true }),
        ref({ name: "main", isDefault: true }),
      ]),
    ).toBe("main");
  });

  it("falls back to the current checkout", () => {
    expect(
      resolveDefaultBaseBranch([
        ref({ name: "other" }),
        ref({ name: "feature/wip", current: true }),
      ]),
    ).toBe("feature/wip");
  });

  it("never preselects a remote-only ref", () => {
    expect(
      resolveDefaultBaseBranch([
        ref({ name: "origin/main", isRemote: true, isDefault: true }),
        ref({ name: "local-only" }),
      ]),
    ).toBe("local-only");
  });

  it("preselects a configured origin branch", () => {
    expect(
      resolveDefaultBaseBranch(
        [
          ref({ name: "main", isDefault: true }),
          ref({ name: "origin/develop", isRemote: true, remoteName: "origin" }),
        ],
        { startFromOrigin: true, configuredOriginBranch: "develop" },
      ),
    ).toBe("origin/develop");
  });

  it("returns null with no refs", () => {
    expect(resolveDefaultBaseBranch([])).toBe(null);
  });
});
