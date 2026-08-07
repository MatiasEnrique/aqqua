// Phase-B environment for the captures that cannot run against live services:
//
//   pull-request — the PR panel shells out to the `gh` CLI; a real call would
//     need a real GitHub repo. A `gh` shim on the server's PATH answers every
//     subcommand aqqua uses with a fictional PR (#52, checks resolving).
//   usage — the heatmap needs `usage.scanEnabled`; the scanner reads
//     `$HOME/.claude` and `$HOME/.codex`. A fake HOME keeps the user's real
//     CLI logs (real repo paths!) out of the isolated database, and a fake
//     Codex rollout cold-seeds the Codex rate-limit gauge.
//   resume-cli — the /resume picker lists Claude CLI sessions from
//     `$HOME/.claude/projects`; fake HOME + fictional session transcripts
//     keep the user's real conversations out of frame.
//   (bonus) a `scutil` shim renames the environment label so the machine's
//     real ComputerName never appears in a capture.
//
// Usage:  node scripts/marketing-capture/setup-phase-b.mjs --base-dir <dir>
//
// Then RESTART the dev server with the shims and fake HOME (see README):
//   HOME=<base>/fake-home PATH=<base>/shims:$PATH pnpm exec vp run dev --home-dir <base>
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

const baseDirFlagIndex = process.argv.indexOf("--base-dir");
const baseDir = baseDirFlagIndex === -1 ? null : process.argv[baseDirFlagIndex + 1];
if (!baseDir) {
  console.error(
    "Usage: node scripts/marketing-capture/setup-phase-b.mjs --base-dir <isolated-base-dir>",
  );
  process.exit(1);
}
// Match the canonical workspace paths written by seed.ts. This matters for
// Claude's cwd-keyed session store on macOS, where /tmp is /private/tmp.
const BASE = await fs.realpath(path.resolve(baseDir));
const sharedHomePath = path.join(os.homedir(), ".aqqua");
const sharedHome = await fs.realpath(sharedHomePath).catch(() => path.resolve(sharedHomePath));
if (BASE === sharedHome || BASE.startsWith(sharedHome + path.sep)) {
  console.error(`Refusing to touch the shared ${sharedHome} directory.`);
  process.exit(1);
}

const SHIMS = path.join(BASE, "shims");
const FAKE_HOME = path.join(BASE, "fake-home");
const REPO_ROOT = path.join(BASE, "workspace", "acme-api");

// ── gh shim ────────────────────────────────────────────────────
// Answers exactly the calls apps/server/src/sourceControl/GitHubCli.ts makes.
// The PR is entirely fictional. Checks: three done, one running, one queued —
// the "resolving" state the pull-request capture wants on screen.

