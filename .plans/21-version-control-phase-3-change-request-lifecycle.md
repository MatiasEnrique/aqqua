# Version Control Phase 3: Change-Request Lifecycle

## Context

Phases 1 and 2 built the plumbing: a `GitVcsDriver` for local git and a provider-neutral
`SourceControlProvider` layer with GitHub, GitLab, Bitbucket, and Azure DevOps drivers.
What we do not have is a **lifecycle**: aqqua can open a PR, but it cannot tell you whether
CI passed, cannot merge it, and — the reason this plan exists — does not notice when the PR
is merged. The thread stays in the inbox forever, and the user settles it by hand.

The headline outcome is **a thread settles itself when its PR merges**. The rest of this
plan is the surrounding surface that Orca ADE has and we do not, sequenced so the headline
lands first and each later phase is independently shippable.

Orca is the behavior reference throughout. Its design is worth stealing in one specific
place — the PR refresh cadence — and worth *not* stealing in another: Orca has no
auto-settle at all. Merged state there only feeds a manual "Workspace Cleanup" dialog
(`WorkspaceCleanupDialog`, filters on `state === "closed" || state === "merged"`). The
auto-settle behavior below is ours.

## Current state

### Already built, do not rebuild

**History** — `apps/server/src/git/GitHistory.ts` is complete: `list` / `getDetails` /
`getDiff` / `getFileDiff`, with an opaque base64url cursor that freezes the tip set across
pages so ref advances cannot insert or drop commits mid-pagination, plus per-operation
output byte caps. UI is `apps/web/src/components/gitHistory/` (graph, query, panel).
Nothing needed here.

**Diff** — `review.getDiffPreview` (`packages/contracts/src/review.ts`) returns
working-tree and branch-range sources with content hashes and truncation flags. UI is
`DiffPanel.tsx` plus `components/diffs/` (toolbar, scope selector, annotatable code view,
commit bar). Commit-file selection already exists as `diffCommitSelection.ts`.

**Auto commit / push / PR** — `GitManager.runStackedAction` is the whole pipeline:
`commit | push | create_pr | commit_push | commit_push_pr`, an optional feature-branch step
that names the branch from the generated commit subject, `filePaths` for partial commits,
LLM-generated commit messages and PR fields via `TextGeneration` with three style policies
(conventional / repository-conventions / custom), PR template detection
(`PrTemplateDetection.ts`), and streamed progress events
(`action_started` / `phase_started` / `hook_*` / `action_finished`). `preparePullRequestThread`
materializes a PR head branch into a new worktree thread.

**PR state** — `VcsStatusRemoteResult.pr` already carries
`{ number, title, url, baseRef, headRef, state: "open" | "closed" | "merged" }`.
`GitManager` wraps the lookup in a 2-minute cache with an epoch bump for explicit refreshes,
and a last-known-PR fallback keyed on head-branch + normalized remote URL so a rate-limit
blip cannot clear an already-shown PR badge.

### The gap

`VcsStatusBroadcaster` only polls remote status **while a client is subscribed**.
`retainRemotePoller` / `releaseRemotePoller` refcount off `streamStatus`, which is reached
only through `WS_METHODS.subscribeVcsStatus`. Merged state is therefore observed, published
to `changesPubSub` as a `remoteUpdated` event — and then consumed by nobody but the UI.
There is no server-side consumer of that stream, so nothing can react to a merge.

Against Orca's `gh:` surface we are also missing: `prChecks` / `prCheckDetails` /
`rerunPRChecks`, `mergePR` / `setPRAutoMerge` / `updatePRState`, `prComments` /
`addPRReviewComment` / `resolveReviewThread`, and the whole `git:` staging surface
(`stage` / `unstage` / `discard` / `conflictOperation` / `rebaseFromBase` / `abortMerge`).

## Decisions

Settled with the user before writing this plan:

