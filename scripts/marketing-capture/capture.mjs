// Marketing capture harness: drives a paired aqqua web instance with
// Playwright and records each feature as a short silent .webm plus a poster
// still. Raw captures land in scripts/marketing-capture/raw by default; the
// sibling ../remotion project turns them into the shipping assets under
// apps/marketing/public/demos/.
//
//   node scripts/marketing-capture/capture.mjs \
//     --base-dir /tmp/aqqua-capture.XXXXXX \
//     --server-port 13778 --web-port 5738 [--only slug1,slug2] \
//     [--output-dir /tmp/capture-lane]
//
// The harness mints its own one-time pairing token via the aqqua auth CLI,
// consumes it as the browser's first navigation, and stores the resulting
// browser storage state inside the base dir so re-runs skip pairing. Pairing
// URLs are secrets: they are passed process-to-process and never printed.
//
// ffmpeg is intentionally not required. Playwright records .webm natively,
// but only whole-context recordings — which would open every clip with a
// page-load flash. So each scenario marks a loop window (helpers.markStart /
// helpers.markEnd) and the raw recording is trimmed by replaying it through a
// <canvas> + MediaRecorder inside headless Chromium. Posters are real
// screenshots, never extracted video frames.
import { execFile as execFileCb } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { chromium } from "playwright";

const execFile = promisify(execFileCb);

// ── CLI ────────────────────────────────────────────────────────

function flag(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const BASE_DIR_ARG = flag("base-dir");
const SERVER_PORT = flag("server-port");
const WEB_PORT = flag("web-port");
const ONLY =
  flag("only")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? null;
const PAIR_ONLY = process.argv.includes("--pair-only");
if (!BASE_DIR_ARG || !SERVER_PORT || !WEB_PORT) {
  console.error(
    "Usage: node scripts/marketing-capture/capture.mjs --base-dir <dir> --server-port <p> --web-port <p> [--only slug,...] [--output-dir <dir>] [--pair-only]",
  );
  process.exit(1);
}
const BASE_DIR = await fs.realpath(BASE_DIR_ARG);
const WEB_URL = `http://localhost:${WEB_PORT}`;
const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const OUT_DIR = path.resolve(
  flag("output-dir", path.join(REPO_ROOT, "scripts/marketing-capture/raw")),
);
const AUTH_STATE = path.join(BASE_DIR, "marketing-capture-auth.json");
const VIEWPORT = { width: 1280, height: 800 };
const VIDEO_BITRATE = 1_300_000; // ~1.3 Mbps keeps an 8s 1280x800 clip near 1.3 MB.

const sharedHome = await fs
  .realpath(path.join(os.homedir(), ".aqqua"))
  .catch(() => path.resolve(os.homedir(), ".aqqua"));
if (BASE_DIR === sharedHome || BASE_DIR.startsWith(sharedHome + path.sep)) {
  console.error(`Refusing to run against the shared ${sharedHome} directory.`);
  process.exit(1);
}

// ── Pairing ────────────────────────────────────────────────────

async function haveValidAuthState() {
  try {
    await fs.access(AUTH_STATE);
  } catch {
    return false;
  }
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ storageState: AUTH_STATE, viewport: VIEWPORT });
    const page = await context.newPage();
    await page.goto(WEB_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const paired = !page.url().includes("/pair");
    await context.close();
    return paired;
  } finally {
    await browser.close();
  }
}

