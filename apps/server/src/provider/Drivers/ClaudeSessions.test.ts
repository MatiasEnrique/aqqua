import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderInstanceId } from "@aqqua/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  discoverClaudeSessions,
  matchesClaudeResumeCursor,
  readClaudeSession,
} from "./ClaudeSessions.ts";

const CLI_SESSION_ID = "00000000-0000-4000-8000-000000000001";
const SDK_SESSION_ID = "00000000-0000-4000-8000-000000000002";
const SIDECHAIN_SESSION_ID = "00000000-0000-4000-8000-000000000003";
const MALFORMED_SESSION_ID = "00000000-0000-4000-8000-000000000004";
const OWNED_SESSION_ID = "00000000-0000-4000-8000-000000000005";
const OTHER_SESSION_ID = "00000000-0000-4000-8000-000000000006";
const LARGE_SESSION_ID = "00000000-0000-4000-8000-000000000007";
const RESUME_SESSION_ID = "00000000-0000-4000-8000-000000000008";

const record = (input: {
  readonly type: "user" | "assistant";
  readonly uuid: string;
  readonly sessionId: string;
  readonly cwd: string;
  readonly entrypoint: "cli" | "sdk-ts";
  readonly text: string;
  readonly isSidechain?: boolean;
}) => ({
  type: input.type,
  uuid: input.uuid,
  sessionId: input.sessionId,
  cwd: input.cwd,
  entrypoint: input.entrypoint,
  isSidechain: input.isSidechain ?? false,
  timestamp: "2026-08-04T12:00:00.000Z",
  gitBranch: "main",
  message: {
    content: input.type === "user" ? input.text : [{ type: "text", text: input.text }],
  },
});

const writeSession = Effect.fn("writeSession")(function* (
  configDir: string,
  cwd: string,
  sessionId: string,
  records: ReadonlyArray<unknown>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projectSlug = cwd.replace(/[^a-zA-Z0-9]/g, "-");
  const projectDir = path.join(configDir, "projects", projectSlug);
  yield* fileSystem.makeDirectory(projectDir, { recursive: true });
  yield* fileSystem.writeFileString(
    path.join(projectDir, `${sessionId}.jsonl`),
    records.map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry))).join("\n"),
  );
});

