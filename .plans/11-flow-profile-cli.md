# CLI authoring for flows and agent profiles

Status: planned (this branch: `profiles-flows`)

## Goal

Agents (and humans) can create, edit, list, and delete **flows** and **agent profiles** from the `aqqua` CLI, so an agent can generate a pipeline and the profiles it needs without a human clicking through the web UI. Today both are UI-only: flows are authored in `BoardEditorDialog`, profiles in Settings → Agent Profiles, and the only programmatic write path for profiles is the browser's WebSocket RPC.

## Facts the design leans on

- **Flows are "boards" in code.** Contracts: `packages/contracts/src/board.ts` — `BoardStep` (:37–45), `OrchestrationBoard` (:48–57, ≤20 steps), `BoardCreateCommand`/`BoardUpdateCommand`/`BoardDeleteCommand` (:494–518). `board.update` replaces name+steps wholesale; there is no partial step edit.
- **Flow commands are already dispatchable with zero new server routes**: they are members of `DispatchableClientOrchestrationCommand` (`packages/contracts/src/orchestration.ts:849–884`), accepted by `POST /api/orchestration/dispatch` (`packages/contracts/src/environmentHttp.ts:490–497`) and by `OrchestrationEngine.dispatch` offline.
- **`aqqua project add|remove|rename` is the template**: `apps/server/src/cli/project.ts` already implements probe-live-server → mint temp scoped session (`withProjectCliSessionToken` :210–221) → live HTTP call, falling back to opening the orchestration layers on SQLite directly (`runProjectMutation` :375–440).
- **The server persists flows that can never run.** Step-name uniqueness, profile existence, placeholder resolvability, and artifact-path sanitizability are checked only in the web UI (`BoardEditorDialog.logic.ts:103–143`) or at card runtime (`BoardStepEntrySaga.ts:343–380`, `boardPrompt.ts:105–112`). The CLI must validate these itself before dispatching.
- **Profiles are machine-local settings, not repo state**: `ServerSettings.agentProfiles` in `<stateDir>/settings.json` (`packages/contracts/src/settings.ts:426–437, 740–742`; `apps/server/src/config.ts:118`). Patch semantics are whole-map replacement by design (`settings.ts:884–887`). There is **no HTTP surface for settings today** — the only writers are the WS RPC `server.updateSettings` (`apps/server/src/ws.ts:1589–1598`) and hand-editing the file, which the 100 ms watcher picks up (`apps/server/src/serverSettings.ts:511–548`).
- **Profile fields** (`settings.ts:487–504`): `runtime` (session|terminal), `target` ({kind:instance,instanceId} | {kind:driver,driver}), optional `model` (omission = inherit), optional `options` (provider option selections — reasoning effort lives here), `runtimeMode`, `interactionMode`, optional `titlePrefix`. No model allowlist, deliberately.
- **CLI framework**: `effect/unstable/cli` (`Command`/`Flag`/`Argument`), root registration in `apps/server/src/bin.ts:45–58`. JSON output goes through schema-first encoding (`Schema.encodeSync(Schema.fromJsonString(...))` — the repo lints against raw `JSON.stringify`), `emit({json,value,text})` pattern as in `cli/agent.ts:263–270`.

## Command surface

### `aqqua flow`

| Command | Behavior |
| --- | --- |
| `aqqua flow list [--json]` | Flows of the resolved project (id, name, steps count, profiles used). Deleted flows excluded. |
| `aqqua flow show <id-or-name> [--json]` | Full definition. Name resolution: exact id first, then unique name match; ambiguity is an error listing ids. |
| `aqqua flow create --file <path> [--json]` | Validate definition JSON, mint `BoardId` (randomUUID, as the web UI does), dispatch `board.create`. Prints the id. |
| `aqqua flow update <id-or-name> --file <path> [--json]` | Wholesale replace name+steps via `board.update`. |
| `aqqua flow delete <id-or-name> [--json]` | Dispatch `board.delete` (soft delete). |
| `aqqua flow schema [--json]` | Print the definition shape, placeholder grammar (`${param}`, `${artifact}`, `${artifact:Step name}`, `${card_title}`), and validation rules, with a canonical example. Static text; exists so agents can discover the format without reading source. |

Definition file format (steps carry optional `id`; minted when absent, preserved when supplied so `show --json` output round-trips into `update`):

```json
{
  "name": "Ship a feature",
  "steps": [
    { "name": "Plan", "profileName": "Planning", "promptTemplate": "Plan ${card_title}: ${request}" },
    { "name": "Implement", "profileName": "implementer", "promptTemplate": "Implement the plan:\n${artifact}", "continuation": "manual" }
  ]
}
```

CLI-side validation before dispatch (on top of contract schema decode):

1. ≥1 step (schema allows 0, but `card.release` rejects empty flows — never persist one).
2. Step names unique case-insensitively (artifact references address steps by name).
3. Every step name survives `sanitizeBoardStepName` (`apps/server/src/boardArtifacts.ts:17–43`).
4. Placeholders extracted with `extractBoardTemplatePlaceholders` (`packages/shared/src/boardTemplate.ts`): `${artifact}` invalid in step 1; `${artifact:X}` must name an **earlier** step exactly; card parameters are collected and echoed in output so the author sees what fields cards will require.
5. Every `profileName` exists in `agentProfiles` (settings.json read **read-only** from the resolved state dir, decoded with the contracts `ServerSettings` schema) or is the implicit `implementer`. `--allow-unknown-profiles` downgrades this to a warning (a flow may reference a profile created later).