const GH_SHIM = `#!/usr/bin/env node
// Fake gh CLI for the aqqua marketing capture environment. Serves a fictional
// pull request for the acme-api demo repo; never touches the network.
const args = process.argv.slice(2);
const now = Date.now();
const iso = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();

// Every invocation is appended next to the shim — handy when aqqua grows a
// new gh call this shim does not answer yet.
try {
  require("node:fs").appendFileSync(__dirname + "/gh-calls.log", args.join(" ") + "\\n");
} catch {}

if (args[0] === "--version" || args[0] === "version") {
  process.stdout.write("gh version 2.62.0 (2026-01-15)\\nhttps://github.com/cli/cli/releases/tag/v2.62.0\\n");
  process.exit(0);
}

const PR = {
  number: 52,
  title: "Add webhook delivery retries",
  url: "https://github.com/acme-dev/acme-api/pull/52",
  baseRefName: "main",
  headRefName: "feat/webhook-retries",
  state: "OPEN",
  mergedAt: null,
  mergeable: "MERGEABLE",
  isCrossRepository: false,
  isDraft: false,
  headRepository: { name: "acme-api" },
  headRepositoryOwner: { login: "acme-dev" },
  updatedAt: iso(4),
  createdAt: iso(190),
  body: "Webhook deliveries fired once and gave up. This adds a delivery queue, exponential backoff with jitter, and a dead-letter queue after the final attempt.\\n\\n- 500ms base delay, 60s cap\\n- \`X-Acme-Attempt\` header on every retry\\n- integration tests for the give-up path",
  author: { login: "jordan-vale", name: "Jordan Vale" },
  additions: 214,
  deletions: 38,
  comments: [
    {
      id: "C_kwDO52A",
      author: { login: "sam-oak" },
      authorAssociation: "MEMBER",
      body: "Backoff table matches the docs now — nice. One question: should the dead-letter queue emit a webhook of its own?",
      createdAt: iso(95),
      includesCreatedEdit: false,
      isMinimized: false,
      minimizedReason: "",
      reactionGroups: [],
      url: "https://github.com/acme-dev/acme-api/pull/52#issuecomment-1",
      viewerDidAuthor: false,
    },
  ],
  reviewRequests: [{ login: "sam-oak" }],
  autoMergeRequest: null,
  statusCheckRollup: [
    { name: "build", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://github.com/acme-dev/acme-api/actions/runs/9001" },
    { name: "lint", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://github.com/acme-dev/acme-api/actions/runs/9002" },
    { name: "typecheck", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://github.com/acme-dev/acme-api/actions/runs/9003" },
    { name: "integration-tests", status: "IN_PROGRESS", conclusion: "", detailsUrl: "https://github.com/acme-dev/acme-api/actions/runs/9004" },
    { name: "deploy-preview", status: "QUEUED", conclusion: "", detailsUrl: "https://github.com/acme-dev/acme-api/actions/runs/9005" },
  ],
  commits: [
    {
      oid: "7b62d40aa11",
      messageHeadline: "Add webhook delivery queue",
      messageBody: "",
      authoredDate: iso(180),
      committedDate: iso(180),
      authors: [{ login: "jordan-vale", name: "Jordan Vale", email: "jordan@acme.test" }],
    },
    {
      oid: "8df4f53bb22",
      messageHeadline: "Retry deliveries with exponential backoff",
      messageBody: "",
      authoredDate: iso(60),
      committedDate: iso(60),
      authors: [{ login: "jordan-vale", name: "Jordan Vale", email: "jordan@acme.test" }],
    },
  ],
};

const OTHER_PR = {
  number: 49,
  title: "Document the retry contract",
  url: "https://github.com/acme-dev/acme-api/pull/49",
  baseRefName: "main",
  headRefName: "docs/retry-contract",
  state: "OPEN",
  mergedAt: null,
  mergeable: "MERGEABLE",
  updatedAt: iso(300),
};

function pick(record, fields) {
  const out = {};
  for (const field of fields) if (field in record) out[field] = record[field];
  return out;
}

function flagValue(name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
}

function emit(value) {
  process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));
  process.exit(0);
}

if (args[0] === "auth") {
  emit({ hosts: { "github.com": [{ state: "success", active: true, host: "github.com", login: "acme-bot" }] } });
}

if (args[0] === "api") {
  // Conversation review threads query — the demo PR has none.
  emit({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } } });
}

if (args[0] === "repo" && args[1] === "view") {
  if (args.includes("--jq")) emit("main\\n");
  const fields = (flagValue("--json") ?? "").split(",");
  emit(pick({
    nameWithOwner: "acme-dev/acme-api",
    url: "https://github.com/acme-dev/acme-api",
    sshUrl: "git@github.com:acme-dev/acme-api.git",
    defaultBranchRef: { name: "main" },
    mergeCommitAllowed: true,
    squashMergeAllowed: true,
    rebaseMergeAllowed: false,
    viewerDefaultMergeMethod: "SQUASH",
  }, fields));
}

if (args[0] === "pr" && args[1] === "list") {
  const fields = (flagValue("--json") ?? "").split(",");
  const head = flagValue("--head");
  if (head !== null) {
    emit(head.includes("feat/webhook-retries") ? [pick(PR, fields)] : []);
  }
  emit([pick(PR, fields), pick(OTHER_PR, fields)]);
}

if (args[0] === "pr" && args[1] === "view") {
  const fields = (flagValue("--json") ?? "").split(",");
  emit(pick(PR, fields));
}

if (args[0] === "pr") {
  // merge / close / reopen / ready / etc. — accept silently.
  emit("");
}

process.stderr.write("gh shim: unhandled command: " + args.join(" ") + "\\n");
process.exit(1);
`;

// ── scutil shim ────────────────────────────────────────────────
const SCUTIL_SHIM = `#!/bin/sh
# Fake scutil: gives the capture environment a fictional machine name so the
# real ComputerName never lands in a marketing asset.
if [ "$1" = "--get" ]; then
  echo "Acme Studio"
  exit 0
fi
exit 0
`;

// ── Fictional Claude CLI sessions (for /resume) ────────────────

