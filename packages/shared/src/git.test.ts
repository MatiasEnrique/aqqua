import type { VcsRef, VcsStatusRemoteResult, VcsStatusResult } from "@aqqua/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyGitStatusStreamEvent,
  buildTemporaryWorktreeBranchName,
  isTemporaryWorktreeBranch,
  normalizeGitRemoteUrl,
  parseGitHubRepositoryNameWithOwnerFromRemoteUrl,
  resolveNewWorktreeBaseRef,
  WORKTREE_BRANCH_PREFIX,
} from "./git.ts";

const ref = (overrides: Partial<VcsRef> & Pick<VcsRef, "name">): VcsRef => ({
  current: false,
  isDefault: false,
  worktreePath: null,
  ...overrides,
});

describe("normalizeGitRemoteUrl", () => {
  it("canonicalizes equivalent GitHub remotes across protocol variants", () => {
    expect(normalizeGitRemoteUrl("git@github.com:Aqqua/Aqqua.git")).toBe("github.com/aqqua/aqqua");
    expect(normalizeGitRemoteUrl("https://github.com/Aqqua/Aqqua.git")).toBe(
      "github.com/aqqua/aqqua",
    );
    expect(normalizeGitRemoteUrl("ssh://git@github.com/Aqqua/Aqqua")).toBe(
      "github.com/aqqua/aqqua",
    );
  });

  it("preserves nested group paths for providers like GitLab", () => {
    expect(normalizeGitRemoteUrl("git@gitlab.com:Aqqua/platform/Aqqua.git")).toBe(
      "gitlab.com/aqqua/platform/aqqua",
    );
    expect(normalizeGitRemoteUrl("https://gitlab.com/Aqqua/platform/Aqqua.git")).toBe(
      "gitlab.com/aqqua/platform/aqqua",
    );
  });

  it("drops explicit ports from URL-shaped remotes", () => {
    expect(normalizeGitRemoteUrl("https://gitlab.company.com:8443/team/project.git")).toBe(
      "gitlab.company.com/team/project",
    );
    expect(normalizeGitRemoteUrl("ssh://git@gitlab.company.com:2222/team/project.git")).toBe(
      "gitlab.company.com/team/project",
    );
  });
});

describe("parseGitHubRepositoryNameWithOwnerFromRemoteUrl", () => {
  it("extracts the owner and repository from common GitHub remote shapes", () => {
    expect(parseGitHubRepositoryNameWithOwnerFromRemoteUrl("git@github.com:Aqqua/Aqqua.git")).toBe(
      "Aqqua/Aqqua",
    );
    expect(
      parseGitHubRepositoryNameWithOwnerFromRemoteUrl("https://github.com/Aqqua/Aqqua.git"),
    ).toBe("Aqqua/Aqqua");
  });
});

describe("isTemporaryWorktreeBranch", () => {
  it("matches the generated temporary worktree refName format", () => {
    expect(
      isTemporaryWorktreeBranch(
        buildTemporaryWorktreeBranchName((byteLength) => {
          expect(byteLength).toBe(4);
          return "DEADBEEF";
        }),
      ),
    ).toBe(true);
  });

  it("matches generated temporary worktree refs", () => {
    expect(isTemporaryWorktreeBranch(`${WORKTREE_BRANCH_PREFIX}/deadbeef`)).toBe(true);
    expect(isTemporaryWorktreeBranch(` ${WORKTREE_BRANCH_PREFIX}/deadbeef `)).toBe(true);
    expect(isTemporaryWorktreeBranch(`${WORKTREE_BRANCH_PREFIX}/DEADBEEF`)).toBe(true);
  });

  it("normalizes a UUID-shaped random callback to the canonical 8-hex form", () => {
    expect(buildTemporaryWorktreeBranchName(() => "f4ae4e0e-f971-4d48-b4f2-9cf0aa54ab12")).toBe(
      `${WORKTREE_BRANCH_PREFIX}/f4ae4e0e`,
    );
  });

  it("matches legacy UUID-shaped temporary worktree refs from older mobile builds", () => {
    expect(
      isTemporaryWorktreeBranch(`${WORKTREE_BRANCH_PREFIX}/f4ae4e0e-f971-4d48-b4f2-9cf0aa54ab12`),
    ).toBe(true);
  });

  it("rejects UUID-shaped refs that are not RFC 4122 v4", () => {
    // version nibble is not 4
    expect(
      isTemporaryWorktreeBranch(`${WORKTREE_BRANCH_PREFIX}/f4ae4e0e-f971-1d48-b4f2-9cf0aa54ab12`),
    ).toBe(false);
    // variant nibble is not [89ab]
    expect(
      isTemporaryWorktreeBranch(`${WORKTREE_BRANCH_PREFIX}/f4ae4e0e-f971-4d48-c4f2-9cf0aa54ab12`),
    ).toBe(false);
  });

  it("rejects non-temporary refName names", () => {
    expect(isTemporaryWorktreeBranch(`${WORKTREE_BRANCH_PREFIX}/feature/demo`)).toBe(false);
    expect(isTemporaryWorktreeBranch("main")).toBe(false);
    expect(isTemporaryWorktreeBranch(`${WORKTREE_BRANCH_PREFIX}/deadbeef-extra`)).toBe(false);
  });
});

