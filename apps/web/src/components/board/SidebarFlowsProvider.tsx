import { scopeProjectRef } from "@aqqua/client-runtime/environment";
import type { BoardId, EnvironmentId, ProjectId } from "@aqqua/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { createContext, lazy, Suspense, use, useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { useProjectCards, useProjectsBoards } from "../../state/boards";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import {
  resolveSelectedFlow,
  type FlowChoice,
  type FlowGroup,
  type FlowProject,
} from "./flowSelection";
import {
  FlowEditButton,
  FlowNewCardButton,
  FlowNewFlowButton,
  FlowPicker,
} from "./SidebarBoardRows";
import { useFlowEditorController } from "./useFlowEditorController";

const BoardEditorDialog = lazy(() =>
  import("./BoardEditorDialog").then((module) => ({
    default: module.BoardEditorDialog,
  })),
);

interface SidebarFlowsValue {
  readonly groups: ReadonlyArray<FlowGroup>;
  /** The one flow the sidebar shows, or `null` while no project holds one. */
  readonly selected: FlowChoice | null;
  readonly cardDialogOpen: boolean;
  readonly setCardDialogOpen: (open: boolean) => void;
  readonly openFlow: (choice: FlowChoice) => void;
  readonly openNewFlow: (project: FlowProject) => void;
  readonly openEditFlow: (choice: FlowChoice) => void;
}

const SidebarFlowsContext = createContext<SidebarFlowsValue | null>(null);

function useSidebarFlows(): SidebarFlowsValue {
  const value = use(SidebarFlowsContext);
  if (value === null) {
    throw new Error("Flows sidebar pieces must render inside SidebarFlowsProvider.");
  }
  return value;
}

/**
 * The state behind the Flows surface, held above the sidebar's own layout.
 *
 * The scope row belongs in the sidebar's fixed header — the same slot the
 * thread list's project filter uses — while the cards belong in the scrolling
 * body. One flow feeds both, so the selection lives here rather than in either
 * of them, and the flow dialogs come along so they survive whichever part of
 * the sidebar is on screen.
 */
