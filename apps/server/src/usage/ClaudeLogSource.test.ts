// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { listClaudeLogFiles, parseClaudeLog, parseClaudeLogLine } from "./ClaudeLogSource.ts";

const fixture = NodeFS.readFileSync(
  new URL("./__fixtures__/claude-log.jsonl", import.meta.url),
  "utf8",
);

describe("ClaudeLogSource", () => {
  it("parses top-level assistant usage, dedupes rewrites, and tags sidechains", () => {
    const result = parseClaudeLog(fixture);

    expect(result.turns).toEqual([
      expect.objectContaining({
        requestId: "req-main",
        model: "claude-sonnet-5",
        inputTokens: 10,
        cachedInputTokens: 30,
        cacheWriteTokens: 20,
        outputTokens: 40,
        isSubagent: false,
      }),
      expect.objectContaining({
        requestId: "req-sidechain",
        model: "claude-haiku-4-5",
        inputTokens: 5,
        cachedInputTokens: 7,
        cacheWriteTokens: 6,
        outputTokens: 8,
        isSubagent: true,
      }),
    ]);
    expect(result.state.seenRequestIds).toEqual(new Set(["req-main", "req-sidechain"]));
  });

  it("skips locally generated <synthetic> assistant messages", () => {
    expect(fixture).toContain('"req-synthetic"');
    const result = parseClaudeLog(fixture);
    expect(result.turns.some((turn) => turn.requestId === "req-synthetic")).toBe(false);
  });

  it("parses a partial tail without file-header state and can carry dedupe state", () => {
    const first = parseClaudeLog(
      fixture
        .split("\n")
        .filter((line) => line.includes('"requestId":"req-main"'))
        .slice(0, 1)
        .join("\n"),
    );
    const resumed = parseClaudeLog(fixture, first.state);

    expect(resumed.turns.map((turn) => turn.requestId)).toEqual(["req-sidechain"]);
    expect(parseClaudeLogLine("not-json")).toBeNull();
  });
});

it.layer(NodeServices.layer, { excludeTestServices: true })(
  "ClaudeLogSource candidate discovery",
  (it) => {
    it.effect("lists only project session JSONL files", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "aqqua-claude-log-source-",
        });
        yield* fileSystem.makeDirectory(path.join(root, "project-slug", "nested"), {
          recursive: true,
        });
        yield* fileSystem.writeFileString(path.join(root, "project-slug", "session.jsonl"), "");
        yield* fileSystem.writeFileString(path.join(root, "project-slug", "notes.txt"), "");
        yield* fileSystem.writeFileString(
          path.join(root, "project-slug", "nested", "not-a-session.jsonl"),
          "",
        );

        expect(yield* listClaudeLogFiles(root)).toEqual([
          path.join(root, "project-slug", "session.jsonl"),
        ]);
      }),
    );
  },
);
