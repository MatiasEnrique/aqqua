// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off - Host-side capture fixture creates isolated repositories outside the server runtime.
// Marketing demo seeder for an ISOLATED aqqua base dir.
//
// `--repos-only` creates new throwaway Git repositories and stops. This is the
// shipping-capture path: projects, threads, worktrees, agents, and flows are
// then created through real Aqqua commands.
//
// Without `--repos-only`, the script also seeds projection tables in
// `<base-dir>/userdata/state.sqlite` for capture-choreography development:
//
//   - one project (`acme-api`) on the throwaway repo
//   - three worktree threads: one running, one needing input, one merged+settled
//   - an orchestrator conversation with three sub-agents on DIFFERENT providers
//   - a flow (board) whose steps each pin an exact instanceId + model + reasoning
//   - a card mid-flow with per-step threads
//   - three queued messages on the running turn
//   - 42+ days of usage rollup rows for the heatmap
//
// Usage:  node scripts/marketing-capture/seed.ts --base-dir /tmp/aqqua-capture.XXXXXX [--repos-only]
//
// Safety: refuses to touch ~/.aqqua. Stop the dev server before running if you
// want a guaranteed-quiet write, though the busy timeout makes concurrent
// seeding reliable in practice (same approach as scripts/mobile-showcase-environment.ts).
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeUtil from "node:util";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

// ── CLI ────────────────────────────────────────────────────────

const baseDirFlagIndex = process.argv.indexOf("--base-dir");
const baseDir = baseDirFlagIndex === -1 ? null : process.argv[baseDirFlagIndex + 1];
const reposOnly = process.argv.includes("--repos-only");
if (!baseDir) {
  console.error("Usage: node scripts/marketing-capture/seed.ts --base-dir <isolated-base-dir>");
  process.exit(1);
}
// macOS exposes /tmp through the /private/tmp symlink. Persist canonical
// workspace paths so the server's authorization realpath and provider session
// indexes address the same directory.
const resolvedBase = await NodeFSP.realpath(NodePath.resolve(baseDir));
const sharedHomePath = NodePath.join(NodeOS.homedir(), ".aqqua");
const sharedHome = await NodeFSP.realpath(sharedHomePath).catch(() =>
  NodePath.resolve(sharedHomePath),
);
if (resolvedBase === sharedHome || resolvedBase.startsWith(sharedHome + NodePath.sep)) {
  console.error(`Refusing to seed the shared ${sharedHome} directory.`);
  process.exit(1);
}

const DB_PATH = NodePath.join(resolvedBase, "userdata", "state.sqlite");
const WORKSPACE = NodePath.join(resolvedBase, "workspace");
const REPO_ROOT = NodePath.join(WORKSPACE, "acme-api");
const WORKTREES = NodePath.join(WORKSPACE, "worktrees");

// ── Fictional cast ─────────────────────────────────────────────
// Every identity below is invented. Providers/instances mirror what a locally
// installed toolchain advertises so the UI resolves real icons and labels.

const PROJECT_ID = "acme-api";
const WEB_PROJECT_ID = "acme-web";
// `providerName` must be the branded driver kind (see `deriveLockedProvider`
// in apps/web/src/components/ChatView.logic.ts) — display names break the
// composer's provider lock.
const CLAUDE = { instanceId: "claudeAgent", providerName: "claudeAgent" };
const CODEX = { instanceId: "codex", providerName: "codex" };
const GROK = { instanceId: "grok", providerName: "grok" };
const OPENCODE = { instanceId: "opencode", providerName: "opencode" };

const DEFAULT_SELECTION = JSON.stringify({
  instanceId: CLAUDE.instanceId,
  model: "claude-fable-5",
});

const PROJECT_SCRIPTS = JSON.stringify([
  { id: "dev", name: "Dev", command: "pnpm dev", icon: "play", runOnWorktreeCreate: false },
  { id: "test", name: "Tests", command: "pnpm test", icon: "test", runOnWorktreeCreate: false },
]);

function minutesBefore(now: number, minutes: number): string {
  return new Date(now - minutes * 60_000).toISOString();
}

// ── Throwaway git repository ───────────────────────────────────

