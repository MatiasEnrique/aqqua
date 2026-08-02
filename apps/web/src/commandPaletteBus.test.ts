import { scopeProjectRef } from "@aqqua/client-runtime/environment";
import { EnvironmentId, ProjectId } from "@aqqua/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { onOpenCommandPalette, openCommandPalette } from "./commandPaletteBus";

describe("commandPaletteBus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("carries the contextual project into the new worktree dialog intent", () => {
    vi.stubGlobal("window", new EventTarget());
    const projectRef = scopeProjectRef(
      EnvironmentId.make("environment"),
      ProjectId.make("project"),
    );
    let received: unknown;
    const unsubscribe = onOpenCommandPalette((detail) => {
      received = detail;
    });

    openCommandPalette({
      open: "new-worktree",
      context: { projectRef },
    });
    unsubscribe();

    expect(received).toEqual({
      open: "new-worktree",
      context: { projectRef },
    });
  });
});