describe("resolveNewWorktreeBaseRef", () => {
  it("uses a configured origin branch instead of the repository default", () => {
    expect(
      resolveNewWorktreeBaseRef({
        refs: [
          ref({ name: "main", current: true, isDefault: true }),
          ref({ name: "origin/develop", isRemote: true, remoteName: "origin" }),
        ],
        startFromOrigin: true,
        configuredOriginBranch: "develop",
      }),
    ).toBe("origin/develop");
  });

  it("accepts common full origin ref forms", () => {
    const refs = [ref({ name: "origin/release", isRemote: true, remoteName: "origin" })];

    for (const configuredOriginBranch of [
      "origin/release",
      "refs/heads/release",
      "refs/remotes/origin/release",
    ]) {
      expect(
        resolveNewWorktreeBaseRef({
          refs,
          startFromOrigin: true,
          configuredOriginBranch,
        }),
      ).toBe("origin/release");
    }
  });

  it("keeps a configured origin branch explicit before refs load", () => {
    expect(
      resolveNewWorktreeBaseRef({
        refs: [],
        startFromOrigin: true,
        configuredOriginBranch: "feature/integration",
      }),
    ).toBe("origin/feature/integration");
  });

  it("preserves repository-default and local fallback behavior when unconfigured", () => {
    const refs = [
      ref({ name: "feature/current", current: true }),
      ref({ name: "origin/main", isRemote: true, isDefault: true, remoteName: "origin" }),
    ];

    expect(
      resolveNewWorktreeBaseRef({
        refs,
        startFromOrigin: true,
        configuredOriginBranch: "",
      }),
    ).toBe("origin/main");
    expect(
      resolveNewWorktreeBaseRef({
        refs,
        startFromOrigin: false,
        configuredOriginBranch: "develop",
      }),
    ).toBe("feature/current");
  });
});

describe("applyGitStatusStreamEvent", () => {
  it("treats a remote-only update as a repository when local state is missing", () => {
    const remote: VcsStatusRemoteResult = {
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      pr: null,
    };

    expect(applyGitStatusStreamEvent(null, { _tag: "remoteUpdated", remote })).toEqual({
      isRepo: true,
      hasPrimaryRemote: false,
      isDefaultRef: false,
      refName: null,
      hasWorkingTreeChanges: false,
      workingTree: { files: [], insertions: 0, deletions: 0 },
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      pr: null,
    });
  });

  it("preserves local-only fields when applying a remote update", () => {
    const current: VcsStatusResult = {
      isRepo: true,
      sourceControlProvider: {
        kind: "github",
        name: "GitHub",
        baseUrl: "https://github.com",
      },
      hasPrimaryRemote: true,
      isDefaultRef: false,
      refName: "feature/demo",
      hasWorkingTreeChanges: true,
      workingTree: {
        files: [{ path: "src/demo.ts", insertions: 1, deletions: 0 }],
        insertions: 1,
        deletions: 0,
      },
      hasUpstream: false,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
    };

    const remote: VcsStatusRemoteResult = {
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      pr: null,
    };

    expect(applyGitStatusStreamEvent(current, { _tag: "remoteUpdated", remote })).toEqual({
      ...current,
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      pr: null,
    });
  });
});
