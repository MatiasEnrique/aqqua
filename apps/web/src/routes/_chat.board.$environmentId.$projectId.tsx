import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { BoardView } from "../components/board/BoardView";
import { SidebarInset } from "~/components/ui/sidebar";
import { useEnvironmentQuery } from "../state/query";
import { environmentShell } from "../state/shell";

function BoardRouteView() {
  const params = Route.useParams();
  const environmentId = params.environmentId as EnvironmentId;
  const projectId = params.projectId as ProjectId;
  // Subscribing to the environment's shell is what keeps board and card rows
  // streaming; the board view itself only reads the resulting snapshot.
  useEnvironmentQuery(environmentShell.stateAtom(environmentId));

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      <BoardView environmentId={environmentId} projectId={projectId} />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/board/$environmentId/$projectId")({
  component: BoardRouteView,
});
