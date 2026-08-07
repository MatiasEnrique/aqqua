// Isolated environment for captures that depend on CLI state:
//
//   pull-request — the PR panel shells out to the `gh` CLI; a real call would
//     need a real GitHub repo. A `gh` shim on the server's PATH answers every
//     subcommand aqqua uses with deterministic data for the disposable repo.
//   usage — the heatmap needs `usage.scanEnabled`; the scanner reads
//     `$HOME/.claude` and `$HOME/.codex`. A capture-only HOME receives only
//     genuine transcripts whose cwd points inside the disposable demo base.
//   resume-cli — the /resume picker lists Claude CLI sessions from
//     `$HOME/.claude/projects`; the same filtering exposes the genuine demo
//     project's interactive Claude session without exposing other projects.
//   (bonus) a `scutil` shim renames the environment label so the machine's
//     real ComputerName never appears in a capture.
//
// Usage:  node scripts/marketing-capture/setup-capture-home.mjs --base-dir <dir> [--source-home <dir>] [--shims-only]
//
// Then restart the dev server with the shims and capture HOME (see README):
//   HOME=<base>/capture-home PATH=<base>/shims:$PATH pnpm exec vp run dev --home-dir <base>
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const fs = NodeFSP;
const os = NodeOS;
const path = NodePath;

const baseDirFlagIndex = process.argv.indexOf("--base-dir");
const baseDir = baseDirFlagIndex === -1 ? null : process.argv[baseDirFlagIndex + 1];
const sourceHomeFlagIndex = process.argv.indexOf("--source-home");
const sourceHome =
  sourceHomeFlagIndex === -1 ? os.homedir() : process.argv[sourceHomeFlagIndex + 1];
