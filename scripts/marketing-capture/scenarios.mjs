// Per-slug capture scenarios, registered by capture.mjs.
//
// Conventions:
// - Every scenario opens what it needs itself; contexts start from the same
//   paired storage state, so no scenario depends on another having run.
// - helpers.markStart()/markEnd() bracket the loop window; put the page in the
//   same idle state at both marks so the published loop is seamless.
// - Thread/board ids match scripts/marketing-capture/seed.ts.
//
// Every interaction below goes through the rendered product controls. Fixture
// rows provide safe, private demo data, but the recorded behavior itself is
// always Aqqua's real UI and command path.
export function registerScenarios(scenario, { envId, webUrl }) {
  const thread = (threadId) => `${webUrl}/${envId}/${threadId}`;
  const cardUrl = `${webUrl}/board/${envId}/acme-api/card/card-csv-export`;

  const CHILDREN = ["th-webhook-impl", "th-webhook-tests", "th-webhook-docs"];

  async function openOrchestratorFamily(page, helpers) {
    // Visiting each child opens its conversation tab; the strip then groups
    // them under the orchestrator with the numbered sub-agent chip.
    for (const child of CHILDREN) {
      await page.goto(thread(child), { waitUntil: "domcontentloaded" });
      await helpers.settle(page, 700);
    }
    await page.goto(thread("th-webhook"), { waitUntil: "domcontentloaded" });
    await helpers.settle(page, 1500);
    await helpers.dismissUpdateToast(page);
  }

  // ── orchestration ────────────────────────────────────────────
  // One branch, one orchestrator, three sub-agents on different providers.
  // The loop walks the popover into two children so their locked provider
  // (Codex, Grok) shows in the composer, then returns to the orchestrator.
  scenario("orchestration", {
    highlight: { x: 250, y: 40, width: 930, height: 700 },
    beats: [
      { t: 1.9, label: "Open the orchestrator's sub-agent family" },
      { t: 4.3, label: "Switch to the Codex lane" },
      { t: 7.1, label: "Switch to the Grok lane" },
    ],
    async run(page, helpers) {
      await openOrchestratorFamily(page, helpers);
      helpers.markStart();
      await helpers.settle(page, 900);
      await page.locator("button[data-sub-agent-count]").click();
      await helpers.settle(page, 1300);
      await page.locator(`button[data-tab-family-popover-item="${envId}:th-webhook-impl"]`).click();
      await helpers.settle(page, 1700);
      await page.locator("button[data-sub-agent-count]").click();
      await helpers.settle(page, 1100);
      await page
        .locator(`button[data-tab-family-popover-item="${envId}:th-webhook-tests"]`)
        .click();
      await helpers.settle(page, 1700);
      // The family shell itself routes back to the orchestrator.
      await page.locator('[data-testid^="conversation-tab-"]').first().click();
      await helpers.settle(page, 1100);
      helpers.markEnd();
    },
    async poster(page, helpers) {
      await openOrchestratorFamily(page, helpers);
      await page.locator("button[data-sub-agent-count]").click();
      await helpers.settle(page, 900);
    },
  });

  // ── worktree-tabs ────────────────────────────────────────────
  // Worktree cards in the sidebar, the conversation tab strip, and the
  // numbered sub-agent popover opening.
  scenario("worktree-tabs", {
    highlight: { x: 0, y: 55, width: 920, height: 510 },
    beats: [
      { t: 1.6, label: "Switch worktrees from the sidebar" },
      { t: 3.2, label: "Return to the orchestrator worktree" },
      { t: 4.9, label: "Open the bounded sub-agent tab group" },
    ],
    async run(page, helpers) {
      await openOrchestratorFamily(page, helpers);
      helpers.markStart();
      await helpers.settle(page, 800);
      // Switch worktrees from the sidebar cards; the tab strip follows.
      await page.locator("text=fix/timezon").first().click();
      await helpers.settle(page, 1500);
      await page.locator("text=feat/web").first().click();
      await helpers.settle(page, 1500);
      await page.locator("button[data-sub-agent-count]").click();
      await helpers.settle(page, 1600);
      await page.keyboard.press("Escape");
      await helpers.settle(page, 900);
      helpers.markEnd();
    },
    async poster(page, helpers) {
      await openOrchestratorFamily(page, helpers);
      await page.locator("button[data-sub-agent-count]").click();
      await helpers.settle(page, 900);
    },
  });

  // ── message-queue ────────────────────────────────────────────
  scenario("message-queue", {
    highlight: { x: 360, y: 335, width: 820, height: 430 },
    beats: [
      { t: 1.1, label: "Write another instruction during a running turn" },
      { t: 2.8, label: "Submit through the real composer to queue it" },
      { t: 4.7, label: "Remove the queued instruction" },
    ],
    async run(page, helpers) {
      await page.goto(thread("th-webhook"), { waitUntil: "domcontentloaded" });
      await helpers.settle(page, 1800);
      await helpers.dismissUpdateToast(page);
      helpers.markStart();
      await helpers.settle(page, 700);
      const queuedText = "Track retries exhausted as a metric for the dashboard.";
      await page.getByTestId("composer-editor").click();
      await page.keyboard.type(queuedText, { delay: 22 });
      await helpers.settle(page, 450);
      await page.getByRole("button", { name: "Send message" }).click();
      await page.getByText("Queued · 4", { exact: true }).waitFor();
      await helpers.settle(page, 1250);
      await page.getByRole("button", { name: `Remove queued message: ${queuedText}` }).click();
      await page.getByText("Queued · 3", { exact: true }).waitFor();
      await helpers.settle(page, 950);
      helpers.markEnd();
    },
    async poster(page, helpers) {
      await page.goto(thread("th-webhook"), { waitUntil: "domcontentloaded" });
      await helpers.settle(page, 1800);
      await helpers.dismissUpdateToast(page);
    },
  });

  // ── flows ────────────────────────────────────────────────────
  // A card mid-pipeline: step 1's finished thread hands its artifact to the
  // running step 2.
  scenario("flows", {
    highlight: { x: 245, y: 45, width: 960, height: 700 },
    beats: [
      { t: 1.8, label: "Open the completed planning step" },
      { t: 4.0, label: "Return to the running implementation step" },
    ],
    async run(page, helpers) {
      await page.goto(cardUrl, { waitUntil: "domcontentloaded" });
      await helpers.settle(page, 1800);
      await helpers.dismissUpdateToast(page);
      helpers.markStart();
      await helpers.settle(page, 900);
      await page.locator('button:has-text("1 · Plan")').click();
      await helpers.settle(page, 2000);
      await page.locator('button:has-text("2 · Implement")').click();
      await helpers.settle(page, 1900);
      helpers.markEnd();
    },
    async poster(page, helpers) {
      await page.goto(cardUrl, { waitUntil: "domcontentloaded" });
      await helpers.settle(page, 1800);
      await helpers.dismissUpdateToast(page);
      await page.locator('button:has-text("1 · Plan")').click();
      await helpers.settle(page, 1300);
    },
  });

  // ── git-graph ────────────────────────────────────────────────
  scenario("git-graph", {
    highlight: { x: 520, y: 35, width: 760, height: 745 },
    beats: [
      { t: 1.1, label: "Select a merge commit" },
      { t: 3.7, label: "Inspect its commit detail" },
    ],
    async run(page, helpers) {
      await page.goto(thread("th-webhook"), { waitUntil: "domcontentloaded" });
      await helpers.settle(page, 1500);
      await helpers.dismissUpdateToast(page);
      await page.locator('button[aria-label="Open Git history"]').click();
      await helpers.settle(page, 2000);
      helpers.markStart();
      await helpers.settle(page, 900);
      await page.locator("text=Merge feat/rate-limiting").first().click();
      await helpers.settle(page, 2200);
      // Back to the graph so the loop closes on its opening frame.
      await page.keyboard.press("Escape");
      await helpers.settle(page, 700);
      const back = page
        .locator('button[aria-label="Back to history"], button:has-text("History")')
        .first();
      try {
        await back.click({ timeout: 1500 });
      } catch {
        // Escape already closed the details.
      }
      await helpers.settle(page, 1200);
      helpers.markEnd();
    },
    async poster(page, helpers) {
      await page.goto(thread("th-webhook"), { waitUntil: "domcontentloaded" });
      await helpers.settle(page, 1500);
      await helpers.dismissUpdateToast(page);
      await page.locator('button[aria-label="Open Git history"]').click();
      await helpers.settle(page, 2000);
    },
  });

  // ── project-scope ────────────────────────────────────────────
  scenario("project-scope", {
    highlight: { x: 0, y: 65, width: 420, height: 500 },
    beats: [
      { t: 1.2, label: "Open the project multi-select" },
      { t: 2.8, label: "Scope the sidebar to acme-api" },
      { t: 4.4, label: "Restore all projects" },
    ],
    async run(page, helpers) {
      await page.goto(thread("th-webhook"), { waitUntil: "domcontentloaded" });
      await helpers.settle(page, 1500);
      await helpers.dismissUpdateToast(page);
      helpers.markStart();
      await helpers.settle(page, 800);
      await page.locator('input[aria-label="Filter threads by project"]').click();
      await helpers.settle(page, 1200);
      await page.locator('[role="option"]:has-text("acme-api")').first().click();
      await helpers.settle(page, 1600);
      // The multiselect popup stays open; "Deselect all" restores the list.
      await page.locator('button:has-text("Deselect all")').click();
      await helpers.settle(page, 1100);
      await page.keyboard.press("Escape");
      await helpers.settle(page, 900);
      helpers.markEnd();
    },
    async poster(page, helpers) {
      await page.goto(thread("th-webhook"), { waitUntil: "domcontentloaded" });
      await helpers.settle(page, 1200);
      await helpers.dismissUpdateToast(page);
      await page.locator('input[aria-label="Filter threads by project"]').click();
      await helpers.settle(page, 900);
    },
  });

  // ── pull-request ──────────────────────────────────────────────
  // The server is started with the phase-B gh fixture on PATH. Aqqua still
  // discovers the repository, shells out through its real GitHub adapter, and
  // renders the production pull-request panel and controls.
  scenario("pull-request", {
    highlight: { x: 570, y: 35, width: 710, height: 745 },
    beats: [
      { t: 1.4, label: "Open the pull-request panel" },
      { t: 3.0, label: "Inspect merge and auto-merge actions" },
      { t: 5.3, label: "Open the commit list" },
    ],
    async run(page, helpers) {
      await page.goto(thread("th-webhook"), { waitUntil: "domcontentloaded" });
      await helpers.settle(page, 1700);
      await helpers.dismissUpdateToast(page);
      helpers.markStart();
      await helpers.settle(page, 650);
      await page.getByRole("button", { name: "Open pull request" }).click();
      await page.getByText("Pull request", { exact: true }).waitFor();
      await page.getByText("Add webhook delivery retries", { exact: true }).last().waitFor();
      await helpers.settle(page, 1400);
      await page.locator('button[aria-label$=" actions"]').last().click();
      await helpers.settle(page, 1450);
      await page.keyboard.press("Escape");
      await helpers.settle(page, 500);
      await page.getByRole("button", { name: "Commits" }).click();
      await helpers.settle(page, 1500);
      helpers.markEnd();
    },
    async poster(page, helpers) {
      await page.goto(thread("th-webhook"), { waitUntil: "domcontentloaded" });
      await helpers.settle(page, 1600);
      await helpers.dismissUpdateToast(page);
      await page.getByRole("button", { name: "Open pull request" }).click();
      await page.getByText("Pull request", { exact: true }).waitFor();
      await helpers.settle(page, 1700);
      // Collapse the long description so the check rows sit in the frame with
      // the PR identity and merge controls.
      await page.getByRole("button", { name: "Description" }).click();
      await helpers.settle(page, 750);
    },
  });

  // ── usage ────────────────────────────────────────────────────
  scenario("usage", {
    highlight: { x: 240, y: 35, width: 1000, height: 735 },
    beats: [
      { t: 1.0, label: "Show the 90-day usage ledger" },
      { t: 3.1, label: "Return to the 30-day view" },
    ],
    async run(page, helpers) {
      await page.goto(`${webUrl}/usage`, { waitUntil: "domcontentloaded" });
      await page.getByText("Total tokens", { exact: true }).waitFor();
      await helpers.settle(page, 1500);
      await helpers.dismissUpdateToast(page);
      helpers.markStart();
      await helpers.settle(page, 750);
      await page.getByRole("button", { name: "90d" }).click();
      await helpers.settle(page, 1800);
      await page.getByRole("button", { name: "30d" }).click();
      await helpers.settle(page, 1500);
      helpers.markEnd();
    },
    async poster(page, helpers) {
      await page.goto(`${webUrl}/usage`, { waitUntil: "domcontentloaded" });
      await page.getByText("Total tokens", { exact: true }).waitFor();
      await helpers.settle(page, 1600);
      await helpers.dismissUpdateToast(page);
    },
  });

  async function startNewAcmeThread(page, helpers) {
    await page.getByRole("button", { name: "New thread", exact: true }).click();
    const palette = page.locator('[data-slot="command-dialog-popup"]');
    await palette.waitFor();
    await palette
      .locator('[data-slot="command-item"]')
      .filter({ hasText: "acme-api" })
      .first()
      .click();
    await palette.waitFor({ state: "hidden" });
    await page.getByTestId("composer-editor").waitFor();
    await helpers.settle(page, 1000);
  }

  async function openResumePicker(page, helpers) {
    await page.goto(thread("th-webhook"), { waitUntil: "domcontentloaded" });
    await helpers.settle(page, 1400);
    await helpers.dismissUpdateToast(page);
    await startNewAcmeThread(page, helpers);
    await page.getByTestId("composer-editor").click();
    await page.keyboard.type("/resume", { delay: 70 });
    await page.locator('[data-composer-item-id="slash:resume"]').click();
    await page.locator("[data-composer-resume-picker]").waitFor();
  }

  // ── resume-cli ───────────────────────────────────────────────
  scenario("resume-cli", {
    highlight: { x: 330, y: 310, width: 860, height: 455 },
    beats: [
      { t: 0.5, label: "Type the resume command in a new draft" },
      { t: 1.3, label: "Browse conversations started in the terminal" },
      { t: 2.6, label: "Select a CLI conversation to adopt" },
    ],
    async run(page, helpers) {
      await page.goto(thread("th-webhook"), { waitUntil: "domcontentloaded" });
      await helpers.settle(page, 1400);
      await helpers.dismissUpdateToast(page);
      await startNewAcmeThread(page, helpers);
      helpers.markStart();
      await page.getByTestId("composer-editor").click();
      await page.keyboard.type("/resume", { delay: 70 });
      await helpers.settle(page, 500);
      await page.locator('[data-composer-item-id="slash:resume"]').click();
      await page.locator("[data-composer-resume-picker]").waitFor();
      await helpers.settle(page, 1500);
      await page.getByRole("button", { name: /Profile the orders endpoint/ }).click();
      await helpers.settle(page, 1500);
      helpers.markEnd();
    },
    async poster(page, helpers) {
      await openResumePicker(page, helpers);
      await helpers.settle(page, 1100);
    },
  });

  // ── pi-agent ─────────────────────────────────────────────────
  // This is the real flow-step model picker, switched to the configured pi
  // instance. The selection is discarded with Escape after the recording.
  scenario("pi-agent", {
    highlight: { x: 245, y: 80, width: 790, height: 650 },
    beats: [
      { t: 1.0, label: "Open the flow step's model catalog" },
      { t: 2.3, label: "Switch to the pi provider instance" },
      { t: 3.7, label: "Pin a pi model to the step" },
    ],
    async run(page, helpers) {
      await page.goto(cardUrl, { waitUntil: "domcontentloaded" });
      await helpers.settle(page, 1600);
      await helpers.dismissUpdateToast(page);
      await page.locator('input[aria-label^="Filter flows"]').click();
      await helpers.settle(page, 900);
      await page.locator('button[aria-label="Edit Ship a feature"]').click();
      await helpers.settle(page, 1300);
      await page.locator('button[aria-label="Edit step 3: Review"]').click();
      await helpers.settle(page, 900);
      helpers.markStart();
      await page.locator('button[aria-label="Step 3 model"]').click();
      await helpers.settle(page, 900);
      await page.locator('[data-model-picker-provider="pi"] button').click();
      await helpers.settle(page, 1400);
      const picker = page.locator("[data-model-picker-content]");
      await picker
        .getByText(/Claude Sonnet 5|claude-sonnet-5/i)
        .last()
        .click();
      await helpers.settle(page, 1450);
      helpers.markEnd();
      await page.keyboard.press("Escape");
    },
    async poster(page, helpers) {
      await page.goto(cardUrl, { waitUntil: "domcontentloaded" });
      await helpers.settle(page, 1500);
      await helpers.dismissUpdateToast(page);
      await page.locator('input[aria-label^="Filter flows"]').click();
      await helpers.settle(page, 800);
      await page.locator('button[aria-label="Edit Ship a feature"]').click();
      await helpers.settle(page, 1200);
      await page.locator('button[aria-label="Edit step 3: Review"]').click();
      await helpers.settle(page, 800);
      await page.locator('button[aria-label="Step 3 model"]').click();
      await helpers.settle(page, 800);
      await page.locator('[data-model-picker-provider="pi"] button').click();
      await helpers.settle(page, 1200);
    },
  });

  // ── agent-models ─────────────────────────────────────────────
  // The flow editor pins a step to an exact instance + model + reasoning.
  scenario("agent-models", {
    highlight: { x: 245, y: 80, width: 790, height: 650 },
    beats: [
      { t: 1.0, label: "Open the exact model catalog" },
      { t: 2.9, label: "Choose Claude Opus 5" },
      { t: 4.5, label: "Choose its reasoning level" },
    ],
    async run(page, helpers) {
      await page.goto(cardUrl, { waitUntil: "domcontentloaded" });
      await helpers.settle(page, 1600);
      await helpers.dismissUpdateToast(page);
      // The per-flow edit (pencil) button lives inside the flows picker.
      await page.locator('input[aria-label^="Filter flows"]').click();
      await helpers.settle(page, 900);
      await page.locator('button[aria-label="Edit Ship a feature"]').click();
      await helpers.settle(page, 1500);
      await page.locator('button[aria-label="Edit step 2: Implement"]').click();
      await helpers.settle(page, 1000);
      helpers.markStart();
      await helpers.settle(page, 800);
      await page.locator('button[aria-label="Step 2 model"]').click();
      await helpers.settle(page, 900);
      // The picker may render a provider-authored short name, so filter by the
      // stable model slug inside the available Claude instance and select the
      // real result row instead of matching presentation copy.
      await page.locator('[data-model-picker-provider="claudeAgent"] button').click();
      await helpers.settle(page, 500);
      await page.getByPlaceholder("Search models").fill("Claude Opus 5");
      await helpers.settle(page, 700);
      await page.locator('[data-slot="combobox-item"]').first().click();
      await helpers.settle(page, 1300);
      await page.locator('button[aria-label="Step 2 reasoning"]').click();
      await helpers.settle(page, 1200);
      await page.locator('[data-slot="menu-radio-item"]:has-text("Extra High")').click();
      await helpers.settle(page, 1100);
      helpers.markEnd();
      // Discard: never persist capture-time edits to the seeded flow.
      await page.keyboard.press("Escape");
    },
    async poster(page, helpers) {
      await page.goto(cardUrl, { waitUntil: "domcontentloaded" });
      await helpers.settle(page, 1600);
      await helpers.dismissUpdateToast(page);
      await page.locator('input[aria-label^="Filter flows"]').click();
      await helpers.settle(page, 900);
      await page.locator('button[aria-label="Edit Ship a feature"]').click();
      await helpers.settle(page, 1200);
      await page.locator('button[aria-label="Edit step 2: Implement"]').click();
      await helpers.settle(page, 800);
      await page.locator('button[aria-label="Step 2 model"]').click();
      await helpers.settle(page, 1200);
    },
  });
}
