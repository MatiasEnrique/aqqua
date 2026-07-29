import type { FileDiffMetadata } from "@pierre/diffs/types";
import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_EXCLUDED_COMMIT_PATHS,
  isCommitFileIncluded,
  resolveDiffCommitPaths,
  setAllCommitFilesIncluded,
  shouldShowDiffCommitControls,
  summarizeCommitSelection,
  toggleCommitFileExcluded,
  type DiffCommitFile,
} from "./diffCommitSelection";

function fileDiff(name: string | null, prevName?: string | null): FileDiffMetadata {
  return {
    name,
    ...(prevName === undefined ? {} : { prevName }),
  } as unknown as FileDiffMetadata;
}

function commitFile(path: string, commitPaths: string[] = [path]): DiffCommitFile {
  return { fileKey: `key:${path}`, path, commitPaths };
}

describe("resolveDiffCommitPaths", () => {
  it("strips diff prefixes and deduplicates identical paths", () => {
    expect(resolveDiffCommitPaths(fileDiff("b/src/app.ts", "a/src/app.ts"))).toEqual([
      "src/app.ts",
    ]);
  });

  it("keeps both sides of a rename so the deletion is staged too", () => {
    expect(resolveDiffCommitPaths(fileDiff("b/src/next.ts", "a/src/prev.ts"))).toEqual([
      "src/next.ts",
      "src/prev.ts",
    ]);
  });

  it("drops /dev/null and empty names", () => {
    expect(resolveDiffCommitPaths(fileDiff("/dev/null", "a/src/gone.ts"))).toEqual(["src/gone.ts"]);
    expect(resolveDiffCommitPaths(fileDiff(null, null))).toEqual([]);
  });
});

describe("commit selection state", () => {
  it("treats every file as included by default", () => {
    expect(isCommitFileIncluded(EMPTY_EXCLUDED_COMMIT_PATHS, "src/app.ts")).toBe(true);
  });

  it("toggles a single path in and out of the exclusion set", () => {
    const excluded = toggleCommitFileExcluded(EMPTY_EXCLUDED_COMMIT_PATHS, "src/app.ts");
    expect([...excluded]).toEqual(["src/app.ts"]);
    expect([...toggleCommitFileExcluded(excluded, "src/app.ts")]).toEqual([]);
  });

  it("selects and deselects every file", () => {
    const files = [commitFile("a.ts"), commitFile("b.ts")];
    expect([...setAllCommitFilesIncluded(files, false)]).toEqual(["a.ts", "b.ts"]);
    expect([...setAllCommitFilesIncluded(files, true)]).toEqual([]);
  });
});

describe("summarizeCommitSelection", () => {
  it("omits filePaths when every file is included", () => {
    const files = [commitFile("a.ts"), commitFile("b.ts")];

    expect(summarizeCommitSelection(files, EMPTY_EXCLUDED_COMMIT_PATHS)).toEqual({
      totalCount: 2,
      includedCount: 2,
      allIncluded: true,
      noneIncluded: false,
      filePaths: undefined,
    });
  });

  it("sends the included paths when a proper subset is selected", () => {
    const files = [commitFile("a.ts"), commitFile("new.ts", ["new.ts", "old.ts"])];

    expect(summarizeCommitSelection(files, new Set(["a.ts"]))).toEqual({
      totalCount: 2,
      includedCount: 1,
      allIncluded: false,
      noneIncluded: false,
      filePaths: ["new.ts", "old.ts"],
    });
  });

  it("reports an empty selection", () => {
    const files = [commitFile("a.ts")];
    const summary = summarizeCommitSelection(files, new Set(["a.ts"]));

    expect(summary.noneIncluded).toBe(true);
    expect(summary.filePaths).toEqual([]);
  });
});

describe("shouldShowDiffCommitControls", () => {
  const base = {
    isGitRepo: true,
    selectedTurnId: null,
    gitScope: "unstaged",
    hasCwd: true,
  } as const;

  it("shows commit controls for the working-tree scope", () => {
    expect(shouldShowDiffCommitControls(base)).toBe(true);
  });

  it("hides commit controls for branch-range and turn diffs", () => {
    expect(shouldShowDiffCommitControls({ ...base, gitScope: "branch" })).toBe(false);
    expect(shouldShowDiffCommitControls({ ...base, selectedTurnId: "turn_1" })).toBe(false);
  });

  it("hides commit controls without a repo or resolved cwd", () => {
    expect(shouldShowDiffCommitControls({ ...base, isGitRepo: false })).toBe(false);
    expect(shouldShowDiffCommitControls({ ...base, hasCwd: false })).toBe(false);
  });
});
