import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  UsageBreakdownRow,
  UsageDailyTotal,
  UsageLedgerRepository,
  UsageOverview,
  UsageProviderTotal,
  UsageRollup,
  UsageScanFile,
  UsageTokenMix,
  type UsageLedgerRepositoryShape,
  type UsageRange as UsageRangeType,
} from "../Services/UsageLedger.ts";

const UsageRollupRows = Schema.Array(UsageRollup);
const PathRequest = Schema.Struct({ path: Schema.String });
const RangeRequest = Schema.Struct({ daysBeforeToday: Schema.NullOr(Schema.Int) });

const UsageProviderTotalDb = Schema.Struct({
  ...UsageProviderTotal.fields,
  hasNullCost: Schema.Int,
});
const UsageDailyTotalDb = Schema.Struct({
  ...UsageDailyTotal.fields,
  hasNullCost: Schema.Int,
});
const UsageTokenMixDb = Schema.Struct({
  ...UsageTokenMix.fields,
  costUsd: Schema.Number,
  hasNullCost: Schema.Int,
});
const UsageBreakdownRowDb = Schema.Struct({
  ...UsageBreakdownRow.fields,
  hasNullCost: Schema.Int,
});

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

function daysBeforeToday(range: UsageRangeType): number | null {
  switch (range) {
    case "7d":
      return 6;
    case "30d":
      return 29;
    case "90d":
      return 89;
    case "all":
      return null;
  }
}

function withBooleanFlag<const Row extends { readonly hasNullCost: number }>(
  row: Row,
): Omit<Row, "hasNullCost"> & { readonly hasNullCost: boolean } {
  return { ...row, hasNullCost: row.hasNullCost > 0 };
}

const makeUsageLedgerRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertUsageRollupRows = SqlSchema.void({
    Request: UsageRollupRows,
    execute: (rows) => {
      if (rows.length === 0) {
        return Effect.void;
      }
      return sql`
        INSERT INTO usage_daily_rollup ${sql.insert(
          rows.map((row) => ({
            day: row.day,
            provider: row.provider,
            model: row.model ?? "",
            project_path: row.projectPath ?? "",
            git_branch: row.gitBranch ?? "",
            input_tokens: row.inputTokens,
            cached_input_tokens: row.cachedInputTokens,
            cache_write_tokens: row.cacheWriteTokens,
            output_tokens: row.outputTokens,
            reasoning_tokens: row.reasoningTokens,
            turns: row.turns,
            sessions: row.sessions,
            cost_usd: row.costUsd,
            source: row.source,
          })),
        )}
        ON CONFLICT (day, provider, model, project_path, git_branch, source)
        DO UPDATE SET
          input_tokens = usage_daily_rollup.input_tokens + excluded.input_tokens,
          cached_input_tokens =
            usage_daily_rollup.cached_input_tokens + excluded.cached_input_tokens,
          cache_write_tokens =
            usage_daily_rollup.cache_write_tokens + excluded.cache_write_tokens,
          output_tokens = usage_daily_rollup.output_tokens + excluded.output_tokens,
          reasoning_tokens =
            usage_daily_rollup.reasoning_tokens + excluded.reasoning_tokens,
          turns = usage_daily_rollup.turns + excluded.turns,
          sessions = usage_daily_rollup.sessions + excluded.sessions,
          cost_usd = CASE
            WHEN usage_daily_rollup.cost_usd IS NULL OR excluded.cost_usd IS NULL THEN NULL
            ELSE usage_daily_rollup.cost_usd + excluded.cost_usd
          END
      `;
    },
  });

  const findScanFile = SqlSchema.findOneOption({
    Request: PathRequest,
    Result: UsageScanFile,
    execute: ({ path }) =>
      sql`
        SELECT
          path,
          mtime_ms AS "mtimeMs",
          size,
          byte_offset AS "byteOffset",
          scanned_at AS "scannedAt"
        FROM usage_scan_files
        WHERE path = ${path}
        LIMIT 1
      `,
  });

  const upsertScanFileRow = SqlSchema.void({
    Request: UsageScanFile,
    execute: (row) =>
      sql`
        INSERT INTO usage_scan_files (
          path,
          mtime_ms,
          size,
          byte_offset,
          scanned_at
        ) VALUES (
          ${row.path},
          ${row.mtimeMs},
          ${row.size},
          ${row.byteOffset},
          ${row.scannedAt}
        )
        ON CONFLICT (path)
        DO UPDATE SET
          mtime_ms = excluded.mtime_ms,
          size = excluded.size,
          byte_offset = excluded.byte_offset,
          scanned_at = excluded.scanned_at
      `,
  });

  const listProviderTotals = SqlSchema.findAll({
    Request: RangeRequest,
    Result: UsageProviderTotalDb,
    execute: ({ daysBeforeToday }) =>
      sql`
        SELECT
          provider,
          COALESCE(SUM(input_tokens), 0) AS "inputTokens",
          COALESCE(SUM(cached_input_tokens), 0) AS "cachedInputTokens",
          COALESCE(SUM(cache_write_tokens), 0) AS "cacheWriteTokens",
          COALESCE(SUM(output_tokens), 0) AS "outputTokens",
          COALESCE(SUM(reasoning_tokens), 0) AS "reasoningTokens",
          COALESCE(SUM(turns), 0) AS turns,
          COALESCE(SUM(sessions), 0) AS sessions,
          COALESCE(SUM(cost_usd), 0) AS "costUsd",
          MAX(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS "hasNullCost"
        FROM usage_daily_rollup
        WHERE (
          ${daysBeforeToday} IS NULL
          OR day >= date('now', 'localtime', '-' || ${daysBeforeToday} || ' days')
        )
        GROUP BY provider
        ORDER BY provider ASC
      `,
  });

  const listDailyTotals = SqlSchema.findAll({
    Request: RangeRequest,
    Result: UsageDailyTotalDb,
    execute: ({ daysBeforeToday }) =>
      sql`
        SELECT
          day,
          COALESCE(SUM(input_tokens), 0) AS "inputTokens",
          COALESCE(SUM(cached_input_tokens), 0) AS "cachedInputTokens",
          COALESCE(SUM(cache_write_tokens), 0) AS "cacheWriteTokens",
          COALESCE(SUM(output_tokens), 0) AS "outputTokens",
          COALESCE(SUM(reasoning_tokens), 0) AS "reasoningTokens",
          COALESCE(SUM(turns), 0) AS turns,
          COALESCE(SUM(sessions), 0) AS sessions,
          COALESCE(SUM(cost_usd), 0) AS "costUsd",
          MAX(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS "hasNullCost"
        FROM usage_daily_rollup
        WHERE (
          ${daysBeforeToday} IS NULL
          OR day >= date('now', 'localtime', '-' || ${daysBeforeToday} || ' days')
        )
        GROUP BY day
        ORDER BY day ASC
      `,
  });

  const getTokenMix = SqlSchema.findOne({
    Request: RangeRequest,
    Result: UsageTokenMixDb,
    execute: ({ daysBeforeToday }) =>
      sql`
        SELECT
          COALESCE(SUM(input_tokens), 0) AS "inputTokens",
          COALESCE(SUM(cached_input_tokens), 0) AS "cachedInputTokens",
          COALESCE(SUM(cache_write_tokens), 0) AS "cacheWriteTokens",
          COALESCE(SUM(output_tokens), 0) AS "outputTokens",
          COALESCE(SUM(reasoning_tokens), 0) AS "reasoningTokens",
          COALESCE(SUM(cost_usd), 0) AS "costUsd",
          COALESCE(MAX(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END), 0) AS "hasNullCost"
        FROM usage_daily_rollup
        WHERE (
          ${daysBeforeToday} IS NULL
          OR day >= date('now', 'localtime', '-' || ${daysBeforeToday} || ' days')
        )
      `,
  });

  const listModelBreakdown = SqlSchema.findAll({
    Request: RangeRequest,
    Result: UsageBreakdownRowDb,
    execute: ({ daysBeforeToday }) =>
      sql`
        SELECT
          model AS key,
          COALESCE(SUM(input_tokens), 0) AS "inputTokens",
          COALESCE(SUM(cached_input_tokens), 0) AS "cachedInputTokens",
          COALESCE(SUM(cache_write_tokens), 0) AS "cacheWriteTokens",
          COALESCE(SUM(output_tokens), 0) AS "outputTokens",
          COALESCE(SUM(reasoning_tokens), 0) AS "reasoningTokens",
          COALESCE(SUM(turns), 0) AS turns,
          COALESCE(SUM(sessions), 0) AS sessions,
          COALESCE(SUM(cost_usd), 0) AS "costUsd",
          MAX(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS "hasNullCost"
        FROM usage_daily_rollup
        WHERE (
          ${daysBeforeToday} IS NULL
          OR day >= date('now', 'localtime', '-' || ${daysBeforeToday} || ' days')
        )
        GROUP BY model
        ORDER BY (
          SUM(input_tokens) + SUM(cached_input_tokens) + SUM(cache_write_tokens)
          + SUM(output_tokens) + SUM(reasoning_tokens)
        ) DESC, model ASC
      `,
  });

  const listProjectBreakdown = SqlSchema.findAll({
    Request: RangeRequest,
    Result: UsageBreakdownRowDb,
    execute: ({ daysBeforeToday }) =>
      sql`
        SELECT
          project_path AS key,
          COALESCE(SUM(input_tokens), 0) AS "inputTokens",
          COALESCE(SUM(cached_input_tokens), 0) AS "cachedInputTokens",
          COALESCE(SUM(cache_write_tokens), 0) AS "cacheWriteTokens",
          COALESCE(SUM(output_tokens), 0) AS "outputTokens",
          COALESCE(SUM(reasoning_tokens), 0) AS "reasoningTokens",
          COALESCE(SUM(turns), 0) AS turns,
          COALESCE(SUM(sessions), 0) AS sessions,
          COALESCE(SUM(cost_usd), 0) AS "costUsd",
          MAX(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS "hasNullCost"
        FROM usage_daily_rollup
        WHERE (
          ${daysBeforeToday} IS NULL
          OR day >= date('now', 'localtime', '-' || ${daysBeforeToday} || ' days')
        )
        GROUP BY project_path
        ORDER BY (
          SUM(input_tokens) + SUM(cached_input_tokens) + SUM(cache_write_tokens)
          + SUM(output_tokens) + SUM(reasoning_tokens)
        ) DESC, project_path ASC
      `,
  });

  const listSessionBreakdown = SqlSchema.findAll({
    Request: RangeRequest,
    Result: UsageBreakdownRowDb,
    execute: ({ daysBeforeToday }) =>
      sql`
        SELECT
          CASE
            WHEN project_path = '' THEN git_branch
            WHEN git_branch = '' THEN project_path
            ELSE project_path || ' · ' || git_branch
          END AS key,
          COALESCE(SUM(input_tokens), 0) AS "inputTokens",
          COALESCE(SUM(cached_input_tokens), 0) AS "cachedInputTokens",
          COALESCE(SUM(cache_write_tokens), 0) AS "cacheWriteTokens",
          COALESCE(SUM(output_tokens), 0) AS "outputTokens",
          COALESCE(SUM(reasoning_tokens), 0) AS "reasoningTokens",
          COALESCE(SUM(turns), 0) AS turns,
          COALESCE(SUM(sessions), 0) AS sessions,
          COALESCE(SUM(cost_usd), 0) AS "costUsd",
          MAX(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS "hasNullCost"
        FROM usage_daily_rollup
        WHERE (
          ${daysBeforeToday} IS NULL
          OR day >= date('now', 'localtime', '-' || ${daysBeforeToday} || ' days')
        )
        GROUP BY project_path, git_branch
        ORDER BY (
          SUM(input_tokens) + SUM(cached_input_tokens) + SUM(cache_write_tokens)
          + SUM(output_tokens) + SUM(reasoning_tokens)
        ) DESC, project_path ASC, git_branch ASC
      `,
  });

  const clearRollups = SqlSchema.void({
    Request: Schema.Void,
    execute: () => sql`DELETE FROM usage_daily_rollup`,
  });
  const clearScanFiles = SqlSchema.void({
    Request: Schema.Void,
    execute: () => sql`DELETE FROM usage_scan_files`,
  });

  const upsertRollups: UsageLedgerRepositoryShape["upsertRollups"] = Effect.fn(
    "UsageLedgerRepository.upsertRollups",
  )(function* (rows) {
    yield* upsertUsageRollupRows(rows).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "UsageLedgerRepository.upsertRollups:query",
          "UsageLedgerRepository.upsertRollups:encodeRequest",
        ),
      ),
    );
  });

  const getScanFile: UsageLedgerRepositoryShape["getScanFile"] = Effect.fn(
    "UsageLedgerRepository.getScanFile",
  )(function* (path) {
    return yield* findScanFile({ path }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "UsageLedgerRepository.getScanFile:query",
          "UsageLedgerRepository.getScanFile:decodeRow",
        ),
      ),
    );
  });

  const upsertScanFile: UsageLedgerRepositoryShape["upsertScanFile"] = Effect.fn(
    "UsageLedgerRepository.upsertScanFile",
  )(function* (row) {
    yield* upsertScanFileRow(row).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "UsageLedgerRepository.upsertScanFile:query",
          "UsageLedgerRepository.upsertScanFile:encodeRequest",
        ),
      ),
    );
  });

  const commitScanFile: UsageLedgerRepositoryShape["commitScanFile"] = Effect.fn(
    "UsageLedgerRepository.commitScanFile",
  )(function* (rows, scanFile) {
    yield* sql
      .withTransaction(
        upsertUsageRollupRows(rows).pipe(Effect.flatMap(() => upsertScanFileRow(scanFile))),
      )
      .pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "UsageLedgerRepository.commitScanFile:query",
            "UsageLedgerRepository.commitScanFile:encodeRequest",
          ),
        ),
      );
  });

  const getOverview: UsageLedgerRepositoryShape["getOverview"] = Effect.fn(
    "UsageLedgerRepository.getOverview",
  )(function* (range) {
    const request = { daysBeforeToday: daysBeforeToday(range) };
    const [providers, daily, mix] = yield* Effect.all(
      [listProviderTotals(request), listDailyTotals(request), getTokenMix(request)],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "UsageLedgerRepository.getOverview:query",
          "UsageLedgerRepository.getOverview:decodeRows",
        ),
      ),
    );
    const { costUsd, hasNullCost, ...tokenMix } = mix;
    return UsageOverview.make({
      providers: providers.map(withBooleanFlag),
      daily: daily.map(withBooleanFlag),
      tokenMix,
      costUsd,
      hasNullCost: hasNullCost > 0,
    });
  });

  const getBreakdown: UsageLedgerRepositoryShape["getBreakdown"] = Effect.fn(
    "UsageLedgerRepository.getBreakdown",
  )(function* (by, range) {
    const request = { daysBeforeToday: daysBeforeToday(range) };
    const query =
      by === "model"
        ? listModelBreakdown
        : by === "project"
          ? listProjectBreakdown
          : listSessionBreakdown;
    const rows = yield* query(request).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "UsageLedgerRepository.getBreakdown:query",
          "UsageLedgerRepository.getBreakdown:decodeRows",
        ),
      ),
    );
    return rows.map(withBooleanFlag);
  });

  const clear: UsageLedgerRepositoryShape["clear"] = Effect.fn("UsageLedgerRepository.clear")(
    function* () {
      yield* sql
        .withTransaction(
          clearRollups(undefined).pipe(Effect.flatMap(() => clearScanFiles(undefined))),
        )
        .pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              "UsageLedgerRepository.clear:query",
              "UsageLedgerRepository.clear:encodeRequest",
            ),
          ),
        );
    },
  );

  return {
    upsertRollups,
    getScanFile,
    upsertScanFile,
    commitScanFile,
    getOverview,
    getBreakdown,
    clear,
  } satisfies UsageLedgerRepositoryShape;
});

export const UsageLedgerRepositoryLive = Layer.effect(
  UsageLedgerRepository,
  makeUsageLedgerRepository,
);
