import { EnvironmentId, ThreadId } from "@aqqua/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@aqqua/shared/keybindings";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../GitActionsControl", () => ({ default: () => null }));
vi.mock("../../state/environments", () => ({ usePrimaryEnvironmentId: () => null }));
vi.mock("~/hooks/useAqquaProjectFileScripts", () => ({
  useAqquaProjectFileScripts: () => [],
}));

import { ChatHeader } from "./ChatHeader";

const render = (rail: boolean) =>
  renderToStaticMarkup(
    <ChatHeader
      activeThreadEnvironmentId={EnvironmentId.make("environment-primary")}
      activeThreadId={ThreadId.make("thread-primary")}
      activeProjectName="aqqua"
      activeProjectCwd="/repo/aqqua"
      openInCwd={null}
      activeProjectScripts={undefined}
      preferredScriptId={null}
      keybindings={DEFAULT_RESOLVED_KEYBINDINGS}
      availableEditors={[]}
      rail={rail}
      gitCwd={null}
      onNewThreadInProject={() => {}}
      onRunProjectScript={() => {}}
      onAddProjectScript={async () => {
        throw new Error("unreachable");
      }}
      onUpdateProjectScript={async () => {
        throw new Error("unreachable");
      }}
      onDeleteProjectScript={async () => {
        throw new Error("unreachable");
      }}
    />,
  );

describe("ChatHeader", () => {
  it("keeps the new-thread action out of the workspace rail", () => {
    expect(render(true)).not.toContain('aria-label="New thread in project"');
    expect(render(false)).toContain('aria-label="New thread in project"');
  });
});