const shimsOnly = process.argv.includes("--shims-only");
if (!baseDir) {
  console.error(
    "Usage: node scripts/marketing-capture/setup-capture-home.mjs --base-dir <isolated-base-dir> [--source-home <dir>] [--shims-only]",
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
const CAPTURE_HOME = path.join(BASE, "capture-home");
const CAPTURE_SHELL_PATH = path.join(SHIMS, "capture-zsh");
const SOURCE_HOME = path.resolve(sourceHome);

// ── gh shim ────────────────────────────────────────────────────
// Answers exactly the calls apps/server/src/sourceControl/GitHubCli.ts makes.
// The PR boundary is deterministic because the disposable repo has no remote
// GitHub state. Its commits and branch come from the real demo repository.

const GH_SHIM = `#!/usr/bin/env node
// Local gh boundary for the aqqua marketing capture environment. It serves the
// disposable repo's demo pull request and never touches the network.
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
  title: "Add request metrics and service runbook",
  url: "https://github.com/acme-dev/acme-api/pull/52",
  baseRefName: "main",
  headRefName: "feat/ui-density",
  state: "OPEN",
  mergedAt: null,
  mergeable: "MERGEABLE",
  isCrossRepository: false,
  isDraft: false,
  headRepository: { name: "acme-api" },
  headRepositoryOwner: { login: "acme-dev" },
  updatedAt: iso(4),
  createdAt: iso(190),
  body: "Adds lightweight request metrics and a focused service runbook produced by two delegated agents.\\n\\n- request counters by route and status\\n- latency totals for operational dashboards\\n- incident and rollback guidance",
  author: { login: "demo-maintainer", name: "Demo Maintainer" },
  additions: 40,
  deletions: 0,
  comments: [
    {
      id: "C_kwDO52A",
      author: { login: "sam-oak" },
      authorAssociation: "MEMBER",
      body: "The metrics stay deliberately small and the runbook is easy to follow. Nice split between the two agents.",
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
      oid: "66b0e57",
      messageHeadline: "feat: add request metrics",
      messageBody: "",
      authoredDate: iso(180),
      committedDate: iso(180),
      authors: [{ login: "jordan-vale", name: "Jordan Vale", email: "jordan@acme.test" }],
    },
    {
      oid: "da455ab",
      messageHeadline: "docs: add service runbook",
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
    emit(head.includes("feat/ui-density") ? [pick(PR, fields)] : []);
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

// Provider discovery is unrelated to these captures. Make the isolated server
// fail Grok discovery immediately so it never reaches the real xAI CLI.
const GROK_SHIM = `#!/bin/sh
exit 1
`;

// Aqqua merges login-shell PATH ahead of its inherited PATH. This wrapper
// disables shell profiles for the capture process so the Grok shim remains the
// first resolvable executable while every other provider comes from the
// inherited, already-authenticated environment.
const CAPTURE_SHELL = `#!/bin/sh
export PATH="${SHIMS}:$PATH"
exec /bin/zsh -f "$@"
`;

async function copyFile(sourcePath, destinationPath) {
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.copyFile(sourcePath, destinationPath);
}

function parseJsonLines(contents) {
  return contents
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    });
}

function isDemoCwd(cwd) {
  return typeof cwd === "string" && (cwd === BASE || cwd.startsWith(`${BASE}${path.sep}`));
}

async function copyClaudeDemoSessions() {
  const sourceProjects = path.join(SOURCE_HOME, ".claude", "projects");
  const destinationProjects = path.join(CAPTURE_HOME, ".claude", "projects");
  const demoPrefix = BASE.replace(/[^a-zA-Z0-9]/g, "-");
  const entries = await fs.readdir(sourceProjects, { withFileTypes: true }).catch(() => []);
  let copied = 0;

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(demoPrefix)) continue;
    const sourceDirectory = path.join(sourceProjects, entry.name);
    const files = await fs.readdir(sourceDirectory, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
      const sourcePath = path.join(sourceDirectory, file.name);
      const contents = await fs.readFile(sourcePath, "utf8");
      const cwd = parseJsonLines(contents).find((record) => isDemoCwd(record?.cwd))?.cwd;
      if (!isDemoCwd(cwd)) continue;
      await copyFile(sourcePath, path.join(destinationProjects, entry.name, file.name));
      copied += 1;
    }
  }

  return copied;
}

async function collectJsonlFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectJsonlFiles(entryPath)));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(entryPath);
  }
  return files;
}

async function copyCodexDemoSessions() {
  const now = new Date();
  const sourceDay = path.join(
    SOURCE_HOME,
    ".codex",
    "sessions",
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  );
  const files = await collectJsonlFiles(sourceDay);
  let copied = 0;

  for (const sourcePath of files) {
    const contents = await fs.readFile(sourcePath, "utf8");
    const sessionMeta = parseJsonLines(contents).find((record) => record?.type === "session_meta");
    const cwd = sessionMeta?.payload?.cwd;
    if (!isDemoCwd(cwd)) continue;
    const relativePath = path.relative(SOURCE_HOME, sourcePath);
    await copyFile(sourcePath, path.join(CAPTURE_HOME, relativePath));
    copied += 1;
  }

  return copied;
}

// ── Write everything ───────────────────────────────────────────

// Keep reruns deterministic: this directory belongs exclusively to the
// disposable capture base validated above, and contains only fixtures created
// by this script.
await fs.rm(SHIMS, { recursive: true, force: true });
await fs.mkdir(SHIMS, { recursive: true });
await fs.writeFile(path.join(SHIMS, "gh"), GH_SHIM, { mode: 0o755 });
await fs.writeFile(path.join(SHIMS, "scutil"), SCUTIL_SHIM, { mode: 0o755 });
await fs.writeFile(path.join(SHIMS, "grok"), GROK_SHIM, { mode: 0o755 });
await fs.writeFile(CAPTURE_SHELL_PATH, CAPTURE_SHELL, { mode: 0o755 });

if (shimsOnly) {
  console.log(`Shims:         ${SHIMS}`);
  console.log(`Capture shell: ${CAPTURE_SHELL_PATH}`);
  console.log("");
  console.log("Start the initial isolated server without exposing the real Grok CLI:");
  console.log(
    `  SHELL=${CAPTURE_SHELL_PATH} PATH=${SHIMS}:$PATH pnpm exec vp run dev --home-dir ${BASE}`,
  );
  process.exit(0);
}

await fs.rm(CAPTURE_HOME, { recursive: true, force: true });

// aqqua resolves CLI executables against a LOGIN-shell PATH capture
// (packages/shared/src/shell.ts), not the server process env — so the capture
// HOME's shell profile must prepend the shims, or the real gh/scutil win.
await fs.mkdir(CAPTURE_HOME, { recursive: true });
const profileLine = `export PATH="${SHIMS}:$PATH"\n`;
await fs.writeFile(path.join(CAPTURE_HOME, ".zprofile"), profileLine);
await fs.writeFile(path.join(CAPTURE_HOME, ".zshenv"), profileLine);
await fs.writeFile(path.join(CAPTURE_HOME, ".bash_profile"), profileLine);

const claudeSessionsCopied = await copyClaudeDemoSessions();
const codexSessionsCopied = await copyCodexDemoSessions();
if (claudeSessionsCopied === 0) {
  throw new Error(`No real Claude sessions found for ${BASE}.`);
}
if (codexSessionsCopied === 0) {
  throw new Error(`No real Codex sessions found for ${BASE}.`);
}

// Enable historical usage scanning so the heatmap renders. Merge-preserve any
// existing settings.
const settingsPath = path.join(BASE, "userdata", "settings.json");
let settings = {};
try {
  settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
} catch {
  // No settings yet.
}
settings.usage = { ...settings.usage, scanEnabled: true };
await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");

console.log(`Shims:      ${SHIMS}`);
console.log(`Capture shell: ${CAPTURE_SHELL_PATH}`);
console.log(`Capture HOME: ${CAPTURE_HOME}`);
console.log(`Claude logs:  ${claudeSessionsCopied} real demo transcript(s)`);
console.log(`Codex logs:   ${codexSessionsCopied} real demo rollout(s)`);
console.log(`Settings:   ${settingsPath} (usage.scanEnabled=true)`);
console.log("");
console.log("Restart the dev server for capture:");
console.log(
  `  HOME=${CAPTURE_HOME} SHELL=${CAPTURE_SHELL_PATH} PATH=${SHIMS}:$PATH pnpm exec vp run dev --home-dir ${BASE}`,
);
