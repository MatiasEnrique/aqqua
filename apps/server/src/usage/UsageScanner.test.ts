import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { RuntimeReceiptBusTest } from "../orchestration/Layers/RuntimeReceiptBus.ts";
import { RuntimeReceiptBus } from "../orchestration/Services/RuntimeReceiptBus.ts";
import { UsageLedgerRepositoryLive } from "../persistence/Layers/UsageLedger.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { UsageLedgerRepository } from "../persistence/Services/UsageLedger.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { AccountRateLimits } from "./AccountRateLimits.ts";
import {
  UsageScanner,
  type UsageScanCompletedReceipt,
  type UsageScannerRoots,
} from "./UsageScanner.ts";

function scannerLayer(roots: UsageScannerRoots, scanEnabled: boolean) {
  const ledger = UsageLedgerRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory));
  const dependencies = Layer.mergeAll(
    NodeServices.layer,
    ledger,
    ServerSettingsService.layerTest({ usage: { scanEnabled } }),
    AccountRateLimits.layer,
    RuntimeReceiptBusTest,
  );
  return UsageScanner.layer({ roots, runInBackground: false }).pipe(
    Layer.provideMerge(dependencies),
  );
}

const claudeLine = (requestId: string, inputTokens: number) =>
  `${JSON.stringify({
    type: "assistant",
    requestId,
    timestamp: "2026-08-04T12:00:00.000Z",
    cwd: "/external/workspace",
    sessionId: "claude-session",
    gitBranch: "usage",
    message: {
      model: "claude-sonnet-5",
      usage: {
        input_tokens: inputTokens,
        cache_read_input_tokens: 2,
        cache_creation_input_tokens: 3,
        output_tokens: 4,
      },
    },
  })}\n`;

const codexHeader = `${JSON.stringify({
  type: "session_meta",
  payload: {
    session_id: "codex-session",
    cwd: "/external/workspace",
    originator: "codex_cli",
  },
})}\n${JSON.stringify({
  type: "turn_context",
  timestamp: "2026-08-04T12:00:00.000Z",
  payload: { model: "gpt-5.4" },
})}\n`;

const codexCount = (
  timestamp: string,
  inputTokens: number,
  outputTokens: number,
  usedPercent: number,
) =>
  `${JSON.stringify({
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: inputTokens,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: outputTokens,
          reasoning_output_tokens: 0,
        },
      },
      rate_limits: {
        primary: {
          used_percent: usedPercent,
          window_minutes: 300,
          resets_at: 1_800_000_000,
        },
        plan_type: "pro",
      },
    },
  })}\n`;

const awaitUsageReceipt = Effect.fn("UsageScannerTest.awaitUsageReceipt")(function* () {
  const bus = yield* RuntimeReceiptBus;
  return yield* bus.streamEventsForTest.pipe(
    Stream.filter(
      (receipt): receipt is UsageScanCompletedReceipt => receipt.type === "usage.scan.completed",
    ),
    Stream.runHead,
  );
});