async function runGit(
  cwd: string,
  args: ReadonlyArray<string>,
  dateMinutesAgo?: number,
): Promise<void> {
  const when =
    dateMinutesAgo === undefined
      ? undefined
      : new Date(Date.now() - dateMinutesAgo * 60_000).toISOString();
  await execFile("git", [...args], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Jordan Vale",
      GIT_AUTHOR_EMAIL: "jordan@acme.test",
      GIT_COMMITTER_NAME: "Jordan Vale",
      GIT_COMMITTER_EMAIL: "jordan@acme.test",
      ...(when ? { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } : {}),
    },
  });
}

async function writeRepoFile(relPath: string, content: string): Promise<void> {
  const abs = NodePath.join(REPO_ROOT, relPath);
  await NodeFSP.mkdir(NodePath.dirname(abs), { recursive: true });
  await NodeFSP.writeFile(abs, content);
}

async function commit(message: string, minutesAgo: number): Promise<void> {
  await runGit(REPO_ROOT, ["add", "."], minutesAgo);
  await runGit(REPO_ROOT, ["commit", "-m", message], minutesAgo);
}

async function buildRepository(): Promise<void> {
  await NodeFSP.rm(REPO_ROOT, { recursive: true, force: true });
  await NodeFSP.rm(WORKTREES, { recursive: true, force: true });
  await NodeFSP.mkdir(REPO_ROOT, { recursive: true });
  await runGit(REPO_ROOT, ["init", "-b", "main"]);
  await runGit(REPO_ROOT, ["remote", "add", "origin", "https://github.com/acme-dev/acme-api.git"]);

  await writeRepoFile(
    "package.json",
    JSON.stringify(
      {
        name: "acme-api",
        version: "0.4.2",
        private: true,
        scripts: { dev: "tsx src/server.ts", test: "vitest" },
      },
      null,
      2,
    ) + "\n",
  );
  await writeRepoFile(
    "src/server.ts",
    `import { createRouter } from "./router.ts";\n\nconst router = createRouter();\nrouter.listen(Number(process.env.PORT ?? 4100));\n`,
  );
  await writeRepoFile(
    "src/router.ts",
    `export function createRouter() {\n  return {\n    listen(port: number) {\n      console.log(\`acme-api listening on :\${port}\`);\n    },\n  };\n}\n`,
  );
  await writeRepoFile("README.md", "# acme-api\n\nOrder and billing API for Acme Outfitters.\n");
  await commit("Scaffold acme-api service", 60 * 24 * 30);

  await writeRepoFile(
    "src/routes/health.ts",
    `export function health() {\n  return { ok: true, uptimeMs: process.uptime() * 1000 };\n}\n`,
  );
  await commit("Add health and status endpoints", 60 * 24 * 27);

  await writeRepoFile(
    "src/routes/customers.ts",
    `export interface Customer {\n  id: string;\n  name: string;\n  tier: "free" | "pro";\n}\n\nexport function listCustomers(): Customer[] {\n  return [];\n}\n`,
  );
  await commit("Add customer resource", 60 * 24 * 24);

  await writeRepoFile(
    "src/routes/orders.ts",
    `export interface Order {\n  id: string;\n  customerId: string;\n  totalCents: number;\n}\n\nexport function listOrders(): Order[] {\n  return [];\n}\n`,
  );
  await commit("Add order resource", 60 * 24 * 20);

  // Merged feature branch → visible lanes + merge commit in the graph.
  await runGit(REPO_ROOT, ["checkout", "-b", "feat/rate-limiting"], 60 * 24 * 18);
  await writeRepoFile(
    "src/middleware/rateLimit.ts",
    `const buckets = new Map<string, { tokens: number; refilledAt: number }>();\n\nexport function allow(key: string, limit = 60): boolean {\n  const bucket = buckets.get(key) ?? { tokens: limit, refilledAt: Date.now() };\n  bucket.tokens -= 1;\n  buckets.set(key, bucket);\n  return bucket.tokens >= 0;\n}\n`,
  );
  await commit("Add token bucket rate limiter", 60 * 24 * 18);
  await writeRepoFile("src/middleware/index.ts", `export { allow } from "./rateLimit.ts";\n`);
  await commit("Wire limiter into the router", 60 * 24 * 17);

  await runGit(REPO_ROOT, ["checkout", "main"], 60 * 24 * 16);
  await writeRepoFile(
    "src/middleware/logging.ts",
    `export function logRequest(method: string, path: string): void {\n  console.log(\`\${new Date().toISOString()} \${method} \${path}\`);\n}\n`,
  );
  await commit("Add structured request logging", 60 * 24 * 16);
  await runGit(
    REPO_ROOT,
    ["merge", "--no-ff", "feat/rate-limiting", "-m", "Merge feat/rate-limiting"],
    60 * 24 * 15,
  );

  // A fix branch that "went out via PR" and merged.
  await runGit(REPO_ROOT, ["checkout", "-b", "fix/timezone-drift"], 60 * 24 * 6);
  await writeRepoFile(
    "src/reports/dailyReport.ts",
    `export function reportDay(now: Date): string {\n  // Reports are keyed by UTC day so replicas in different zones agree.\n  return now.toISOString().slice(0, 10);\n}\n`,
  );
  await commit("Normalize report timestamps to UTC", 60 * 24 * 6);
  await runGit(REPO_ROOT, ["checkout", "main"], 60 * 24 * 5);
  await runGit(
    REPO_ROOT,
    [
      "merge",
      "--no-ff",
      "fix/timezone-drift",
      "-m",
      "Merge pull request #41 from acme-dev/fix/timezone-drift",
    ],
    60 * 24 * 5,
  );

  await writeRepoFile("src/version.ts", `export const VERSION = "0.4.2";\n`);
  await commit("Cut 0.4.2 and tighten tsconfig", 60 * 24 * 2);

  // Active branches, each checked out as a linked worktree like aqqua does.
  await NodeFSP.mkdir(WORKTREES, { recursive: true });
  await runGit(REPO_ROOT, ["branch", "feat/webhook-retries", "main"]);
  await runGit(REPO_ROOT, [
    "worktree",
    "add",
    NodePath.join(WORKTREES, "webhook-retries"),
    "feat/webhook-retries",
  ]);
  const webhookWt = NodePath.join(WORKTREES, "webhook-retries");
  await NodeFSP.mkdir(NodePath.join(webhookWt, "src/webhooks"), { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(webhookWt, "src/webhooks/deliveryQueue.ts"),
    `export interface Delivery {\n  id: string;\n  attempt: number;\n  nextAttemptAt: number;\n}\n\nexport const queue: Delivery[] = [];\n`,
  );
  await runGit(webhookWt, ["add", "."], 60 * 3);
  await runGit(webhookWt, ["commit", "-m", "Add webhook delivery queue"], 60 * 3);
  await NodeFSP.writeFile(
    NodePath.join(webhookWt, "src/webhooks/retry.ts"),
    `export function backoffMs(attempt: number): number {\n  return Math.min(60_000, 2 ** attempt * 500);\n}\n`,
  );
  await runGit(webhookWt, ["add", "."], 60 * 1);
  await runGit(webhookWt, ["commit", "-m", "Retry deliveries with exponential backoff"], 60 * 1);

  await runGit(REPO_ROOT, ["branch", "feat/billing-portal", "main"]);
  await runGit(REPO_ROOT, [
    "worktree",
    "add",
    NodePath.join(WORKTREES, "billing-portal"),
    "feat/billing-portal",
  ]);
  const billingWt = NodePath.join(WORKTREES, "billing-portal");
  await NodeFSP.mkdir(NodePath.join(billingWt, "src/billing"), { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(billingWt, "src/billing/portal.ts"),
    `export function portalUrl(customerId: string): string {\n  return \`/billing/\${customerId}\`;\n}\n`,
  );
  await runGit(billingWt, ["add", "."], 60 * 7);
  await runGit(billingWt, ["commit", "-m", "Sketch billing portal endpoints"], 60 * 7);

  await runGit(REPO_ROOT, ["branch", "feat/csv-export", "main"]);
  await runGit(REPO_ROOT, [
    "worktree",
    "add",
    NodePath.join(WORKTREES, "csv-export"),
    "feat/csv-export",
  ]);
}

// Second project so the project-scope control has something to narrow.
const WEB_REPO_ROOT = NodePath.join(WORKSPACE, "acme-web");

async function buildWebRepository(): Promise<void> {
  await NodeFSP.rm(WEB_REPO_ROOT, { recursive: true, force: true });
  await NodeFSP.mkdir(WEB_REPO_ROOT, { recursive: true });
  await runGit(WEB_REPO_ROOT, ["init", "-b", "main"]);
  await runGit(WEB_REPO_ROOT, [
    "remote",
    "add",
    "origin",
    "https://github.com/acme-dev/acme-web.git",
  ]);
  await NodeFSP.writeFile(
    NodePath.join(WEB_REPO_ROOT, "package.json"),
    JSON.stringify({ name: "acme-web", private: true, scripts: { dev: "astro dev" } }, null, 2) +
      "\n",
  );
  await NodeFSP.writeFile(
    NodePath.join(WEB_REPO_ROOT, "README.md"),
    "# acme-web\n\nStorefront for Acme Outfitters.\n",
  );
  await runGit(WEB_REPO_ROOT, ["add", "."], 60 * 24 * 21);
  await runGit(WEB_REPO_ROOT, ["commit", "-m", "Scaffold storefront"], 60 * 24 * 21);
  await runGit(WEB_REPO_ROOT, ["branch", "feat/nav-refresh", "main"]);
  await runGit(WEB_REPO_ROOT, [
    "worktree",
    "add",
    NodePath.join(WORKTREES, "nav-refresh"),
    "feat/nav-refresh",
  ]);
}

// ── Database fixtures ──────────────────────────────────────────

interface ThreadSeed {
  readonly id: string;
  readonly projectId?: string;
  readonly title: string;
  readonly branch: string | null;
  readonly worktree: string | null;
  readonly minutesAgo: number;
  readonly selection: { instanceId: string; model: string };
  readonly providerName: string;
  readonly running?: boolean;
  readonly needsInput?: boolean;
  readonly settled?: boolean;
  readonly changeRequestNumber?: number;
  readonly parentThreadId?: string;
  readonly request: string;
  readonly response: string | null;
}

const THREADS: ReadonlyArray<ThreadSeed> = [
  {
    id: "th-webhook",
    title: "Add webhook delivery retries",
    branch: "feat/webhook-retries",
    worktree: NodePath.join(WORKTREES, "webhook-retries"),
    minutesAgo: 2,
    selection: { instanceId: CLAUDE.instanceId, model: "claude-fable-5" },
    providerName: CLAUDE.providerName,
    running: true,
    request:
      "Webhook deliveries currently fire once and give up. Add a delivery queue with exponential backoff, integration tests for the retry path, and updated API docs. Split the work across sub-agents so it lands today.",
    response: null,
  },
  {
    id: "th-webhook-impl",
    title: "Implement retry backoff",
    branch: "feat/webhook-retries",
    worktree: NodePath.join(WORKTREES, "webhook-retries"),
    minutesAgo: 4,
    selection: { instanceId: CODEX.instanceId, model: "gpt-5.6-sol" },
    providerName: CODEX.providerName,
    running: true,
    parentThreadId: "th-webhook",
    request: "Implement the delivery queue and exponential backoff in src/webhooks.",
    response: null,
  },
  {
    id: "th-webhook-tests",
    title: "Integration tests for retries",
    branch: "feat/webhook-retries",
    worktree: NodePath.join(WORKTREES, "webhook-retries"),
    minutesAgo: 6,
    selection: { instanceId: GROK.instanceId, model: "grok-4.5" },
    providerName: GROK.providerName,
    running: true,
    parentThreadId: "th-webhook",
    request: "Write integration tests covering give-up, jitter and dead-letter behaviour.",
    response: null,
  },
  {
    id: "th-webhook-docs",
    title: "Document the retry contract",
    branch: "feat/webhook-retries",
    worktree: NodePath.join(WORKTREES, "webhook-retries"),
    minutesAgo: 9,
    selection: { instanceId: OPENCODE.instanceId, model: "openai/gpt-5.4" },
    providerName: OPENCODE.providerName,
    parentThreadId: "th-webhook",
    request: "Update the webhook API docs with the retry schedule and failure semantics.",
    response:
      "Docs updated. The retry table now lists the full backoff schedule (500ms → 60s cap), the `X-Acme-Attempt` header, and the dead-letter behaviour after eight attempts.",
  },
  {
    id: "th-billing",
    title: "Billing portal endpoints",
    branch: "feat/billing-portal",
    worktree: NodePath.join(WORKTREES, "billing-portal"),
    minutesAgo: 34,
    selection: { instanceId: CODEX.instanceId, model: "gpt-5.6-sol" },
    providerName: CODEX.providerName,
    needsInput: true,
    request:
      "Add self-serve billing portal endpoints: session creation, plan switch, invoice list.",
    response:
      "Two portal designs are possible: hosted sessions (fastest, vendor-locked) or native endpoints (more work, full control). I need a decision before wiring the plan-switch flow — which direction should Acme take?",
  },
  {
    id: "th-web-nav",
    projectId: WEB_PROJECT_ID,
    title: "Refresh the storefront nav",
    branch: "feat/nav-refresh",
    worktree: NodePath.join(WORKTREES, "nav-refresh"),
    minutesAgo: 18,
    selection: { instanceId: CODEX.instanceId, model: "gpt-5.6-terra" },
    providerName: CODEX.providerName,
    running: true,
    request: "Rebuild the storefront navigation with the new category tree and mobile drawer.",
    response: null,
  },
  {
    id: "th-tz",
    title: "Fix timezone drift in reports",
    branch: "fix/timezone-drift",
    worktree: null,
    minutesAgo: 60 * 24 * 5,
    selection: { instanceId: CLAUDE.instanceId, model: "claude-opus-5" },
    providerName: CLAUDE.providerName,
    settled: true,
    changeRequestNumber: 41,
    request: "Daily reports disagree between the EU and US replicas. Find and fix the drift.",
    response:
      "The replicas keyed reports by local server day. Reports are now keyed by UTC day everywhere, with a regression test that runs the report boundary in three zones. PR #41 is merged.",
  },
];

interface QueuedSeed {
  readonly id: string;
  readonly text: string;
  readonly minutesAgo: number;
  readonly sequence: number;
}

const QUEUED: ReadonlyArray<QueuedSeed> = [
  {
    id: "qm-dead-letter",
    text: "Also add a dead-letter queue after the final attempt fails.",
    minutesAgo: 12,
    sequence: 1,
  },
  {
    id: "qm-retry-cap",
    text: "Bump the retry cap to 8 attempts and add jitter.",
    minutesAgo: 9,
    sequence: 2,
  },
  {
    id: "qm-load-test",
    text: "When the tests pass, run the load test against staging.",
    minutesAgo: 5,
    sequence: 3,
  },
];

// Flow steps pin an exact instanceId + model + reasoning (BoardStepAgent).
// The deprecated `profileName` selector is deliberately absent.
const BOARD_STEPS = [
  {
    id: "step-plan",
    name: "Plan",
    promptTemplate:
      "Study the request below and produce an implementation plan for acme-api. Write the plan as your artifact for the next step.\n\n{{request}}",
    agent: { instanceId: CLAUDE.instanceId, model: "claude-opus-5", reasoning: "high" },
    continuation: "auto",
  },
  {
    id: "step-implement",
    name: "Implement",
    promptTemplate:
      "Implement the plan from the previous step's artifact. Keep commits small and run the tests before finishing.",
    agent: { instanceId: CLAUDE.instanceId, model: "claude-fable-5", reasoning: "high" },
    continuation: "auto",
  },
  {
    id: "step-review",
    name: "Review",
    promptTemplate:
      "Review the implementation against the plan artifact. File follow-ups for anything you would not ship.",
    agent: { instanceId: GROK.instanceId, model: "grok-4.5", reasoning: "medium" },
    continuation: "manual",
  },
] as const;

function seedDatabase(now: number): void {
  // Busy timeout: the dev server keeps the write lock warm while running.
  const database = new NodeSqlite.DatabaseSync(DB_PATH, { timeout: 30_000 });
  try {
    database.exec("BEGIN IMMEDIATE");
    for (const table of [
      "projection_pending_approvals",
      "projection_thread_proposed_plans",
      "projection_thread_activities",
      "projection_thread_messages",
      "projection_thread_sessions",
      "projection_turns",
      "projection_queued_messages",
      "projection_threads",
      "projection_cards",
      "projection_boards",
      "projection_projects",
      "usage_daily_rollup",
      "provider_session_runtime",
    ]) {
      database.exec(`DELETE FROM ${table}`);
    }

    const insertProject = database.prepare(
      `INSERT INTO projection_projects (
        project_id, title, workspace_root, default_model_selection_json, scripts_json,
        icon_json, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
    );
    insertProject.run(
      PROJECT_ID,
      "acme-api",
      REPO_ROOT,
      DEFAULT_SELECTION,
      PROJECT_SCRIPTS,
      minutesBefore(now, 60 * 24 * 40),
      minutesBefore(now, 2),
    );
    insertProject.run(
      WEB_PROJECT_ID,
      "acme-web",
      WEB_REPO_ROOT,
      DEFAULT_SELECTION,
      PROJECT_SCRIPTS,
      minutesBefore(now, 60 * 24 * 33),
      minutesBefore(now, 18),
    );

    const insertThread = database.prepare(
      `INSERT INTO projection_threads (
        thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
        branch, worktree_path, latest_turn_id, latest_user_message_at, pending_approval_count,
        pending_user_input_count, has_actionable_proposed_plan, created_at, updated_at,
        archived_at, deleted_at, settled_override, settled_at, snoozed_until, snoozed_at,
        parent_thread_id, settled_change_request_number
      ) VALUES (?, ?, ?, ?, 'full-access', 'default', ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, NULL, ?, ?, NULL, NULL, ?, ?)`,
    );
    const insertTurn = database.prepare(
      `INSERT INTO projection_turns (
        thread_id, turn_id, pending_message_id, assistant_message_id, state, requested_at,
        started_at, completed_at, checkpoint_turn_count, checkpoint_ref, checkpoint_status,
        checkpoint_files_json, source_proposed_plan_thread_id, source_proposed_plan_id,
        checkpoint_completed_at, pending_title_seed
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, NULL, NULL, NULL, '[]', NULL, NULL, NULL, NULL)`,
    );
    const insertSession = database.prepare(
      `INSERT INTO projection_thread_sessions (
        thread_id, status, provider_name, provider_instance_id, provider_session_id,
        provider_thread_id, runtime_mode, active_turn_id, last_error, updated_at
      ) VALUES (?, ?, ?, ?, NULL, NULL, 'full-access', ?, NULL, ?)`,
    );
    const insertMessage = database.prepare(
      `INSERT INTO projection_thread_messages (
        message_id, thread_id, turn_id, role, text, is_streaming, attachments_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
    );
    const insertRuntimeBinding = database.prepare(
      `INSERT INTO provider_session_runtime (
        thread_id, provider_name, provider_instance_id, adapter_key, runtime_mode,
        status, last_seen_at, resume_cursor_json, runtime_payload_json
      ) VALUES (?, ?, ?, ?, 'full-access', 'running', ?, NULL, NULL)`,
    );

    for (const thread of THREADS) {
      const turnId = `${thread.id}-turn`;
      const updatedAt = minutesBefore(now, thread.minutesAgo);
      insertThread.run(
        thread.id,
        thread.projectId ?? PROJECT_ID,
        thread.title,
        JSON.stringify(thread.selection),
        thread.branch,
        thread.worktree,
        turnId,
        minutesBefore(now, thread.minutesAgo + 1),
        0,
        thread.needsInput ? 1 : 0,
        minutesBefore(now, thread.minutesAgo + 90),
        updatedAt,
        thread.settled ? "settled" : null,
        thread.settled ? updatedAt : null,
        thread.parentThreadId ?? null,
        thread.changeRequestNumber ?? null,
      );
      insertTurn.run(
        thread.id,
        turnId,
        thread.running ? null : `${thread.id}-answer`,
        thread.running ? "running" : "completed",
        minutesBefore(now, thread.minutesAgo + 2),
        minutesBefore(now, thread.minutesAgo + 2),
        thread.running ? null : updatedAt,
      );
      insertSession.run(
        thread.id,
        thread.running ? "running" : "ready",
        thread.providerName,
        thread.selection.instanceId,
        thread.running ? turnId : null,
        updatedAt,
      );
      if (thread.running) {
        // Boot reconciliation correctly closes a projected running session
        // when no provider binding owns it. These disposable bindings claim
        // the visual fixture for the short capture window; no provider process
        // is spawned, and the capture scenarios never send work to it.
        insertRuntimeBinding.run(
          thread.id,
          thread.providerName,
          thread.selection.instanceId,
          thread.providerName,
          updatedAt,
        );
      }
      const requestAt = minutesBefore(now, thread.minutesAgo + 3);
      insertMessage.run(
        `${thread.id}-request`,
        thread.id,
        turnId,
        "user",
        thread.request,
        requestAt,
        requestAt,
      );
      if (thread.response !== null) {
        insertMessage.run(
          `${thread.id}-answer`,
          thread.id,
          turnId,
          "assistant",
          thread.response,
          updatedAt,
          updatedAt,
        );
      }
    }

    // Orchestrator activity feed: what the running work looks like from outside.
    const insertActivity = database.prepare(
      `INSERT INTO projection_thread_activities (
        activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence, created_at
      ) VALUES (?, ?, ?, 'tool', 'tool.completed', ?, ?, ?, ?)`,
    );
    const orchestratorActivities = [
      {
        id: "act-split",
        summary: "Split the work across three sub-agents",
        detail: "Implementation, tests and docs run in parallel",
        minutesAgo: 14,
        sequence: 1,
      },
      {
        id: "act-queue",
        summary: "Added the delivery queue",
        detail: "src/webhooks/deliveryQueue.ts · 1 file changed",
        minutesAgo: 8,
        sequence: 2,
      },
      {
        id: "act-backoff",
        summary: "Implemented exponential backoff",
        detail: "500ms base, 60s cap, jitter pending",
        minutesAgo: 3,
        sequence: 3,
      },
    ];
    for (const activity of orchestratorActivities) {
      insertActivity.run(
        activity.id,
        "th-webhook",
        "th-webhook-turn",
        activity.summary,
        JSON.stringify({
          itemType: "command_execution",
          title: activity.summary,
          detail: activity.detail,
          status: "completed",
        }),
        activity.sequence,
        minutesBefore(now, activity.minutesAgo),
      );
    }

    const insertQueued = database.prepare(
      `INSERT INTO projection_queued_messages (
        message_id, thread_id, text, attachments_json, model_selection_json,
        runtime_mode, interaction_mode, created_at, sequence
      ) VALUES (?, 'th-webhook', ?, '[]', ?, 'full-access', 'default', ?, ?)`,
    );
    for (const queued of QUEUED) {
      insertQueued.run(
        queued.id,
        queued.text,
        DEFAULT_SELECTION,
        minutesBefore(now, queued.minutesAgo),
        queued.sequence,
      );
    }

    // Flow (board) + one card mid-pipeline.
    database
      .prepare(
        `INSERT INTO projection_boards (board_id, project_id, name, steps_json, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        "board-ship",
        PROJECT_ID,
        "Ship a feature",
        JSON.stringify(BOARD_STEPS),
        minutesBefore(now, 60 * 24 * 12),
        minutesBefore(now, 45),
      );

    const cardThreads = [
      {
        stepIndex: 0,
        threadId: "th-card-plan",
        title: "Plan: CSV export",
        selection: BOARD_STEPS[0].agent,
        providerName: CLAUDE.providerName,
        minutesAgo: 52,
        running: false,
        response:
          "Plan written to the step artifact: stream orders as CSV with a cursor, cap exports at 50k rows, reuse the report date logic.",
      },
      {
        stepIndex: 1,
        threadId: "th-card-impl",
        title: "Implement: CSV export",
        selection: BOARD_STEPS[1].agent,
        providerName: CLAUDE.providerName,
        minutesAgo: 6,
        running: true,
        response: null,
      },
    ] as const;
    for (const cardThread of cardThreads) {
      const turnId = `${cardThread.threadId}-turn`;
      const updatedAt = minutesBefore(now, cardThread.minutesAgo);
      insertThread.run(
        cardThread.threadId,
        PROJECT_ID,
        cardThread.title,
        JSON.stringify({
          instanceId: cardThread.selection.instanceId,
          model: cardThread.selection.model,
        }),
        "feat/csv-export",
        NodePath.join(WORKTREES, "csv-export"),
        turnId,
        minutesBefore(now, cardThread.minutesAgo + 1),
        0,
        0,
        minutesBefore(now, cardThread.minutesAgo + 30),
        updatedAt,
        null,
        null,
        null,
        null,
      );
      insertTurn.run(
        cardThread.threadId,
        turnId,
        cardThread.running ? null : `${cardThread.threadId}-answer`,
        cardThread.running ? "running" : "completed",
        minutesBefore(now, cardThread.minutesAgo + 2),
        minutesBefore(now, cardThread.minutesAgo + 2),
        cardThread.running ? null : updatedAt,
      );
      insertSession.run(
        cardThread.threadId,
        cardThread.running ? "running" : "ready",
        cardThread.providerName,
        cardThread.selection.instanceId,
        cardThread.running ? turnId : null,
        updatedAt,
      );
      if (cardThread.running) {
        insertRuntimeBinding.run(
          cardThread.threadId,
          cardThread.providerName,
          cardThread.selection.instanceId,
          cardThread.providerName,
          updatedAt,
        );
      }
      const requestAt = minutesBefore(now, cardThread.minutesAgo + 4);
      insertMessage.run(
        `${cardThread.threadId}-request`,
        cardThread.threadId,
        turnId,
        "user",
        "Run this flow step for the CSV export card.",
        requestAt,
        requestAt,
      );
      if (cardThread.response !== null) {
        insertMessage.run(
          `${cardThread.threadId}-answer`,
          cardThread.threadId,
          turnId,
          "assistant",
          cardThread.response,
          updatedAt,
          updatedAt,
        );
      }
    }

    database
      .prepare(
        `INSERT INTO projection_cards (
          card_id, board_id, project_id, title, parameters_json, position_kind,
          position_step_index, status, snapshot_json, branch, worktree_path,
          step_threads_json, released_at, completed_at, archived_at, created_at,
          updated_at, settled_at, operation_json, last_error
        ) VALUES (?, 'board-ship', ?, ?, ?, 'step', 1, 'running', ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, NULL, NULL)`,
      )
      .run(
        "card-csv-export",
        PROJECT_ID,
        "Add CSV export to order reports",
        JSON.stringify({ request: "Export order reports as CSV, streamed, capped at 50k rows." }),
        JSON.stringify({ name: "Ship a feature", steps: BOARD_STEPS }),
        "feat/csv-export",
        NodePath.join(WORKTREES, "csv-export"),
        JSON.stringify([
          { stepIndex: 0, threadId: "th-card-plan", spawnedAt: minutesBefore(now, 55) },
          { stepIndex: 1, threadId: "th-card-impl", spawnedAt: minutesBefore(now, 8) },
        ]),
        minutesBefore(now, 58),
        minutesBefore(now, 60 * 3),
        minutesBefore(now, 6),
      );

    // Usage heatmap: 45 days of plausible weekday-heavy volume across providers.
    const insertUsage = database.prepare(
      `INSERT INTO usage_daily_rollup (
        day, provider, model, project_path, git_branch, input_tokens, cached_input_tokens,
        cache_write_tokens, output_tokens, reasoning_tokens, turns, sessions, cost_usd, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'marketing-demo')`,
    );
    const usageModels = [
      { provider: "claude", model: "claude-fable-5", weight: 1 },
      { provider: "claude", model: "claude-opus-5", weight: 0.6 },
      { provider: "codex", model: "gpt-5.6-sol", weight: 0.8 },
    ];
    for (let daysAgo = 0; daysAgo < 45; daysAgo++) {
      const dayDate = new Date(now - daysAgo * 24 * 60 * 60 * 1000);
      const weekday = dayDate.getDay();
      const weekend = weekday === 0 || weekday === 6;
      // Deterministic pseudo-random shape so re-seeding is stable.
      const wave = 0.55 + 0.45 * Math.sin(daysAgo * 1.7) * Math.cos(daysAgo * 0.6);
      const dayFactor = (weekend ? 0.25 : 1) * Math.abs(wave);
      const key = [
        dayDate.getFullYear(),
        String(dayDate.getMonth() + 1).padStart(2, "0"),
        String(dayDate.getDate()).padStart(2, "0"),
      ].join("-");
      for (const usage of usageModels) {
        const input = Math.round(2_400_000 * usage.weight * dayFactor);
        if (input < 40_000) continue;
        insertUsage.run(
          key,
          usage.provider,
          usage.model,
          REPO_ROOT,
          "main",
          input,
          Math.round(input * 3.1),
          Math.round(input * 0.4),
          Math.round(input * 0.12),
          Math.round(input * 0.05),
          Math.max(2, Math.round(34 * dayFactor)),
          Math.max(1, Math.round(6 * dayFactor)),
        );
      }
    }

    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Nothing to roll back.
    }
    throw error;
  } finally {
    database.close();
  }
}

const now = Date.now();
await buildRepository();
await buildWebRepository();
if (!reposOnly) {
  seedDatabase(now);
  console.log(`Seeded ${DB_PATH}`);
}
console.log(`Demo repository at ${REPO_ROOT}`);