async function pairFreshBrowser() {
  // Mint a one-time token against the running dev server's database. The URL
  // stays in process memory only.
  const { stdout } = await execFile(
    "node",
    [
      path.join(REPO_ROOT, "apps/server/src/bin.ts"),
      "auth",
      "pairing",
      "create",
      "--base-dir",
      BASE_DIR,
      "--dev-url",
      WEB_URL,
      "--base-url",
      WEB_URL,
      "--ttl",
      "15m",
      "--label",
      "marketing-capture",
    ],
    { env: { ...process.env, AQQUA_PORT: SERVER_PORT } },
  );
  const match = stdout.match(/https?:\/\/\S+\/pair#token=\S+/);
  if (!match) throw new Error("Pairing CLI output did not include a pair URL.");
  const pairUrl = match[0];

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    await page.goto(pairUrl, { waitUntil: "domcontentloaded" });
    await page.waitForURL((url) => !url.pathname.startsWith("/pair"), { timeout: 20_000 });
    await page.waitForTimeout(2500);
    // Dismiss the provider-update toast once; the dismissal persists in
    // localStorage and rides along in the saved storage state.
    await dismissUpdateToast(page);
    await context.storageState({ path: AUTH_STATE });
    await context.close();
  } finally {
    await browser.close();
  }
  console.log("Paired a fresh browser session.");
}

async function dismissUpdateToast(page) {
  const toast = page.locator('div:has-text("Update Available")');
  try {
    if ((await toast.count()) === 0) return;
    const close = page
      .locator('div:has-text("Update Available") >> button')
      .filter({ hasNotText: "Settings" })
      .filter({ hasNotText: "Update" })
      .last();
    await close.click({ timeout: 2000 });
    await page.waitForTimeout(400);
  } catch {
    // Toast absent or already gone.
  }
}

// ── Scenario runner ────────────────────────────────────────────

/**
 * Each scenario drives one feature:
 *   run(page, helpers) — perform the interaction while video records. Call
 *     helpers.markStart() once the page is idle in the loop's first frame and
 *     helpers.markEnd() on the matching final frame; everything
 *     outside the marks (navigation, warm-up) is trimmed away.
 *   poster(page, helpers) — optional; drive the page into the most
 *     representative state, then the harness screenshots it. Defaults to a
 *     re-run of `run` without marks.
 * Keep marked windows between 4 and 8 seconds.
 */
const scenarios = [];

function scenario(slug, definition) {
  scenarios.push({ slug, ...definition });
}

function makeHelpers(recording) {
  return {
    webUrl: WEB_URL,
    baseDir: BASE_DIR,
    async settle(page, ms = 900) {
      await page.waitForTimeout(ms);
    },
    async dismissUpdateToast(page) {
      await dismissUpdateToast(page);
    },
    markStart() {
      if (recording) recording.start = Date.now();
    },
    markEnd() {
      if (recording) recording.end = Date.now();
    },
  };
}

async function recordScenario(browser, sc) {
  const videoTmp = await fs.mkdtemp(path.join(os.tmpdir(), `capture-${sc.slug}-`));
  try {
    const context = await browser.newContext({
      storageState: AUTH_STATE,
      viewport: VIEWPORT,
      recordVideo: { dir: videoTmp, size: VIEWPORT },
      reducedMotion: "no-preference",
    });
    const recording = { origin: Date.now(), start: null, end: null };
    const helpers = makeHelpers(recording);
    const page = await context.newPage();
    let video = null;
    try {
      await sc.run(page, helpers);
      video = page.video();
    } finally {
      await context.close();
    }
    if (recording.start === null || recording.end === null) {
      throw new Error("scenario did not call markStart/markEnd");
    }
    const rawPath = await video.path();
    const target = path.join(OUT_DIR, `${sc.slug}.webm`);
    // Idle margins absorb the imprecision of mapping wall-clock marks onto the
    // recording's timeline.
    const startSeconds = Math.max(0, (recording.start - recording.origin) / 1000 - 0.15);
    const endSeconds = (recording.end - recording.origin) / 1000 + 0.15;
    await trimVideo(browser, rawPath, target, startSeconds, endSeconds);
    return target;
  } finally {
    await fs.rm(videoTmp, { recursive: true, force: true });
  }
}

