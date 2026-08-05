import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { UsageLedgerRepository } from "../Services/UsageLedger.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { UsageLedgerRepositoryLive } from "./UsageLedger.ts";

const layer = it.layer(UsageLedgerRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)));

layer("UsageLedgerRepository", (it) => {
  it.effect("merges rollups additively and aggregates without exposing raw rows", () =>
    Effect.gen(function* () {
      const repository = yield* UsageLedgerRepository;
      const sql = yield* SqlClient.SqlClient;
      const [currentDay] = yield* sql<{ readonly day: string }>`
        SELECT date('now', 'localtime') AS day
      `;
      if (!currentDay) {
        return yield* Effect.die("Expected SQLite to return the current local day.");
      }
      const today = currentDay.day;
      const codex = {
        day: today,
        provider: "codex",
        model: "gpt-5.4",
        projectPath: "/workspace/aqqua",
        gitBranch: "usage",
        inputTokens: 10,
        cachedInputTokens: 20,
        cacheWriteTokens: 0,
        outputTokens: 5,
        reasoningTokens: 2,
        turns: 1,
        sessions: 1,
        costUsd: 0.75,
        source: "log-scan",
      } as const;

      yield* repository.upsertRollups([codex]);
      yield* repository.upsertRollups([codex]);
      yield* repository.upsertRollups([
        {
          day: today,
          provider: "claude",
          model: "unknown-model",
          projectPath: "/workspace/external",
          gitBranch: "",
          inputTokens: 3,
          cachedInputTokens: 4,
          cacheWriteTokens: 5,
          outputTokens: 6,
          reasoningTokens: 0,
          turns: 1,
          sessions: 1,
          costUsd: null,
          source: "log-scan",
        },
      ]);

      const overview = yield* repository.getOverview("7d");
      assert.deepStrictEqual(overview.providers, [
        {
          provider: "claude",
          inputTokens: 3,
          cachedInputTokens: 4,
          cacheWriteTokens: 5,
          outputTokens: 6,
          reasoningTokens: 0,
          turns: 1,
          sessions: 1,
          costUsd: 0,
          hasPartialCost: true,
        },
        {
          provider: "codex",
          inputTokens: 20,
          cachedInputTokens: 40,
          cacheWriteTokens: 0,
          outputTokens: 10,
          reasoningTokens: 4,
          turns: 2,
          sessions: 2,
          costUsd: 1.5,
          hasPartialCost: false,
        },
      ]);
      assert.deepStrictEqual(overview.daily, [
        {
          day: today,
          inputTokens: 23,
          cachedInputTokens: 44,
          cacheWriteTokens: 5,
          outputTokens: 16,
          reasoningTokens: 4,
          turns: 3,
          sessions: 3,
          costUsd: 1.5,
          hasPartialCost: true,
        },
      ]);
      assert.deepStrictEqual(overview.tokenMix, {
        inputTokens: 23,
        cachedInputTokens: 44,
        cacheWriteTokens: 5,
        outputTokens: 16,
        reasoningTokens: 4,
      });
      assert.equal(overview.costUsd, 1.5);
      assert.equal(overview.hasPartialCost, true);

      const byModel = yield* repository.getBreakdown("model", "7d");
      assert.deepStrictEqual(
        byModel.map(({ key, turns, costUsd, hasPartialCost }) => ({
          key,
          turns,
          costUsd,
          hasPartialCost,
        })),
        [
          { key: "gpt-5.4", turns: 2, costUsd: 1.5, hasPartialCost: false },
          { key: "unknown-model", turns: 1, costUsd: 0, hasPartialCost: true },
        ],
      );
    }),
  );

  it.effect("round-trips scan offsets and clears both ledger tables", () =>
    Effect.gen(function* () {
      const repository = yield* UsageLedgerRepository;
      const scannedAt = "2026-08-04T12:00:00.000Z";

      yield* repository.upsertScanFile({
        path: "/tmp/rollout.jsonl",
        mtimeMs: 100,
        size: 200,
        byteOffset: 150,
        scannedAt,
        rollupKeys: [],
      });
      yield* repository.upsertScanFile({
        path: "/tmp/rollout.jsonl",
        mtimeMs: 101,
        size: 250,
        byteOffset: 250,
        scannedAt,
        rollupKeys: ["key-a"],
      });

      const scanFile = yield* repository.getScanFile("/tmp/rollout.jsonl");
      assert.deepStrictEqual(Option.getOrNull(scanFile), {
        path: "/tmp/rollout.jsonl",
        mtimeMs: 101,
        size: 250,
        byteOffset: 250,
        scannedAt,
        rollupKeys: ["key-a"],
      });

      yield* repository.upsertRollups([
        {
          day: "2026-08-04",
          provider: "codex",
          model: "",
          projectPath: "",
          gitBranch: "",
          inputTokens: 1,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          turns: 1,
          sessions: 1,
          costUsd: null,
          source: "log-scan",
        },
      ]);

      yield* repository.clear();

      assert.equal(Option.isNone(yield* repository.getScanFile("/tmp/rollout.jsonl")), true);
      assert.deepStrictEqual(yield* repository.getOverview("all"), {
        providers: [],
        daily: [],
        tokenMix: {
          inputTokens: 0,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
        },
        costUsd: 0,
        hasPartialCost: false,
      });
    }),
  );
});
