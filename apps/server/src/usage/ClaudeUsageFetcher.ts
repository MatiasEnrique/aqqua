/**
 * ClaudeUsageFetcher - Complete Claude rate-limit windows via the OAuth usage endpoint.
 *
 * Claude's SDK stream only reports the window it is currently tracking (and
 * omits utilization on plain "allowed" events), so live events alone cannot
 * populate the weekly gauge. The claude.ai OAuth usage endpoint returns every
 * window with utilization percentages (0–100), which this service fetches on
 * startup and on a slow timer, publishing into {@link AccountRateLimits} where
 * per-kind merging combines it with live adapter events.
 *
 * @module ClaudeUsageFetcher
 */
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type AccountRateLimitWindow,
  type AccountRateLimitsSnapshot,
} from "@aqqua/contracts";
import { HostProcessPlatform } from "@aqqua/shared/hostProcess";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import { ProcessRunner } from "../processRunner.ts";
import { AccountRateLimits } from "./AccountRateLimits.ts";

const PROVIDER = ProviderDriverKind.make("claudeAgent");
const USAGE_ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA_HEADER = "oauth-2025-04-20";
const REFRESH_INTERVAL = "5 minutes";
const STARTUP_DELAY = "3 seconds";

const OauthWindowSchema = Schema.Struct({
  utilization: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  resets_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

// Model quotas moved to the structured `limits` array (scoped entries carry
// the model display name); the top-level window fields remain for older
// accounts. `is_active` marks the binding limit, not data validity.
const OauthScopedLimitSchema = Schema.Struct({
  kind: Schema.optionalKey(Schema.NullOr(Schema.String)),
  percent: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  resets_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
  scope: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        model: Schema.optionalKey(
          Schema.NullOr(
            Schema.Struct({
              display_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
            }),
          ),
        ),
      }),
    ),
  ),
});

const OauthUsageSchema = Schema.Struct({
  five_hour: Schema.optionalKey(Schema.NullOr(OauthWindowSchema)),
  seven_day: Schema.optionalKey(Schema.NullOr(OauthWindowSchema)),
  seven_day_opus: Schema.optionalKey(Schema.NullOr(OauthWindowSchema)),
  seven_day_sonnet: Schema.optionalKey(Schema.NullOr(OauthWindowSchema)),
  limits: Schema.optionalKey(Schema.NullOr(Schema.Array(OauthScopedLimitSchema))),
});

const decodeOauthUsage = Schema.decodeUnknownOption(OauthUsageSchema);

const CredentialsSchema = Schema.fromJsonString(
  Schema.Struct({
    claudeAiOauth: Schema.optionalKey(
      Schema.NullOr(
        Schema.Struct({
          accessToken: Schema.optionalKey(Schema.NullOr(Schema.String)),
        }),
      ),
    ),
  }),
);

const decodeCredentials = Schema.decodeUnknownOption(CredentialsSchema);

const WINDOW_KINDS = [
  { key: "five_hour", kind: "five-hour", windowMinutes: 300 },
  { key: "seven_day", kind: "weekly", windowMinutes: 10_080 },
  { key: "seven_day_opus", kind: "weekly-opus", windowMinutes: 10_080 },
  { key: "seven_day_sonnet", kind: "weekly-sonnet", windowMinutes: 10_080 },
] as const;

function epochSeconds(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? Math.round(parsed / 1_000) : null;
}

const MODEL_SCOPED_WINDOW_KINDS: Readonly<Record<string, AccountRateLimitWindow["kind"]>> = {
  fable: "weekly-fable",
  opus: "weekly-opus",
  sonnet: "weekly-sonnet",
};

export function normalizeClaudeOauthUsage(
  payload: unknown,
  context: {
    readonly providerInstanceId: ProviderInstanceId;
    readonly capturedAt: string;
  },
): AccountRateLimitsSnapshot | null {
  const decoded = Option.getOrNull(decodeOauthUsage(payload));
  if (decoded === null) return null;

  const windows: AccountRateLimitWindow[] = [];
  const pushWindow = (window: AccountRateLimitWindow) => {
    if (!windows.some((existing) => existing.kind === window.kind)) {
      windows.push(window);
    }
  };

  // Structured limits first: they carry model-scoped quotas (Fable's weekly
  // limit only exists here) and are the current shape.
  for (const limit of decoded.limits ?? []) {
    const percent = limit.percent ?? null;
    const resetsAt = epochSeconds(limit.resets_at);
    if (percent === null && resetsAt === null) continue;
    const modelName = limit.scope?.model?.display_name?.trim().toLowerCase() ?? null;
    const kind =
      limit.kind === "session" || limit.kind === "five_hour"
        ? ("five-hour" as const)
        : limit.kind === "weekly_all" || limit.kind === "weekly"
          ? ("weekly" as const)
          : limit.kind === "weekly_scoped" && modelName !== null
            ? (MODEL_SCOPED_WINDOW_KINDS[modelName] ?? null)
            : null;
    if (kind === null) continue;
    pushWindow({
      kind,
      usedPercent: percent,
      resetsAt,
      windowMinutes: kind === "five-hour" ? 300 : 10_080,
    });
  }

  // Legacy top-level fields fill anything the structured limits omitted.
  for (const definition of WINDOW_KINDS) {
    const window = decoded[definition.key];
    if (!window) continue;
    pushWindow({
      kind: definition.kind,
      // The endpoint reports utilization on a 0–100 scale (verified live).
      usedPercent: window.utilization ?? null,
      resetsAt: epochSeconds(window.resets_at),
      windowMinutes: definition.windowMinutes,
    });
  }
  if (windows.length === 0) return null;

  return {
    providerInstanceId: context.providerInstanceId,
    provider: PROVIDER,
    planLabel: null,
    credits: null,
    windows,
    status: null,
    capturedAt: context.capturedAt,
  };
}