// Replay the raw context recording through a canvas + MediaRecorder to cut it
// to the marked window. Runs entirely inside headless Chromium — no ffmpeg.
async function trimVideo(browser, sourcePath, targetPath, startSeconds, endSeconds) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const bytes = await fs.readFile(sourcePath);
    await page.route("**/source.webm", (route) =>
      route.fulfill({ status: 200, contentType: "video/webm", body: bytes }),
    );
    await page.route("**/blank", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>trim</title>",
      }),
    );
    await page.goto("https://capture.invalid/blank");
    const base64 = await page.evaluate(
      async ({ start, end, width, height, bitrate }) => {
        const video = document.createElement("video");
        video.src = "/source.webm";
        video.muted = true;
        await new Promise((resolve, reject) => {
          video.onloadedmetadata = resolve;
          video.onerror = () => reject(new Error("could not load source video"));
        });
        // Streaming webm reports Infinity until forced to materialize. Note
        // that SEEKING these files is unreliable (it silently lands back at
        // 0), so the trim plays the file through from the top and only runs
        // the recorder inside the marked window — never seeks.
        if (!Number.isFinite(video.duration)) {
          video.currentTime = 1e9;
          await new Promise((resolve) => (video.onseeked = resolve));
          video.currentTime = 0;
          await new Promise((resolve) => (video.onseeked = resolve));
        }
        const stop = Math.min(end, video.duration);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context2d = canvas.getContext("2d");
        const stream = canvas.captureStream();
        const recorder = new MediaRecorder(stream, {
          mimeType: "video/webm;codecs=vp8",
          videoBitsPerSecond: bitrate,
        });
        const chunks = [];
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        let resolveDone;
        let rejectDone;
        const done = new Promise((resolve, reject) => {
          resolveDone = resolve;
          rejectDone = reject;
        });
        recorder.onstop = resolveDone;
        recorder.onerror = (event) => rejectDone(event.error ?? new Error("video trim failed"));
        let recording = false;
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          video.pause();
          if (!recording) {
            rejectDone(new Error("source video ended before the marked capture window"));
            return;
          }
          recorder.stop();
        };
        // A static final screen may not produce another video-frame callback
        // when playback reaches EOF. The ended event is the authoritative stop
        // signal; the frame callback remains useful for an earlier trim point.
        video.addEventListener("ended", finish, { once: true });
        // Fast-forward through the warm-up, drop to real time for the window.
        video.playbackRate = start > 0.5 ? 4 : 1;
        const pump = () => {
          context2d.drawImage(video, 0, 0, width, height);
          if (!recording && video.currentTime >= Math.max(0, start - 0.25)) {
            video.playbackRate = 1;
          }
          if (!recording && video.currentTime >= start) {
            recording = true;
            recorder.start(250);
          }
          if (video.currentTime >= stop || video.ended) {
            finish();
            return;
          }
          video.requestVideoFrameCallback(pump);
        };
        video.requestVideoFrameCallback(pump);
        const watchdog = window.setTimeout(
          () => rejectDone(new Error("video trim did not settle")),
          Math.max(10_000, (start / 4 + Math.max(0, stop - start) + 5) * 1_000),
        );
        await video.play();
        await done.finally(() => window.clearTimeout(watchdog));
        const blob = new Blob(chunks, { type: "video/webm" });
        const buffer = await blob.arrayBuffer();
        let binary = "";
        const view = new Uint8Array(buffer);
        for (let i = 0; i < view.length; i += 0x8000) {
          binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
        }
        return btoa(binary);
      },
      {
        start: startSeconds,
        end: endSeconds,
        width: VIEWPORT.width,
        height: VIEWPORT.height,
        bitrate: VIDEO_BITRATE,
      },
    );
    await fs.writeFile(targetPath, Buffer.from(base64, "base64"));
  } finally {
    await context.close();
  }
}

async function capturePoster(browser, sc) {
  const context = await browser.newContext({
    storageState: AUTH_STATE,
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
  });
  const helpers = makeHelpers(null);
  const page = await context.newPage();
  const target = path.join(OUT_DIR, `${sc.slug}.png`);
  try {
    await (sc.poster ?? sc.run)(page, helpers);
    await page.screenshot({ path: target });
  } finally {
    await context.close();
  }
  return target;
}