Transport: the shared live-or-offline machinery (see lane 0). Reads use the orchestration snapshot; writes dispatch `board.*` commands. No new server routes.

### `aqqua profile`

| Command | Behavior |
| --- | --- |
| `aqqua profile list [--json]` | Profiles from settings + the implicit built-in `implementer` (marked as such). Shows target, model (or "inherit"), runtime, runtimeMode. |
| `aqqua profile show <name> [--json]` | Full stored definition. |
| `aqqua profile create <name> --file <path> [--json]` | Decode body as an `AgentProfile` (source form), error if the name already exists. |
| `aqqua profile update <name> --file <path> [--json]` | Replace that entry; error if absent (implicit `implementer` counts as absent — updating it materializes a customized entry, matching the UI's "Customize"). |
| `aqqua profile delete <name> [--json]` | Remove the entry. Deleting a customized `implementer` reverts it to the built-in default (say so). Deleting the never-customized `implementer` is an error explaining it is built-in. |
| `aqqua profile schema [--json]` | Shape, allowed enum values, option-id conventions (`reasoningEffort` for Codex/Cursor/Grok, `effort` for Claude), canonical example. |

Profile file format = the wire/source form the contracts already decode (`AgentProfileSource` → `AgentProfile`):

```json
{
  "target": { "kind": "instance", "instanceId": "claudeAgent" },
  "model": "claude-fable-5",
  "options": [{ "id": "effort", "value": "high" }],
  "titlePrefix": "reviewer"
}
```

Transport needs **new server surface**, because settings have none:

- New `settings` group on `EnvironmentHttpApi` (`packages/contracts/src/environmentHttp.ts`), authenticated like the rest:
  - `GET /api/settings/agent-profiles`
  - `PUT /api/settings/agent-profiles/:name` (upsert one entry; body = source-form profile)
  - `DELETE /api/settings/agent-profiles/:name`
- Handler (`apps/server/src/settingsHttp.ts`) performs the read-modify-write of the whole map **inside the server** through `ServerSettingsService.updateSettings`, so the existing write semaphore serializes concurrent writers and per-name endpoints spare CLI callers the whole-map race.
- CLI live path calls these; on connection failure **or 404** (an older running server without the endpoints), it falls back to the offline path: load settings from the resolved state dir, apply the same upsert/delete, write through the same normalize/atomic-write machinery `serverSettings.ts` uses. A running server picks the file change up via its watcher — hand-editing is an explicitly supported write path.

## Lanes

Sub-agents share this worktree; lanes own disjoint files.

**Lane 0 — extract shared CLI environment access (sequential, first).**
Generalize `cli/project.ts`'s probe/mint-session/live-call/offline-fallback machinery into `apps/server/src/cli/environmentAccess.ts`; `project.ts` keeps identical behavior on top of it. Owns: `apps/server/src/cli/environmentAccess.ts` (+ test if warranted), `apps/server/src/cli/project.ts`.

**Lane A — `aqqua flow` (parallel with B, after lane 0).**
Owns: `apps/server/src/cli/flow.ts`, `apps/server/src/cli/flowDefinition.ts`, matching `.test.ts` files. Reads (never edits): contracts, `packages/shared/src/boardTemplate.ts`, `apps/server/src/boardArtifacts.ts`, lane 0's module.

**Lane B — `aqqua profile` + settings HTTP surface (parallel with A).**
Owns: `packages/contracts/src/environmentHttp.ts`, wire-schema additions in `packages/contracts/src/settings.ts`, `apps/server/src/settingsHttp.ts` (+ integration test), the mount in `apps/server/src/server.ts`, `apps/server/src/serverSettings.ts` (only if exports are needed), `apps/server/src/cli/profile.ts` (+ test).

**Orchestrator (after A+B):** register both commands in `apps/server/src/bin.ts`, seam review, combined typecheck/lint/tests.

**Lane C — docs (after integration).**
Owns: `docs/user/` (CLI sections for flows + a profiles page as fits the existing structure), `docs/reference/encyclopedia.md`, a brief mention in `AGENTS.md`'s sub-agent section. Written from the real `--help`/`schema` output.

## Verification

Focused only (`vp test run <files>`): pure validation table tests, CLI command tests with fakes (per `cli/agent.test.ts` conventions), HTTP integration test for the settings group (per `agent-control/environmentHttp.integration.test.ts`), live-vs-offline coverage where the existing `bin.test.ts` harness pattern applies. Targeted typecheck/lint on `apps/server` and `packages/contracts` at integration.

## Out of scope / follow-ups

- Convenience flags (`--model`, `--driver`, …) as an alternative to `--file` — JSON is the agent-facing contract; flags can come later.
- MCP tools for flow/profile authoring (agents get the CLI; `board_complete` remains the only board MCP tool).
- Card creation/release from the CLI (`aqqua flow run …`) — separate feature.
- Updating the out-of-repo `creating-flows` skill, whose "flows are configured in the app" delivery note this feature obsoletes.