- **On merge: settle only.** Emit `thread.settled` and stop. No auto-archive, no worktree
  removal, no cleanup prompt. Worktree removal stays manual via `WorktreeDeleteDialog`.
- **Watcher: subscription-gated.** No new always-on background poller and no new API quota
  burn. The reactor consumes the poller that already runs while a client streams that
  worktree's status. See "Known limitation" below — this is a real trade-off, not a free one.
- **Scope: all four areas**, phased A → D, each shippable alone.

## Phase A — Auto-settle on merged change request

The only phase that is required for the headline outcome.

### A1. Expose remote-status changes to server-side consumers

`apps/server/src/vcs/VcsStatusBroadcaster.ts` already owns `changesPubSub` and publishes
`remoteUpdated` on every remote fingerprint change. Add one member to the service:

```ts
readonly streamRemoteChanges: Stream.Stream<{
  readonly cwd: string
  readonly remote: VcsStatusRemoteResult | null
}>
```

backed by `PubSub.subscribe(changesPubSub)` filtered to `snapshot` and `remoteUpdated`.
This adds **no polling** — it observes work that already happens.

### A2. Durable memo so a merge settles exactly once

The hard requirement: a thread the user deliberately un-settles after a merge must not be
re-settled on the next poll, and must stay un-settled across a server restart.

- `packages/contracts/src/orchestration.ts`: add an optional `trigger` to
  `ThreadSettleCommand` — `{ kind: "merged-change-request"; number: PositiveInt }` — and an
  optional `settledChangeRequestNumber` to `ThreadSettledPayload`, `OrchestrationThread`,
  and `OrchestrationThreadShell`. Optional, not null-defaulted, matching how
  `parentThreadId` and `snoozedUntil` handle cross-version decode.
- New migration `041_ProjectionThreadsSettledChangeRequest.ts` adding
  `settled_change_request_number`; read/write it in
  `persistence/Layers/ProjectionThreads.ts` and `persistence/Services/ProjectionThreads.ts`.
- `orchestration/projector.ts`: on `thread.settled`, persist the number when the payload
  carries one. **Keep it on `thread.unsettled`** — that retention is what makes a manual
  un-settle stick.
- `orchestration/decider.ts`: pass the trigger through into the emitted payload. Watch the
  orchestrator cascade at `decider.ts:574-596`: it rebuilds the parent's own settle command
  in the `decideCommandSequence` list and would otherwise drop the trigger. Spread it onto
  the parent entry only — cascaded children settle because their parent did, not because of
  a PR, so they must not record a number.

### A3. The reactor

New `apps/server/src/orchestration/Services/PullRequestSettleReactor.ts` plus its
`Layers/` implementation, following `BoardReactor` exactly: `start(): Effect<void, never, Scope>`
and a `drain` for tests instead of timing sleeps.

For each `{ cwd, remote }` where `remote?.pr?.state === "merged"`:

1. Bail if `settings.autoSettleOnMergedChangeRequest` is false.
2. Resolve candidate threads from the projection: `worktreePath` normalizing to `cwd`
   (`fs.realPath`, matching `normalizeCwd` in the broadcaster), `deletedAt === null`,
   `archivedAt === null`.
3. **Skip any thread whose `settledChangeRequestNumber === pr.number`.** This is the whole
   idempotency story, and it is deliberately in the reactor rather than the decider: the
   engine rejects zero-event commands, so a decider-side guard cannot express "do nothing"
   without the re-emission trick at `decider.ts:600-616`, and that trick would flip a
   manually un-settled thread back to settled.
4. Dispatch `thread.settle` with the trigger.
5. Swallow dispatch rejections with a log — the existing guard rejects a thread with a
   queued turn start, and that is correct here. State stays merged, so the next poll retries.

### A4. Setting and surfaces

`autoSettleOnMergedChangeRequest: boolean`, default `true`, in the server settings struct in
`packages/contracts/src/settings.ts` (next to `newWorktreesStartFromOrigin`), with a toggle
in `apps/web/src/components/settings/SettingsPanels.tsx`. Desktop inherits web. Mobile reads
the same server-side setting. No client change is needed for the settle itself — settled
threads already render everywhere.

