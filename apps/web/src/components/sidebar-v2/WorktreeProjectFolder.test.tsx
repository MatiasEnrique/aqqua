import type { EnvironmentId } from "@aqqua/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../ProjectFavicon", () => ({
  ProjectFavicon: ({ cwd }: { cwd: string }) => <span data-project-favicon={cwd} />,
}));

const { WorktreeProjectFolder } = await import("./WorktreeProjectFolder");

const render = (expanded: boolean) =>
  renderToStaticMarkup(
    <WorktreeProjectFolder
      displayName="aqqua"
      environmentId={"local" as EnvironmentId}
      workspaceRoot="/repos/aqqua"
      projectKey="aqqua"
      worktreeCount={3}
      state="working"
      expanded={expanded}
      onToggle={() => {}}
      onContextMenu={() => {}}
      actions={<button type="button">New worktree</button>}
    >
      <li data-testid="worktree-card-aqqua:main">main</li>
    </WorktreeProjectFolder>,
  );

describe("WorktreeProjectFolder", () => {
  it("names the project and carries its icon", () => {
    const markup = render(true);

    expect(markup).toContain("aqqua");
    expect(markup).toContain('data-project-favicon="/repos/aqqua"');
  });

  it("renders its checkouts while open", () => {
    const markup = render(true);

    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('data-testid="worktree-card-aqqua:main"');
  });

  it("hides its checkouts while shut", () => {
    const markup = render(false);

    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('data-testid="worktree-card-aqqua:main"');
  });

  it("summarises state and count only while shut, where the rows cannot", () => {
    // Open, every checkout states its own case one row down.
    expect(render(false)).toContain(">3<");
    expect(render(true)).not.toContain(">3<");
  });

  it("labels the toggle with the action it performs", () => {
    expect(render(false)).toContain('aria-label="Expand project aqqua"');
    expect(render(true)).toContain('aria-label="Collapse project aqqua"');
  });

  it("keeps the project's own actions reachable from the folder row", () => {
    expect(render(false)).toContain("New worktree");
  });
});
