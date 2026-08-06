import { assert, describe, it } from "@effect/vitest";

import * as CodexError from "./errors.ts";

describe("CodexAppServerSpawnError", () => {
  it("names the reason the spawn failed, not just the command", () => {
    const error = new CodexError.CodexAppServerSpawnError({
      command: "codex app-server",
      cause: new Error("NotFound: FileSystem.access (/repos/aqqua)"),
    });

    // Callers reduce this to `error.message`, so a cause left out here is a
    // cause the user never sees — and "failed to spawn codex" sends them
    // hunting for a binary that was on PATH the whole time.
    assert.strictEqual(
      error.message,
      "Failed to spawn Codex App Server process for command: codex app-server: NotFound: FileSystem.access (/repos/aqqua)",
    );
  });

  it("falls back to the bare statement when the cause says nothing", () => {
    assert.strictEqual(
      new CodexError.CodexAppServerSpawnError({ command: "codex app-server", cause: {} }).message,
      "Failed to spawn Codex App Server process for command: codex app-server",
    );
    assert.strictEqual(
      new CodexError.CodexAppServerSpawnError({
        command: "codex app-server",
        cause: new Error("  "),
      }).message,
      "Failed to spawn Codex App Server process for command: codex app-server",
    );
    assert.strictEqual(
      new CodexError.CodexAppServerSpawnError({ cause: new Error("boom") }).message,
      "Failed to spawn Codex App Server process: boom",
    );
  });

  it("describes a cause thrown as a bare string", () => {
    // Not every throw site wraps in an Error, and this path is supported.
    assert.strictEqual(
      new CodexError.CodexAppServerSpawnError({
        command: "codex app-server",
        cause: "ENOENT",
      }).message,
      "Failed to spawn Codex App Server process for command: codex app-server: ENOENT",
    );
  });
});