Docs: a `docs/user/` note and an "auto-settle" entry in `docs/reference/encyclopedia.md`.

### Known limitation to state in the docs

Subscription-gated means the settle fires only while some client is streaming that
worktree's status. If nobody is connected overnight, the merge is picked up when a client
next subscribes — immediately if the remote cache is cold (`streamStatus` passes
`refreshImmediately` when `cachedStatus?.remote` is null), otherwise after one poll
interval. Also, `lookupStatusPr` suppresses non-open PRs on the default branch, so a thread
rooted at the main repo on its default branch will never auto-settle. Both are acceptable
under the "no new background quota" decision; upgrading to an always-on PR-scoped watcher
is a contained follow-up if it turns out to matter.

## Phase B — Checks (CI) status

- Add `listChecks` to `SourceControlProvider` with a capability flag for drivers that cannot
  answer. GitHub via `statusCheckRollup`; GitLab pipelines; Bitbucket commit statuses; Azure
  policy evaluations.
- Extend `VcsStatusChangeRequest` in `packages/contracts/src/git.ts` with
  `checksStatus: "success" | "failure" | "pending" | null`.
- **Replace the flat 30 s remote interval with a state-keyed cadence**, taking Orca's tuning
  directly (`refreshIntervalForCandidate`): merged/closed 30 min, no PR 15 min, checks
  pending 90 s, checks failing 3 min, checks passing 10 min. This is a strict improvement on
  what we do today — it polls a merged PR 60× less often while reacting faster to running CI.
- UI: a checks chip in `GitActionsControl.tsx` / `BranchToolbar.tsx`.

## Phase C — Merge from the app

- Provider methods `mergeChangeRequest({ method })`, `setAutoMerge`, `updateChangeRequestState`.
- New RPCs alongside `git.resolvePullRequest`, with the same `AuthOrchestrationOperateScope`
  in `auth/RpcAuthorization.ts`.
- Allowed merge methods are repo settings, not constants — GitHub exposes them on the
  repository (`mergeCommitAllowed` / `squashMergeAllowed` / `rebaseMergeAllowed` /
  `viewerDefaultMergeMethod`); cache them per repo as Orca does.
- Pairs naturally with Phase A: merging from the app makes the thread settle itself.

## Phase D — Working-tree operations

Largest phase, and the one where copying Orca is the wrong instinct. Orca exposes a full
index-based staging model (`git:stage` / `unstage` / `bulkStage` / …). We already have a
simpler model that works: path selection (`diffCommitSelection.ts` →
`GitRunStackedActionInput.filePaths`) with no user-visible index.

Recommendation: extend the model we have — add `discard`, conflict listing and resolution,
and `rebaseFromBase` / `abortRebase` to `GitVcsDriver` — and introduce a real staging index
only if users ask for one. Per AGENTS.md: smallest model that makes the correct behavior
unsurprising.

## Verification

- `vp test run` on the touched files: `orchestration/decider.settled.test.ts`,
  `orchestration/projector.settled.test.ts`, the new `PullRequestSettleReactor.test.ts`,
  `vcs/VcsStatusBroadcaster.test.ts`.
- Reactor tests must cover, with a fake broadcaster driving the stream: open → merged emits
  exactly one settle; a second merged event emits none; un-settle then merged emits none;
  a thread with a queued turn start logs and does not fail the reactor.
- End-to-end against a scratch repo: seed a worktree thread from `~/.aqqua/dev` (never
  `userdata`), open a PR with the existing `commit_push_pr` action, merge it on the host,
  keep the thread open so the poller is live, and watch it settle. Then un-settle it and
  confirm it stays un-settled across a server restart.
- Targeted `typecheck` and `lint` for `apps/server`, `packages/contracts`, `apps/web`.
  No repo-wide checks.
