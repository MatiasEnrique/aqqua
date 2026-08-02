import { EnvironmentId } from "@aqqua/contracts";
import { describe, expect, it } from "vite-plus/test";

import { scopedWorkspaceKey } from "./scoped.ts";

describe("scopedWorkspaceKey", () => {
  it("normalizes separators and trailing slashes while retaining the environment", () => {
    const environmentId = EnvironmentId.make("local");

    expect(scopedWorkspaceKey({ environmentId, workspaceRoot: "/tmp/project/" })).toBe(
      scopedWorkspaceKey({ environmentId, workspaceRoot: "\\tmp\\project" }),
    );
    expect(
      scopedWorkspaceKey({
        environmentId: EnvironmentId.make("remote"),
        workspaceRoot: "/tmp/project",
      }),
    ).not.toBe(scopedWorkspaceKey({ environmentId, workspaceRoot: "/tmp/project" }));
  });
});