export class ClaudeUsageFetcher extends Context.Service<
  ClaudeUsageFetcher,
  {
    /** Fetch once and publish; false when no credentials or the request failed. */
    readonly refresh: Effect.Effect<boolean>;
  }
>()("aqqua/usage/ClaudeUsageFetcher") {
  static layer(options?: { readonly runInBackground?: boolean }) {
    return Layer.effect(
      ClaudeUsageFetcher,
      Effect.gen(function* () {
        const accountRateLimits = yield* AccountRateLimits;
        const httpClient = yield* HttpClient.HttpClient;
        const processRunner = yield* ProcessRunner;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const platform = yield* HostProcessPlatform;

        const tokenFromKeychain = Effect.gen(function* () {
          if (platform !== "darwin") return null;
          const output = yield* processRunner
            .run({
              command: "security",
              args: ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
              timeout: "10 seconds",
            })
            .pipe(Effect.option);
          if (Option.isNone(output) || output.value.code !== 0) return null;
          return readAccessToken(output.value.stdout);
        });

        const tokenFromCredentialsFile = Effect.gen(function* () {
          const homeDirectory = process.env.HOME ?? process.env.USERPROFILE ?? "";
          if (homeDirectory.length === 0) return null;
          const credentialsPath = path.join(homeDirectory, ".claude", ".credentials.json");
          const content = yield* fileSystem.readFileString(credentialsPath).pipe(Effect.option);
          return Option.isNone(content) ? null : readAccessToken(content.value);
        });

        const refresh = Effect.gen(function* () {
          const token = (yield* tokenFromKeychain) ?? (yield* tokenFromCredentialsFile);
          if (token === null) {
            yield* Effect.logDebug("Claude usage fetch skipped: no OAuth credentials found");
            return false;
          }

          const response = yield* httpClient
            .execute(
              HttpClientRequest.get(USAGE_ENDPOINT).pipe(
                HttpClientRequest.setHeader("Authorization", `Bearer ${token}`),
                HttpClientRequest.setHeader("anthropic-beta", OAUTH_BETA_HEADER),
                HttpClientRequest.setHeader("Content-Type", "application/json"),
              ),
            )
            .pipe(
              Effect.flatMap((response) =>
                response.status === 200 ? response.json : Effect.succeed(null),
              ),
              Effect.option,
            );
          if (Option.isNone(response) || response.value === null) {
            yield* Effect.logDebug("Claude usage fetch failed or was rejected");
            return false;
          }

          const capturedAt = DateTime.formatIso(yield* DateTime.now);
          const snapshot = normalizeClaudeOauthUsage(response.value, {
            providerInstanceId: ProviderInstanceId.make("claudeAgent"),
            capturedAt,
          });
          if (snapshot === null) {
            yield* Effect.logDebug("Claude usage fetch returned no recognizable windows");
            return false;
          }

          yield* accountRateLimits.report(snapshot);
          return true;
        }).pipe(Effect.withSpan("ClaudeUsageFetcher.refresh"));

        if (options?.runInBackground !== false) {
          yield* refresh.pipe(
            Effect.delay(STARTUP_DELAY),
            Effect.andThen(refresh.pipe(Effect.schedule(Schedule.spaced(REFRESH_INTERVAL)))),
            Effect.forkScoped,
          );
        }

        return ClaudeUsageFetcher.of({ refresh });
      }),
    );
  }
}

function readAccessToken(content: string): string | null {
  const decoded = Option.getOrNull(decodeCredentials(content.trim()));
  const token = decoded?.claudeAiOauth?.accessToken ?? null;
  return token !== null && token.length > 0 ? token : null;
}