// ── Manifest ───────────────────────────────────────────────────

async function measureVideo(browser, filePath) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const bytes = await fs.readFile(filePath);
    await page.route("**/probe.webm", (route) =>
      route.fulfill({ status: 200, contentType: "video/webm", body: bytes }),
    );
    await page.route("**/blank", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>probe</title>",
      }),
    );
    await page.goto("https://capture.invalid/blank");
    return await page.evaluate(async () => {
      const video = document.createElement("video");
      video.src = "/probe.webm";
      video.muted = true;
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = () => reject(new Error("video failed to load"));
      });
      if (!Number.isFinite(video.duration)) {
        video.currentTime = 1e9;
        await new Promise((resolve) => (video.onseeked = resolve));
      }
      return {
        duration: Math.round(video.duration * 100) / 100,
        width: video.videoWidth,
        height: video.videoHeight,
      };
    });
  } finally {
    await context.close();
  }
}

async function measureImage(filePath) {
  // PNG dimensions live in the IHDR chunk at fixed offsets.
  const buffer = await fs.readFile(filePath);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function writeManifest(browser, entries) {
  const manifestPath = path.join(OUT_DIR, "manifest.json");
  let manifest = {};
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch {
    // First run.
  }
  for (const entry of entries) {
    const videoMeta = await measureVideo(browser, entry.video);
    const posterMeta = await measureImage(entry.poster);
    manifest[entry.slug] = {
      file: path.basename(entry.video),
      poster: path.basename(entry.poster),
      width: videoMeta.width,
      height: videoMeta.height,
      durationSeconds: videoMeta.duration,
      fps: 30,
      highlight: entry.scenario.highlight,
      beats: entry.scenario.beats ?? [],
      posterWidth: posterMeta.width,
      posterHeight: posterMeta.height,
    };
  }
  const ordered = Object.fromEntries(
    Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)),
  );
  await fs.writeFile(manifestPath, JSON.stringify(ordered, null, 2) + "\n");
  console.log(`Manifest updated: ${manifestPath}`);
}

// ── Main ───────────────────────────────────────────────────────

const ENV_ID = (
  await fs.readFile(path.join(BASE_DIR, "userdata", "environment-id"), "utf8")
).trim();
const { registerScenarios } = await import("./scenarios.mjs");
registerScenarios(scenario, { envId: ENV_ID, webUrl: WEB_URL });

await fs.mkdir(OUT_DIR, { recursive: true });
if (!(await haveValidAuthState())) {
  await pairFreshBrowser();
}

if (PAIR_ONLY) {
  console.log(`Pairing state ready: ${AUTH_STATE}`);
  process.exit(0);
}

const browser = await chromium.launch();
const selected = ONLY ? scenarios.filter((sc) => ONLY.includes(sc.slug)) : scenarios;
if (ONLY && selected.length !== ONLY.length) {
  const known = new Set(scenarios.map((sc) => sc.slug));
  console.warn(`Unknown slugs ignored: ${ONLY.filter((slug) => !known.has(slug)).join(", ")}`);
}
const produced = [];
let failures = 0;
for (const sc of selected) {
  process.stdout.write(`Capturing ${sc.slug}... `);
  try {
    const video = await recordScenario(browser, sc);
    const poster = await capturePoster(browser, sc);
    const size = (await fs.stat(video)).size;
    produced.push({ slug: sc.slug, video, poster, scenario: sc });
    console.log(`ok (${(size / 1024).toFixed(0)} KiB)`);
  } catch (error) {
    failures += 1;
    console.log(`FAILED: ${error.message}`);
  }
}
if (produced.length > 0) {
  await writeManifest(browser, produced);
}
await browser.close();
console.log(`Done: ${produced.length}/${selected.length} captures in ${OUT_DIR}`);
if (failures > 0 || selected.length === 0) {
  process.exitCode = 1;
}