it.layer(NodeServices.layer)("UsageScanner", (it) => {
  it.effect("scans fixture logs into aggregate ledger rows and publishes a receipt", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "aqqua-usage-scanner-",
      });
      const roots = {
        claudeProjectsDirectory: path.join(home, ".claude", "projects"),
        codexSessionsDirectory: path.join(home, ".codex", "sessions"),
      };
      const claudeDirectory = path.join(roots.claudeProjectsDirectory, "external-workspace");
      const codexDirectory = path.join(roots.codexSessionsDirectory, "2026", "08", "04");
      yield* fileSystem.makeDirectory(claudeDirectory, { recursive: true });
      yield* fileSystem.makeDirectory(codexDirectory, { recursive: true });
      yield* fileSystem.writeFileString(
        path.join(claudeDirectory, "session.jsonl"),
        claudeLine("req-1", 10),
      );
      yield* fileSystem.writeFileString(
        path.join(codexDirectory, "rollout-session.jsonl"),
        codexHeader + codexCount("2026-08-04T12:01:00.000Z", 20, 5, 25),
      );

      yield* Effect.gen(function* () {
        const scanner = yield* UsageScanner;
        const ledger = yield* UsageLedgerRepository;
        const rates = yield* AccountRateLimits;
        const receiptFiber = yield* awaitUsageReceipt().pipe(Effect.forkScoped);
        const result = yield* scanner.scan;
        const receipt = yield* Fiber.join(receiptFiber);

        assert.deepStrictEqual(Option.getOrNull(receipt), result);
        assert.equal(result.scannedFiles, 2);
        assert.equal(result.parsedTurns, 2);
        const overview = yield* ledger.getOverview("all");
        assert.deepStrictEqual(
          overview.providers.map(({ provider, inputTokens, outputTokens, turns }) => ({
            provider,
            inputTokens,
            outputTokens,
            turns,
          })),
          [
            { provider: "claude", inputTokens: 10, outputTokens: 4, turns: 1 },
            { provider: "codex", inputTokens: 20, outputTokens: 5, turns: 1 },
          ],
        );
        const latestRates = yield* rates.latest;
        assert.equal(latestRates.rateLimits[0]?.provider, "codex");
        assert.equal(latestRates.rateLimits[0]?.windows[0]?.usedPercent, 25);
      }).pipe(Effect.provide(scannerLayer(roots, true)));
    }),
  );

  it.effect("resumes from the saved byte offset and ingests only an appended tail", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "aqqua-usage-scanner-resume-",
      });
      const roots = {
        claudeProjectsDirectory: path.join(home, ".claude", "projects"),
        codexSessionsDirectory: path.join(home, ".codex", "sessions"),
      };
      const codexDirectory = path.join(roots.codexSessionsDirectory, "2026", "08", "04");
      const rollout = path.join(codexDirectory, "rollout-session.jsonl");
      yield* fileSystem.makeDirectory(codexDirectory, { recursive: true });
      yield* fileSystem.writeFileString(
        rollout,
        codexHeader + codexCount("2026-08-04T12:01:00.000Z", 20, 5, 25),
      );

      yield* Effect.gen(function* () {
        const scanner = yield* UsageScanner;
        const ledger = yield* UsageLedgerRepository;
        yield* scanner.scan;
        yield* fileSystem.writeFileString(
          rollout,
          codexCount("2026-08-04T12:02:00.000Z", 27, 8, 30),
          { flag: "a" },
        );
        const second = yield* scanner.scan;
        assert.equal(second.parsedTurns, 1);
        const [codex] = (yield* ledger.getOverview("all")).providers;
        assert.equal(codex?.inputTokens, 27);
        assert.equal(codex?.outputTokens, 8);
        assert.equal(codex?.turns, 2);
        assert.equal(codex?.sessions, 1);
      }).pipe(Effect.provide(scannerLayer(roots, true)));
    }),
  );

  it.effect("coalesces duplicate scan requests into one completed scan", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "aqqua-usage-scanner-single-flight-",
      });
      const roots = {
        claudeProjectsDirectory: path.join(home, ".claude", "projects"),
        codexSessionsDirectory: path.join(home, ".codex", "sessions"),
      };
      const claudeDirectory = path.join(roots.claudeProjectsDirectory, "external-workspace");
      yield* fileSystem.makeDirectory(claudeDirectory, { recursive: true });
      yield* fileSystem.writeFileString(
        path.join(claudeDirectory, "session.jsonl"),
        claudeLine("req-single", 10),
      );

      yield* Effect.gen(function* () {
        const scanner = yield* UsageScanner;
        const ledger = yield* UsageLedgerRepository;
        const [first, second] = yield* Effect.all([scanner.scan, scanner.scan], {
          concurrency: "unbounded",
        });
        assert.deepStrictEqual(first, second);
        const [claude] = (yield* ledger.getOverview("all")).providers;
        assert.equal(claude?.turns, 1);
      }).pipe(Effect.provide(scannerLayer(roots, true)));
    }),
  );

  it.effect("rebuilds the ledger when an append-only file shrinks", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "aqqua-usage-scanner-shrink-",
      });
      const roots = {
        claudeProjectsDirectory: path.join(home, ".claude", "projects"),
        codexSessionsDirectory: path.join(home, ".codex", "sessions"),
      };
      const claudeDirectory = path.join(roots.claudeProjectsDirectory, "external-workspace");
      const log = path.join(claudeDirectory, "session.jsonl");
      yield* fileSystem.makeDirectory(claudeDirectory, { recursive: true });
      yield* fileSystem.writeFileString(
        log,
        claudeLine("req-long-one", 100) + claudeLine("req-long-two", 200),
      );

      yield* Effect.gen(function* () {
        const scanner = yield* UsageScanner;
        const ledger = yield* UsageLedgerRepository;
        yield* scanner.scan;
        yield* fileSystem.writeFileString(log, claudeLine("r", 1));
        yield* scanner.scan;
        const [claude] = (yield* ledger.getOverview("all")).providers;
        assert.equal(claude?.inputTokens, 1);
        assert.equal(claude?.turns, 1);
      }).pipe(Effect.provide(scannerLayer(roots, true)));
    }),
  );

  it.effect("performs no filesystem scan or ledger writes while disabled", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "aqqua-usage-scanner-disabled-",
      });
      const roots = {
        claudeProjectsDirectory: path.join(home, ".claude", "projects"),
        codexSessionsDirectory: path.join(home, ".codex", "sessions"),
      };

      yield* Effect.gen(function* () {
        const scanner = yield* UsageScanner;
        const sql = yield* SqlClient.SqlClient;
        const result = yield* scanner.scan;
        assert.equal(result.scannedFiles, 0);
        const [rollups] = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM usage_daily_rollup
        `;
        const [scanFiles] = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM usage_scan_files
        `;
        assert.equal(rollups?.count, 0);
        assert.equal(scanFiles?.count, 0);
        assert.deepStrictEqual(yield* scanner.state, {
          enabled: false,
          scanning: false,
          lastScanAt: null,
        });
      }).pipe(Effect.provide(scannerLayer(roots, false)));
    }),
  );
});