function claudeProjectDirectoryName(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

function claudeSessionLines(sessionId, minutesAgo, gitBranch, request, reply) {
  const at = (offsetMinutes) =>
    new Date(Date.now() - (minutesAgo - offsetMinutes) * 60_000).toISOString();
  const common = {
    sessionId,
    cwd: REPO_ROOT,
    gitBranch,
    entrypoint: "cli",
    isSidechain: false,
    version: "2.1.0",
  };
  return (
    [
      {
        ...common,
        type: "user",
        uuid: randomUUID(),
        timestamp: at(0),
        message: { role: "user", content: request },
      },
      {
        ...common,
        type: "assistant",
        uuid: randomUUID(),
        timestamp: at(2),
        message: { role: "assistant", content: [{ type: "text", text: reply }] },
      },
      {
        ...common,
        type: "user",
        uuid: randomUUID(),
        timestamp: at(4),
        message: { role: "user", content: "Looks good — keep the changes small." },
      },
      {
        ...common,
        type: "assistant",
        uuid: randomUUID(),
        timestamp: at(6),
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Done. Two focused commits, tests pass." }],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n") + "\n"
  );
}

const CLAUDE_SESSIONS = [
  {
    minutesAgo: 70,
    gitBranch: "main",
    request: "Profile the orders endpoint — p95 crept past 400ms this week.",
    reply: "The N+1 on customer lookups was the culprit. Batched it; p95 is back to 120ms locally.",
  },
  {
    minutesAgo: 60 * 26,
    gitBranch: "main",
    request: "Sketch a pagination strategy for the orders list. Cursor or offset?",
    reply:
      "Cursor pagination keyed on (created_at, id) — stable under inserts and plays well with the CSV export cap.",
  },
  {
    minutesAgo: 60 * 49,
    gitBranch: "fix/timezone-drift",
    request: "Why do the EU and US replicas disagree about yesterday's report totals?",
    reply:
      "They key reports by local server day. Moving the key to UTC day fixes the drift; drafting the patch now.",
  },
];

// ── Fictional Codex rollout (cold-seeds the Codex gauge) ───────

function codexRolloutLines() {
  const sessionId = randomUUID();
  const nowMs = Date.now();
  const at = (minutesAgo) => new Date(nowMs - minutesAgo * 60_000).toISOString();
  const usage = {
    input_tokens: 184_320,
    cached_input_tokens: 512_760,
    cache_write_input_tokens: 21_040,
    output_tokens: 15_780,
    reasoning_output_tokens: 6_120,
  };
  return (
    [
      {
        type: "session_meta",
        timestamp: at(50),
        payload: { session_id: sessionId, cwd: REPO_ROOT, originator: "codex_cli_rs" },
      },
      { type: "turn_context", timestamp: at(49), payload: { model: "gpt-5.6-sol" } },
      {
        type: "event_msg",
        timestamp: at(45),
        payload: {
          type: "token_count",
          info: { total_token_usage: usage },
          rate_limits: {
            primary: {
              used_percent: 38,
              window_minutes: 300,
              resets_at: Math.floor(nowMs / 1000) + 2.5 * 3600,
            },
            secondary: {
              used_percent: 61,
              window_minutes: 10_080,
              resets_at: Math.floor(nowMs / 1000) + 4 * 24 * 3600,
            },
            plan_type: "Pro",
          },
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n") + "\n"
  );
}

// ── Write everything ───────────────────────────────────────────

// Keep reruns deterministic: this directory belongs exclusively to the
// disposable capture base validated above, and contains only fixtures created
// by this script.
await fs.rm(SHIMS, { recursive: true, force: true });
await fs.rm(FAKE_HOME, { recursive: true, force: true });
await fs.mkdir(SHIMS, { recursive: true });
await fs.writeFile(path.join(SHIMS, "gh"), GH_SHIM, { mode: 0o755 });
await fs.writeFile(path.join(SHIMS, "scutil"), SCUTIL_SHIM, { mode: 0o755 });

// aqqua resolves CLI executables against a LOGIN-shell PATH capture
// (packages/shared/src/shell.ts), not the server process env — so the fake
// HOME's shell profile must prepend the shims, or the real gh/scutil win.
await fs.mkdir(FAKE_HOME, { recursive: true });
const profileLine = `export PATH="${SHIMS}:$PATH"\n`;
await fs.writeFile(path.join(FAKE_HOME, ".zprofile"), profileLine);
await fs.writeFile(path.join(FAKE_HOME, ".zshenv"), profileLine);
await fs.writeFile(path.join(FAKE_HOME, ".bash_profile"), profileLine);

const claudeProjectDir = path.join(
  FAKE_HOME,
  ".claude",
  "projects",
  claudeProjectDirectoryName(REPO_ROOT),
);
await fs.mkdir(claudeProjectDir, { recursive: true });
for (const session of CLAUDE_SESSIONS) {
  const sessionId = randomUUID();
  await fs.writeFile(
    path.join(claudeProjectDir, `${sessionId}.jsonl`),
    claudeSessionLines(
      sessionId,
      session.minutesAgo,
      session.gitBranch,
      session.request,
      session.reply,
    ),
  );
}

const day = new Date();
const codexSessionsDir = path.join(
  FAKE_HOME,
  ".codex",
  "sessions",
  String(day.getFullYear()),
  String(day.getMonth() + 1).padStart(2, "0"),
  String(day.getDate()).padStart(2, "0"),
);
await fs.mkdir(codexSessionsDir, { recursive: true });
await fs.writeFile(
  path.join(codexSessionsDir, `rollout-${randomUUID()}.jsonl`),
  codexRolloutLines(),
);

// Enable historical usage scanning so the heatmap renders. Merge-preserve any
// existing settings.
const settingsPath = path.join(BASE, "userdata", "settings.json");
let settings = {};
try {
  settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
} catch {
  // No settings yet.
}
settings.usage = { ...(settings.usage ?? {}), scanEnabled: true };
await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");

console.log(`Shims:      ${SHIMS}`);
console.log(`Fake HOME:  ${FAKE_HOME}`);
console.log(`Settings:   ${settingsPath} (usage.scanEnabled=true)`);
console.log("");
console.log("Restart the dev server for phase B:");
console.log(`  HOME=${FAKE_HOME} PATH=${SHIMS}:$PATH pnpm exec vp run dev --home-dir ${BASE}`);