it.layer(NodeServices.layer)("ClaudeSessions", (it) => {
  it.effect(
    "lists only exact-cwd CLI sessions and excludes SDK, sidechain, malformed, and owned ids",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "aqqua-claude-sessions-",
        });
        const configDir = path.join(root, "claude");
        const cwd = path.join(root, "workspace");
        const otherCwd = path.join(root, "other");

        yield* writeSession(configDir, cwd, CLI_SESSION_ID, [
          record({
            type: "user",
            uuid: "u1",
            sessionId: CLI_SESSION_ID,
            cwd,
            entrypoint: "cli",
            text: "CLI title",
          }),
          record({
            type: "assistant",
            uuid: "a1",
            sessionId: CLI_SESSION_ID,
            cwd,
            entrypoint: "cli",
            text: "Answer",
          }),
        ]);
        yield* writeSession(configDir, cwd, SDK_SESSION_ID, [
          record({
            type: "user",
            uuid: "u2",
            sessionId: SDK_SESSION_ID,
            cwd,
            entrypoint: "sdk-ts",
            text: "SDK title",
          }),
        ]);
        yield* writeSession(configDir, cwd, SIDECHAIN_SESSION_ID, [
          record({
            type: "user",
            uuid: "u3",
            sessionId: SIDECHAIN_SESSION_ID,
            cwd,
            entrypoint: "cli",
            text: "Subagent",
            isSidechain: true,
          }),
        ]);
        yield* writeSession(configDir, cwd, MALFORMED_SESSION_ID, ["{not json"]);
        yield* writeSession(configDir, cwd, "not-a-uuid", [
          record({
            type: "user",
            uuid: "invalid-session-u1",
            sessionId: "not-a-uuid",
            cwd,
            entrypoint: "cli",
            text: "Adapter would not resume this id",
          }),
        ]);
        yield* writeSession(configDir, cwd, OWNED_SESSION_ID, [
          record({
            type: "user",
            uuid: "u4",
            sessionId: OWNED_SESSION_ID,
            cwd,
            entrypoint: "cli",
            text: "Owned",
          }),
        ]);
        yield* writeSession(configDir, otherCwd, OTHER_SESSION_ID, [
          record({
            type: "user",
            uuid: "u5",
            sessionId: OTHER_SESSION_ID,
            cwd: otherCwd,
            entrypoint: "cli",
            text: "Other",
          }),
        ]);

        const sessions = yield* discoverClaudeSessions({
          config: { homePath: configDir },
          cwds: [cwd],
        });

        const externalSessions = sessions.filter(
          (session) => !matchesClaudeResumeCursor(session.sessionId, { resume: OWNED_SESSION_ID }),
        );

        assert.deepEqual(
          externalSessions.map((session) => session.sessionId),
          [CLI_SESSION_ID],
        );
        assert.equal(externalSessions[0]?.cwd, cwd);
        assert.equal(externalSessions[0]?.title, "CLI title");
        // Discovery is bounded; the exact count comes from the lazy read.
        assert.equal(externalSessions[0]?.messageCount, 0);
      }),
  );

  it.effect("uses bounded head/tail metadata instead of loading the transcript body", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "aqqua-claude-sessions-" });
      const configDir = path.join(root, "claude");
      const cwd = path.join(root, "workspace");
      const sessionId = LARGE_SESSION_ID;
      const head = record({
        type: "user",
        uuid: "u1",
        sessionId,
        cwd,
        entrypoint: "cli",
        text: "Bounded title",
      });
      const tail = record({
        type: "assistant",
        uuid: "a1",
        sessionId,
        cwd,
        entrypoint: "cli",
        text: "Tail",
      });
      yield* writeSession(configDir, cwd, sessionId, [head, "x".repeat(256 * 1024), tail]);

      const sessions = yield* discoverClaudeSessions({
        config: { homePath: configDir },
        cwds: [cwd],
      });

      assert.equal(sessions[0]?.title, "Bounded title");
    }),
  );

  it.effect("reads the visible transcript lazily and fixes it at the requested boundary", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "aqqua-claude-sessions-" });
      const configDir = path.join(root, "claude");
      const cwd = path.join(root, "workspace");
      const sessionId = RESUME_SESSION_ID;
      yield* writeSession(configDir, cwd, sessionId, [
        record({ type: "user", uuid: "u1", sessionId, cwd, entrypoint: "cli", text: "Question" }),
        record({
          type: "assistant",
          uuid: "a1",
          sessionId,
          cwd,
          entrypoint: "cli",
          text: "Answer",
        }),
        record({
          type: "user",
          uuid: "u2",
          sessionId,
          cwd,
          entrypoint: "sdk-ts",
          text: "Later aqqua turn",
        }),
      ]);

      const loaded = yield* readClaudeSession({
        instanceId: ProviderInstanceId.make("claude"),
        config: { homePath: configDir },
        sessionId,
        boundaryUuid: "a1",
      });

      assert.deepEqual(
        loaded.result.messages.map((message) => message.messageId),
        ["u1", "a1"],
      );
      assert.equal(loaded.result.session.messageCount, 2);
      assert.equal(loaded.result.boundaryUuid, "a1");
      assert.deepEqual(loaded.resume, { resumeSessionAt: "a1", turnCount: 1 });
    }),
  );

  it.effect("omits SDK-authored turns interleaved before the boundary", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "aqqua-claude-sessions-" });
      const configDir = path.join(root, "claude");
      const cwd = path.join(root, "workspace");
      const sessionId = RESUME_SESSION_ID;
      // Resuming an adopted session through the SDK appends to the same file,
      // so CLI and SDK turns interleave. Only the CLI conversation is adopted.
      yield* writeSession(configDir, cwd, sessionId, [
        record({ type: "user", uuid: "u1", sessionId, cwd, entrypoint: "cli", text: "Question" }),
        record({
          type: "assistant",
          uuid: "sdk1",
          sessionId,
          cwd,
          entrypoint: "sdk-ts",
          text: "aqqua answer",
        }),
        record({
          type: "assistant",
          uuid: "a1",
          sessionId,
          cwd,
          entrypoint: "cli",
          text: "Answer",
        }),
      ]);

      const loaded = yield* readClaudeSession({
        instanceId: ProviderInstanceId.make("claude"),
        config: { homePath: configDir },
        sessionId,
        boundaryUuid: "a1",
      });

      assert.deepEqual(
        loaded.result.messages.map((message) => message.messageId),
        ["u1", "a1"],
      );
    }),
  );
});
