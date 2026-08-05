import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import { ChildProcessSpawner } from "effect/unstable/process";
import { assert, it } from "@effect/vitest";

import { GitCommandError } from "@aqqua/contracts";
import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "./GitVcsDriver.ts";
import * as VcsDriver from "./VcsDriver.ts";
import * as VcsProcess from "./VcsProcess.ts";
import { runVcsDriverContractSuite } from "./testing/VcsDriverContractHarness.ts";

const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "aqqua-git-vcs-contract-",
});
const GitContractLayer = Layer.mergeAll(GitVcsDriver.vcsLayer, GitVcsDriver.layer).pipe(
  Layer.provide(ServerConfigLayer),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(NodeServices.layer),
);

const runGit = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const driver = yield* GitVcsDriver.GitVcsDriver;
    yield* driver.execute({
      operation: "GitVcsDriver.contract.git",
      cwd,
      args,
      timeoutMs: 10_000,
    });
  });

type GitContractError = GitCommandError | PlatformError.PlatformError;

runVcsDriverContractSuite<GitVcsDriver.GitVcsDriver, GitContractError>({
  name: "Git",
  kind: "git",
  layer: GitContractLayer,
  fixture: {
    createRepo: (cwd) =>
      Effect.gen(function* () {
        yield* runGit(cwd, ["init"]);
        yield* runGit(cwd, ["config", "user.email", "test@test.com"]);
        yield* runGit(cwd, ["config", "user.name", "Test"]);
      }),
    writeFile: (cwd, relativePath, contents) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const absolutePath = path.join(cwd, relativePath);
        yield* fileSystem.makeDirectory(path.dirname(absolutePath), { recursive: true });
        yield* fileSystem.writeFileString(absolutePath, contents);
      }),
    trackFile: (cwd, relativePath) => runGit(cwd, ["add", relativePath]),
    commit: (cwd, message) => runGit(cwd, ["commit", "-m", message]),
    ignorePath: (cwd, pattern) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fileSystem.writeFileString(path.join(cwd, ".gitignore"), `${pattern}\n`);
      }),
  },
});

it.effect("GitVcsDriver forwards execute env to the VCS process", () => {
  let observedEnv: NodeJS.ProcessEnv | undefined;
  let observedAppendTruncationMarker: boolean | undefined;

  return Effect.gen(function* () {
    const driver = yield* GitVcsDriver.makeVcsDriverShape();

    yield* driver.execute({
      operation: "GitVcsDriver.test.env",
      cwd: "/repo",
      args: ["status"],
      env: {
        GIT_INDEX_FILE: "/tmp/aqqua-index",
      },
      appendTruncationMarker: true,
    });

    assert.deepStrictEqual(observedEnv, {
      GIT_INDEX_FILE: "/tmp/aqqua-index",
    });
    assert.strictEqual(observedAppendTruncationMarker, true);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        NodeServices.layer,
        Layer.mock(VcsProcess.VcsProcess)({
          run: (input) =>
            Effect.sync(() => {
              observedEnv = input.env;
              observedAppendTruncationMarker = input.appendTruncationMarker;
              return {
                exitCode: ChildProcessSpawner.ExitCode(0),
                stdout: "",
                stderr: "",
                stdoutTruncated: false,
                stderrTruncated: false,
              };
            }),
        }),
      ),
    ),
  );
});

it.effect("GitVcsDriver rejects truncated conflict status output", () =>
  Effect.gen(function* () {
    const driver = yield* GitVcsDriver.makeVcsDriverShape();
    if (!driver.listConflicts) {
      return assert.fail("Git conflict listing is unavailable");
    }

    const error = yield* driver.listConflicts("/repo").pipe(Effect.flip);
    if (error._tag !== "VcsProcessExitError") {
      return assert.fail(`Expected VcsProcessExitError, received ${error._tag}`);
    }
    assert.include(error.detail, "truncated");
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        NodeServices.layer,
        Layer.mock(VcsProcess.VcsProcess)({
          run: () =>
            Effect.succeed({
              exitCode: ChildProcessSpawner.ExitCode(0),
              stdout: "u UU N... 100644 100644 100644 100644 aaa bbb ccc src/app.ts\0",
              stderr: "",
              stdoutTruncated: true,
              stderrTruncated: false,
            }),
        }),
      ),
    ),
  ),
);

it.effect("the provider-neutral Git driver exposes working-tree operations", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const cwd = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "aqqua-git-vcs-working-tree-",
    });
    const driver = yield* VcsDriver.VcsDriver;
    assert.isFunction(driver.discardChanges);
    assert.isFunction(driver.listConflicts);
    assert.isFunction(driver.resolveConflict);
    assert.isFunction(driver.rebaseFromBase);
    assert.isFunction(driver.abortConflictOperation);
    if (
      !driver.discardChanges ||
      !driver.listConflicts ||
      !driver.resolveConflict ||
      !driver.rebaseFromBase ||
      !driver.abortConflictOperation
    ) {
      return assert.fail("Git working-tree operations are unavailable");
    }

    yield* runGit(cwd, ["init"]);
    yield* runGit(cwd, ["config", "user.email", "test@test.com"]);
    yield* runGit(cwd, ["config", "user.name", "Test"]);
    yield* fileSystem.writeFileString(path.join(cwd, "README.md"), "base\n");
    yield* runGit(cwd, ["add", "README.md"]);
    yield* runGit(cwd, ["commit", "-m", "base"]);
    yield* fileSystem.writeFileString(path.join(cwd, "README.md"), "changed\n");
    yield* fileSystem.writeFileString(path.join(cwd, "untracked.txt"), "remove\n");

    yield* driver.discardChanges({ cwd, paths: ["README.md", "untracked.txt"] });

    assert.equal(yield* fileSystem.readFileString(path.join(cwd, "README.md")), "base\n");
    assert.isFalse(yield* fileSystem.exists(path.join(cwd, "untracked.txt")));
    assert.deepStrictEqual(yield* driver.listConflicts(cwd), {
      operation: null,
      conflicts: [],
    });
  }).pipe(Effect.provide(GitContractLayer)),
);

it("selects deletion when ours or theirs has no conflict stage", () => {
  assert.isTrue(GitVcsDriver.conflictResolutionDeletesPath("added-by-us", "theirs"));
  assert.isTrue(GitVcsDriver.conflictResolutionDeletesPath("added-by-them", "ours"));
  assert.isFalse(GitVcsDriver.conflictResolutionDeletesPath("added-by-us", "ours"));
  assert.isFalse(GitVcsDriver.conflictResolutionDeletesPath("added-by-them", "theirs"));
  assert.isTrue(GitVcsDriver.conflictResolutionDeletesPath("both-deleted", "ours"));
  assert.isTrue(GitVcsDriver.conflictResolutionDeletesPath("deleted-by-us", "ours"));
  assert.isTrue(GitVcsDriver.conflictResolutionDeletesPath("deleted-by-them", "theirs"));
  assert.isFalse(GitVcsDriver.conflictResolutionDeletesPath("both-deleted", "content"));
  assert.isFalse(GitVcsDriver.conflictResolutionDeletesPath("added-by-us", "content"));
});

it("parses porcelain-v2 unmerged records into typed conflicts", () => {
  const record = "u UU N... 100644 100644 100644 100644 aaa bbb ccc src/app.ts";
  assert.deepStrictEqual(GitVcsDriver.parseConflictStatus(`${record}\0`), [
    { path: "src/app.ts", kind: "both-modified" },
  ]);
});
