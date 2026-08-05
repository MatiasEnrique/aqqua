import { describe, expect, it } from "vite-plus/test";

import { resumeSessionDraftContext } from "./composerResumeSelection";

describe("resumeSessionDraftContext", () => {
  it("adopts a managed worktree without preparing a new worktree", () => {
    expect(
      resumeSessionDraftContext("/repo", {
        cwd: "/repo/.aqqua/worktrees/feature",
        gitBranch: "feature/resume",
      }),
    ).toEqual({
      worktreePath: "/repo/.aqqua/worktrees/feature",
      envMode: "local",
      branch: "feature/resume",
      startFromOrigin: false,
      worktreeBranchName: null,
      worktreeSetupScriptId: null,
    });
  });

  it("uses the project root without retaining pending worktree setup", () => {
    expect(resumeSessionDraftContext("/repo", { cwd: "/repo" })).toMatchObject({
      worktreePath: null,
      envMode: "local",
      worktreeBranchName: null,
      worktreeSetupScriptId: null,
    });
  });
});