export function SidebarFlowsProvider({
  projects,
  children,
}: {
  readonly projects: ReadonlyArray<FlowProject>;
  readonly children: ReactNode;
}) {
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const [chosenBoardId, setChosenBoardId] = useState<BoardId | null>(null);
  const [cardDialogOpen, setCardDialogOpen] = useState(false);
  const projectRefs = useMemo(
    () => projects.map((project) => scopeProjectRef(project.environmentId, project.id)),
    [projects],
  );
  const projectsBoards = useProjectsBoards(projectRefs);
  const groups = useMemo<ReadonlyArray<FlowGroup>>(
    () =>
      projects.map((project, index) => ({
        project,
        flows: projectsBoards[index]?.boards ?? [],
      })),
    [projects, projectsBoards],
  );

  // The route already names a project, and a card route names a flow through
  // the card it opens — both beat the fallback of "the first flow anywhere".
  const routedProject = useMemo(
    () =>
      projects.find(
        (project) =>
          project.environmentId === params.environmentId && project.id === params.projectId,
      ) ?? null,
    [params.environmentId, params.projectId, projects],
  );
  const routedProjectRef = useMemo(
    () =>
      routedProject === null
        ? null
        : scopeProjectRef(routedProject.environmentId, routedProject.id),
    [routedProject],
  );
  const routedCards = useProjectCards(routedProjectRef);
  const routedBoardId =
    params.cardId === undefined
      ? null
      : (routedCards.find((card) => card.id === params.cardId)?.boardId ?? null);

  const selected = useMemo(
    () =>
      resolveSelectedFlow({
        groups,
        chosenBoardId,
        routedBoardId,
        routedProjectKey: routedProject?.projectKey ?? null,
      }),
    [chosenBoardId, groups, routedBoardId, routedProject],
  );

  const openFlow = useCallback(
    (choice: FlowChoice) => {
      setChosenBoardId(choice.flow.id);
      if (
        choice.project.environmentId === params.environmentId &&
        choice.project.id === params.projectId &&
        params.cardId === undefined
      ) {
        return;
      }
      // Switching flows drops whatever card was open: it belongs to the flow
      // being left, not the one being opened.
      void navigate({
        to: "/board/$environmentId/$projectId",
        params: {
          environmentId: choice.project.environmentId,
          projectId: choice.project.id,
        },
      });
    },
    [navigate, params.cardId, params.environmentId, params.projectId],
  );

  const flowEditor = useFlowEditorController({
    onFlowCreated: (boardId, project) => {
      setChosenBoardId(boardId);
      if (project.environmentId === params.environmentId && project.id === params.projectId) return;
      void navigate({
        to: "/board/$environmentId/$projectId",
        params: { environmentId: project.environmentId, projectId: project.id },
      });
    },
    // Dropping the pick lets the resolver fall through to whatever flow is
    // still there, rather than leaving the sidebar pointed at nothing.
    onFlowDeleted: (boardId) => {
      setChosenBoardId((current) => (current === boardId ? null : current));
      if (params.cardId === undefined) return;
      void navigate({
        to: "/board/$environmentId/$projectId",
        params: {
          environmentId: params.environmentId as EnvironmentId,
          projectId: params.projectId as ProjectId,
        },
      });
    },
  });

  // The confirmation names what goes with the flow, so it counts the cards in
  // the flow's own project rather than whichever project the route names.
  const deletion = flowEditor.deletion;
  const deletionProjectRef = useMemo(
    () =>
      deletion === null
        ? null
        : scopeProjectRef(deletion.project.environmentId, deletion.project.id),
    [deletion],
  );
  const deletionProjectCards = useProjectCards(deletionProjectRef);
  const deletionCardCount =
    deletion === null
      ? 0
      : deletionProjectCards.filter(
          (card) => card.boardId === deletion.flow.id && card.archivedAt === null,
        ).length;
  const editorTarget = flowEditor.target;
  const editorFlow = editorTarget?.flow ?? null;

  const openNewFlow = flowEditor.openNewFlow;
  const openEditFlow = flowEditor.openEditFlow;
  const value = useMemo<SidebarFlowsValue>(
    () => ({
      groups,
      selected,
      cardDialogOpen,
      setCardDialogOpen,
      openFlow,
      openNewFlow,
      openEditFlow: (choice) => openEditFlow(choice.project, choice.flow),
    }),
    [cardDialogOpen, groups, openEditFlow, openFlow, openNewFlow, selected],
  );

  return (
    <SidebarFlowsContext value={value}>
      {children}
      {editorTarget === null ? null : (
        <Suspense fallback={null}>
          <BoardEditorDialog
            open
            board={editorTarget.flow}
            environmentId={editorTarget.project.environmentId}
            projectTitle={editorTarget.project.displayName}
            projectOptions={editorTarget.flow === null ? projects : undefined}
            selectedProjectKey={editorTarget.project.projectKey}
            onProjectChange={flowEditor.setTargetProject}
            workspaceRoot={editorTarget.project.workspaceRoot}
            onOpenChange={(open) => {
              if (!open) flowEditor.close();
            }}
            onSubmit={flowEditor.submit}
            onDelete={
              editorFlow === null
                ? undefined
                : () => flowEditor.requestDelete(editorTarget.project, editorFlow)
            }
          />
        </Suspense>
      )}
      <AlertDialog
        open={deletion !== null}
        onOpenChange={(open) => {
          if (!open) flowEditor.cancelDelete();
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete '{deletion?.flow.name}'?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletionCardCount === 0
                ? "The flow and its step templates leave the sidebar. Nothing else is touched."
                : deletionCardCount === 1
                  ? "The flow leaves the sidebar and takes its one card with it. That card's worktree and branch stay in the repository — delete the card first if you want it cleaned up."
                  : `The flow leaves the sidebar and takes its ${deletionCardCount} cards with it. Their worktrees and branches stay in the repository — delete the cards first if you want them cleaned up.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              disabled={flowEditor.isDeleting}
              onClick={() => {
                void flowEditor.confirmDelete();
              }}
            >
              {flowEditor.isDeleting ? "Deleting…" : "Delete flow"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SidebarFlowsContext>
  );
}

/**
 * The Flows scope control, for the same sidebar header row the thread list
 * fills with its project filter: the flow picker takes the wide slot, and the
 * flow's own actions take the icon slots the project actions use.
 */
export function SidebarFlowScopeRow() {
  const flows = useSidebarFlows();
  const selected = flows.selected;
  const newFlowProject = selected?.project ?? flows.groups[0]?.project ?? null;
  return (
    <>
      <div className="min-w-0 flex-1">
        <FlowPicker groups={flows.groups} selected={selected} onSelect={flows.openFlow} />
      </div>
      {selected === null ? null : (
        <>
          <FlowEditButton
            flowName={selected.flow.name}
            onClick={() => flows.openEditFlow(selected)}
          />
          <FlowNewCardButton
            flowName={selected.flow.name}
            onClick={() => flows.setCardDialogOpen(true)}
          />
        </>
      )}
      {/* A new flow needs a project rather than a flow, so this button stays
          even when no flow is selected: the project it starts in is the one on
          screen, and the editor's own picker moves it. */}
      {newFlowProject === null ? null : (
        <FlowNewFlowButton
          projectName={newFlowProject.displayName}
          onClick={() => flows.openNewFlow(newFlowProject)}
        />
      )}
    </>
  );
}

export { useSidebarFlows };
