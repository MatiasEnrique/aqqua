import type { CardId, EnvironmentId, ProjectId } from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { CardDetailView } from "../components/board/CardDetailView";
import { SidebarInset } from "~/components/ui/sidebar";
import { useEnvironmentQuery } from "../state/query";
import { environmentShell } from "../state/shell";

export interface CardDetailSearch {
  /** Which tree row the detail slot renders — `step:1`, `sub:1:<id>`, `artifact:0`. */
  readonly sel?: string;
}

function CardDetailRouteView() {
  const params = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const environmentId = params.environmentId as EnvironmentId;
  const projectId = params.projectId as ProjectId;
  const cardId = params.cardId as CardId;
  // Board and card rows stream on the environment's shell subscription, the
  // same one the board route keeps alive.
  useEnvironmentQuery(environmentShell.stateAtom(environmentId));

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      <CardDetailView
        environmentId={environmentId}
        projectId={projectId}
        cardId={cardId}
        selectionParam={search.sel ?? null}
        onSelectionChange={(sel) => {
          void navigate({ to: ".", search: { sel }, replace: true });
        }}
      />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/board/$environmentId/$projectId_/card/$cardId")({
  validateSearch: (search: Record<string, unknown>): CardDetailSearch =>
    typeof search.sel === "string" ? { sel: search.sel } : {},
  component: CardDetailRouteView,
});
