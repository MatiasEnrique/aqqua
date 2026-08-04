// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { listCodexLogFiles, parseCodexLog } from "./CodexLogSource.ts";

const fixture = NodeFS.readFileSync(
  new URL("./__fixtures__/codex-log.jsonl", import.meta.url),
  "utf8",
);

describe("CodexLogSource", () => {
  it("differences cumulative counters, drops duplicates, and treats resets as fresh baselines", () => {
    const result = parseCodexLog(fixture);

    expect(result.turns).toEqual([
      expect.objectContaining({
        sessionId: "codex-session-1",
        model: "gpt-5.4",
        projectPath: "/workspace/alpha",
        originator: "t3code_desktop",
        sessionSource: "vscode",
        inputTokens: 80,
        cachedInputTokens: 20,
        outputTokens: 10,
      }),
      expect.objectContaining({
        sessionId: "codex-session-1",
        inputTokens: 45,
        cachedInputTokens: 10,
        cacheWriteTokens: 5,
        outputTokens: 8,
        reasoningTokens: 3,
      }),
      expect.objectContaining({
        sessionId: "codex-session-2",
        model: "gpt-5.6-sol",
        projectPath: "/workspace/beta",
        inputTokens: 4,
        cachedInputTokens: 2,
        cacheWriteTokens: 1,
        outputTokens: 3,
      }),
      expect.objectContaining({
        sessionId: "codex-session-2",
        inputTokens: 1,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 1,
      }),
    ]);
    expect(result.rateLimits).toEqual({
      timestamp: "2026-08-01T12:02:00.000Z",
      rateLimits: expect.objectContaining({
        primary: expect.objectContaining({ used_percent: 31 }),
      }),
    });
  });

  it("resumes a headerless tail from carried parser state", () => {
    const lines = fixture.trimEnd().split("\n");
    const first = parseCodexLog(lines.slice(0, 5).join("\n"));
    const resumed = parseCodexLog(lines.slice(5).join("\n"), first.state);

    expect(first.turns).toHaveLength(2);
    expect(resumed.turns.map((turn) => turn.sessionId)).toEqual([
      "codex-session-2",
      "codex-session-2",
    ]);
    expect(resumed.state.sessionId).toBe("codex-session-2");
  });
});

it.layer(NodeServices.layer, { excludeTestServices: true })(
  "CodexLogSource candidate discovery",
  (it) => {
    it.effect("lists only dated rollout JSONL files", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "aqqua-codex-log-source-",
        });
        const day = path.join(root, "2026", "08", "01");
        yield* fileSystem.makeDirectory(day, { recursive: true });
        yield* fileSystem.writeFileString(path.join(day, "rollout-session.jsonl"), "");
        yield* fileSystem.writeFileString(path.join(day, "other.jsonl"), "");
        yield* fileSystem.writeFileString(path.join(root, "rollout-root.jsonl"), "");

        expect(yield* listCodexLogFiles(root)).toEqual([path.join(day, "rollout-session.jsonl")]);
      }),
    );
  },
);
