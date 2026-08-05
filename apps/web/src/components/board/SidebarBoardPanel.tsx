import { scopeProjectRef } from "@aqqua/client-runtime/environment";
import { canDeleteCard, cardOperation } from "@aqqua/client-runtime/state/boards";
import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@aqqua/contracts";
import { CheckCircle2Icon, CheckIcon, ChevronDownIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import { lazy, Suspense, useMemo } from "react";

import { cn } from "~/lib/utils";
import { useEnvironmentsBoards } from "../../state/boards";
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
import { SidebarGroup } from "../ui/sidebar";
import { FlowCardBranch, FlowCardFailureNote, FlowCardStateBadge } from "../sidebar/card";
import { Spinner } from "../ui/spinner";
import { cardOperationPresentation, formatElapsed } from "./BoardRunTable.logic";
import { CardCreateDialog } from "./CardCreateDialog";
import { BoardSelector, InFlightCardRow, SectionLabel } from "./SidebarBoardRows";
import { useSidebarProjectBoardController } from "./useSidebarProjectBoardController";
import { useSidebarRelativeTimeTick } from "./useSidebarRelativeTimeTick";

const BoardEditorDialog = lazy(() =>
  import("./BoardEditorDialog").then((module) => ({
    default: module.BoardEditorDialog,
  })),
);

function _cardCommandFailureDescription(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (typeof error === "string" && error.trim().length > 0) return error;
  if (typeof error === "object" && error !== null) {
    const message = (error as { readonly message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) return message;
    const detail = (error as { readonly detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim().length > 0) return detail;
  }
  return "The server rejected the card command without a reason.";
}

/** Coarse single-unit age for completed/settled rows: `2d`, `5h`, `12m`. */
function cardAge(at: string | null, nowMs: number): string | null {
  const elapsed = formatElapsed(at, nowMs);
  return elapsed?.split(" ")[0] ?? null;
}

function RelativeCardAge({ at }: { readonly at: string | null }) {
  const nowMs = useSidebarRelativeTimeTick();
  return cardAge(at, nowMs);
}

export interface BoardPanelProject {
  readonly environmentId: EnvironmentId;
  readonly id: ProjectId;
  readonly projectKey: string;
  readonly displayName: string;
}

/**
 * Board mode for the app sidebar. The project scope drives what shows:
 * a scoped project shows its boards, and "All projects" means exactly that —
 * one section per project, each with its own board selector.
 */
export function SidebarBoardPanel({
  scopedProjectRef,
  projects,
}: {
  readonly scopedProjectRef: ScopedProjectRef | null;
  readonly projects: ReadonlyArray<BoardPanelProject>;
}) {
  const scopedProject = useMemo(
    () =>
      scopedProjectRef === null
        ? null
        : (projects.find(
            (project) =>
              project.environmentId === scopedProjectRef.environmentId &&
              project.id === scopedProjectRef.projectId,
          ) ?? null),
    [projects, scopedProjectRef],
  );

  const environmentIds = useMemo(
    () => [...new Set(projects.map((project) => project.environmentId))],
    [projects],
  );
  const allEnvironmentBoards = useEnvironmentsBoards(environmentIds);

  if (scopedProjectRef !== null) {
    return (
      <ProjectBoardSection
        projectRef={scopedProjectRef}
        projectTitle={scopedProject?.displayName ?? scopedProjectRef.projectId}
        showWhenMissing
      />
    );
  }

  return (
    <>
      {allEnvironmentBoards.length === 0 ? (
        <SidebarGroup className="px-2 pt-0">
          <p className="px-2 text-sidebar-muted-foreground text-xs">
            No flows in any project yet. Scope to a project to create its first flow.
          </p>
        </SidebarGroup>
      ) : null}
      {projects.map((project) => (
        <ProjectBoardSection
          key={project.projectKey}
          projectRef={scopeProjectRef(project.environmentId, project.id)}
          projectTitle={project.displayName}
          showWhenMissing={false}
        />
      ))}
    </>
  );
}

/**
 * One project's boards: the selector on top (a project can hold several
 * boards), then the selected board's cards grouped the way the design reads
 * them — Needs you, Active, To-Do (Start inline), Settled last.
 */
function ProjectBoardSection({
  projectRef,
  projectTitle,
  showWhenMissing,
}: {
  readonly projectRef: ScopedProjectRef;
  readonly projectTitle: string;
  /** Scoped view explains a missing board; the all-projects list skips it. */
  readonly showWhenMissing: boolean;
}) {
  const controller = useSidebarProjectBoardController({ projectRef });
  const {
    activeCards,
    attachAnimatedList,
    board,
    boardNameFor,
    boards,
    cardDialogOpen,
    deleteCardRun,
    editorTarget,
    environmentId,
    handleBoardSubmit,
    handleCardSubmit,
    isAllBoards,
    needsYouCards,
    openCard,
    pendingCardIds,
    pendingDelete,
    project,
    releaseCard,
    retryDeleteCleanup,
    sections,
    selectedCardId,
    setCardDialogOpen,
    setChosenBoard,
    setEditorTarget,
    setPendingDelete,
    setSettledCollapsed,
    settleDoneCard,
    settledCollapsed,
    stepNamesFor,
    unsettleCard,
    withPendingCard,
  } = controller;

  if (boards.length === 0 && !showWhenMissing) return null;

  return (
    <SidebarGroup className="gap-3 px-2 pt-0 pb-4">
      <BoardSelector
        boards={boards}
        board={board}
        allSelected={isAllBoards}
        projectTitle={projectTitle}
        onSelectBoard={setChosenBoard}
        onNewCard={() => setCardDialogOpen(true)}
        onEditBoard={() => {
          if (board !== null) setEditorTarget({ board });
        }}
        onNewBoard={() => setEditorTarget({ board: null })}
      />

      {boards.length > 0 &&
      needsYouCards.length +
        activeCards.length +
        sections.todo.length +
        sections.done.length +
        sections.settled.length +
        sections.deleting.length ===
        0 ? (
        <p className="px-2 text-sidebar-muted-foreground text-xs">
          No cards yet. Add one to fill the backlog.
        </p>
      ) : null}

      {needsYouCards.length > 0 ? (
        <section ref={attachAnimatedList} className="flex flex-col gap-0.5">
          <SectionLabel className="text-warning-foreground">
            Needs you · {needsYouCards.length}
          </SectionLabel>
          {needsYouCards.map((card) => (
            <InFlightCardRow
              key={card.id}
              card={card}
              stepNames={stepNamesFor(card)}
              boardName={boardNameFor(card)}
              selected={card.id === selectedCardId}
              onOpen={() => openCard(card.id)}
              onDelete={
                canDeleteCard(card)
                  ? () => setPendingDelete({ id: card.id, title: card.title })
                  : null
              }
              pending={pendingCardIds.has(card.id)}
            />
          ))}
        </section>
      ) : null}

      {activeCards.length > 0 ? (
        <section ref={attachAnimatedList} className="flex flex-col gap-0.5">
          <SectionLabel className="text-info-foreground">
            Active · {activeCards.length}
          </SectionLabel>
          {activeCards.map((card) => (
            <InFlightCardRow
              key={card.id}
              card={card}
              stepNames={stepNamesFor(card)}
              boardName={boardNameFor(card)}
              selected={card.id === selectedCardId}
              onOpen={() => openCard(card.id)}
              onDelete={
                canDeleteCard(card)
                  ? () => setPendingDelete({ id: card.id, title: card.title })
                  : null
              }
              pending={pendingCardIds.has(card.id)}
            />
          ))}
        </section>
      ) : null}

      {sections.todo.length > 0 ? (
        <section ref={attachAnimatedList} className="flex flex-col gap-0.5">
          <SectionLabel
            className="text-sidebar-muted-foreground"
            trailing={<span className="text-sidebar-muted-foreground/60">backlog</span>}
          >
            To-Do · {sections.todo.length}
          </SectionLabel>
          {sections.todo.map((card) => {
            // Release is claimed before the snapshot lands, so the operation —
            // not the snapshot — is what says this card is already on its way.
            const operation = cardOperation(card);
            return (
              <div key={card.id}>
                <div
                  className={cn(
                    "group/todo flex flex-col gap-0.5 rounded-lg py-1.5 pr-1.5 pl-2 transition-colors hover:bg-sidebar-row-hover",
                    card.id === selectedCardId && "bg-sidebar-row-selected",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left text-[13px] text-sidebar-foreground/90 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => openCard(card.id)}
                    >
                      {card.title}
                    </button>
                    <FlowCardStateBadge card={card} />
                    {operation !== null || pendingCardIds.has(card.id) ? (
                      // Release runs server-side (worktree + checkout + setup) after
                      // the RPC returns — the row keeps saying so until the card
                      // enters its first step and leaves To-Do.
                      <span className="flex shrink-0 items-center gap-1 px-1 text-sidebar-muted-foreground text-xs">
                        <Spinner className="size-3" />
                        {operation === null
                          ? "Starting…"
                          : `${cardOperationPresentation(operation).label}…`}
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="shrink-0 rounded-sm px-1 font-medium text-primary text-xs outline-none transition-[color,scale] duration-150 ease-out hover:text-primary/80 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] motion-reduce:transform-none disabled:opacity-50"
                          onClick={() => {
                            void withPendingCard(card.id, () =>
                              releaseCard({
                                environmentId,
                                input: { cardId: card.id },
                              }),
                            );
                          }}
                        >
                          Start
                        </button>
                        {canDeleteCard(card) ? (
                          <button
                            type="button"
                            aria-label={`Delete '${card.title}'`}
                            title={`Delete ${card.title}`}
                            className="flex size-5 shrink-0 items-center justify-center rounded-sm opacity-0 outline-none transition-[opacity,background-color] group-hover/todo:opacity-100 pointer-coarse:opacity-100 hover:bg-destructive/10 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:text-sidebar-muted-foreground hover:[&_svg]:text-destructive-foreground"
                            onClick={() =>
                              setPendingDelete({
                                id: card.id,
                                title: card.title,
                              })
                            }
                          >
                            <Trash2Icon aria-hidden className="size-3" />
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>
                  {/* A reset card keeps its checkout, so a To-Do row can still
                      name the worktree its next run will pick back up. */}
                  <FlowCardBranch card={card} />
                </div>
                <FlowCardFailureNote card={card} />
              </div>
            );
          })}
        </section>
      ) : null}

      {sections.done.length > 0 ? (
        <section ref={attachAnimatedList} className="flex flex-col gap-0.5">
          <SectionLabel className="text-success-foreground">
            Done · {sections.done.length}
          </SectionLabel>
          {sections.done.map((card) => (
            <div key={card.id}>
              <div
                className={cn(
                  "group/done flex flex-col gap-0.5 rounded-lg py-1.5 pr-1.5 pl-2 transition-colors hover:bg-sidebar-row-hover",
                  card.id === selectedCardId && "bg-sidebar-row-selected",
                )}
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2Icon aria-hidden className="size-3.5 shrink-0 text-success" />
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-[13px] text-sidebar-foreground/90 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => openCard(card.id)}
                  >
                    {card.title}
                  </button>
                  <span className="shrink-0 font-mono text-[10px] text-sidebar-muted-foreground/70 tabular-nums">
                    <RelativeCardAge at={card.completedAt} />
                  </span>
                  <FlowCardStateBadge card={card} />
                  <button
                    type="button"
                    aria-label={`Settle '${card.title}'`}
                    title={`Settle ${card.title}`}
                    disabled={pendingCardIds.has(card.id) || cardOperation(card) !== null}
                    className="flex size-5 shrink-0 items-center justify-center rounded-sm opacity-0 outline-none transition-[opacity,background-color] group-hover/done:opacity-100 pointer-coarse:opacity-100 hover:bg-sidebar-accent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30 [&_svg]:text-sidebar-muted-foreground hover:[&_svg]:text-sidebar-foreground"
                    onClick={() => {
                      void settleDoneCard(card);
                    }}
                  >
                    <CheckIcon aria-hidden className="size-3" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete '${card.title}'`}
                    title={`Delete ${card.title}`}
                    disabled={pendingCardIds.has(card.id) || cardOperation(card) !== null}
                    className="flex size-5 shrink-0 items-center justify-center rounded-sm opacity-0 outline-none transition-[opacity,background-color] group-hover/done:opacity-100 pointer-coarse:opacity-100 hover:bg-destructive/10 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30 [&_svg]:text-sidebar-muted-foreground hover:[&_svg]:text-destructive-foreground"
                    onClick={() => setPendingDelete({ id: card.id, title: card.title })}
                  >
                    <Trash2Icon aria-hidden className="size-3" />
                  </button>
                </div>
                <FlowCardBranch card={card} className="pl-5.5" />
              </div>
              <FlowCardFailureNote card={card} />
            </div>
          ))}
        </section>
      ) : null}

      {sections.settled.length > 0 ? (
        <section className="flex flex-col gap-0.5">
          <button
            type="button"
            aria-expanded={!settledCollapsed}
            className="flex items-center gap-2 rounded-sm px-2 pb-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setSettledCollapsed((current) => !current)}
          >
            <span className="shrink-0 text-[13px] text-sidebar-muted-foreground">
              {settledCollapsed ? `Settled (${sections.settled.length})` : "Settled"}
            </span>
            <span aria-hidden className="h-px min-w-0 flex-1 bg-sidebar-border" />
            <ChevronDownIcon
              aria-hidden
              className={cn(
                "size-3.5 shrink-0 text-sidebar-muted-foreground transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
                settledCollapsed && "-rotate-90",
              )}
            />
          </button>
          <div
            inert={settledCollapsed}
            className={cn(
              "grid transition-[grid-template-rows,opacity] duration-250 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
              settledCollapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
            )}
          >
            <div className="overflow-hidden">
              <div ref={attachAnimatedList} className="flex flex-col gap-0.5">
                {sections.settled.map((card) => (
                  <div key={card.id}>
                    <div
                      className={cn(
                        "group/settled flex items-center gap-2 rounded-lg py-1.5 pr-1.5 pl-2 transition-colors hover:bg-sidebar-row-hover",
                        card.id === selectedCardId && "bg-sidebar-row-selected",
                      )}
                    >
                      <CheckCircle2Icon aria-hidden className="size-3.5 shrink-0 text-success" />
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate text-left text-[13px] text-sidebar-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => openCard(card.id)}
                      >
                        {card.title}
                      </button>
                      <span className="shrink-0 font-mono text-[10px] text-sidebar-muted-foreground/70 tabular-nums">
                        <RelativeCardAge at={card.settledAt} />
                      </span>
                      <FlowCardStateBadge card={card} />
                      <button
                        type="button"
                        aria-label={`Un-settle '${card.title}'`}
                        title={`Move ${card.title} back to Done`}
                        disabled={pendingCardIds.has(card.id) || cardOperation(card) !== null}
                        className="flex size-5 shrink-0 items-center justify-center rounded-sm opacity-0 outline-none transition-[opacity,background-color] group-hover/settled:opacity-100 pointer-coarse:opacity-100 hover:bg-sidebar-accent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30 [&_svg]:text-sidebar-muted-foreground hover:[&_svg]:text-sidebar-foreground"
                        onClick={() => {
                          void withPendingCard(card.id, () =>
                            unsettleCard({
                              environmentId,
                              input: { cardId: card.id },
                            }),
                          );
                        }}
                      >
                        <Undo2Icon aria-hidden className="size-3" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete '${card.title}'`}
                        title={`Delete ${card.title}`}
                        disabled={pendingCardIds.has(card.id) || cardOperation(card) !== null}
                        className="flex size-5 shrink-0 items-center justify-center rounded-sm opacity-0 outline-none transition-[opacity,background-color] group-hover/settled:opacity-100 pointer-coarse:opacity-100 hover:bg-destructive/10 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30 [&_svg]:text-sidebar-muted-foreground hover:[&_svg]:text-destructive-foreground"
                        onClick={() => setPendingDelete({ id: card.id, title: card.title })}
                      >
                        <Trash2Icon aria-hidden className="size-3" />
                      </button>
                    </div>
                    <FlowCardFailureNote card={card} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* Cards the server has taken for deletion. They are off the working
          board already — this is a receipt, not a place to act. */}
      {sections.deleting.length > 0 ? (
        <section ref={attachAnimatedList} className="flex flex-col gap-0.5">
          <SectionLabel className="text-sidebar-muted-foreground">
            Deleting · {sections.deleting.length}
          </SectionLabel>
          {sections.deleting.map((card) => (
            <div key={card.id}>
              <div className="flex items-center gap-2 rounded-lg py-1.5 pr-1.5 pl-2 opacity-70">
                <span className="min-w-0 flex-1 truncate text-[13px] text-sidebar-muted-foreground line-through">
                  {card.title}
                </span>
                <FlowCardStateBadge card={card} />
                {card.lastError === null ? null : (
                  <button
                    type="button"
                    className="shrink-0 rounded-sm px-1 font-medium text-primary text-xs outline-none hover:text-primary/80 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    disabled={pendingCardIds.has(card.id)}
                    onClick={() => void retryDeleteCleanup(card.id)}
                  >
                    {pendingCardIds.has(card.id) ? "Retrying…" : "Retry"}
                  </button>
                )}
              </div>
              <FlowCardFailureNote card={card} />
            </div>
          ))}
        </section>
      ) : null}

      {editorTarget !== null ? (
        <Suspense fallback={null}>
          <BoardEditorDialog
            open
            board={editorTarget.board}
            environmentId={environmentId}
            projectTitle={project?.title ?? projectTitle}
            workspaceRoot={project?.workspaceRoot ?? null}
            onOpenChange={(open) => {
              if (!open) setEditorTarget(null);
            }}
            onSubmit={handleBoardSubmit}
          />
        </Suspense>
      ) : null}
      <CardCreateDialog
        open={cardDialogOpen}
        board={board}
        onOpenChange={setCardDialogOpen}
        onSubmit={handleCardSubmit}
      />
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete '{pendingDelete?.title}'?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the card from the flow and deletes its conversations, worktree, and
              artifacts. The branch's commits stay in the repository; anything uncommitted in the
              worktree is lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                const target = pendingDelete;
                setPendingDelete(null);
                if (target === null) return;
                void deleteCardRun(target.id);
              }}
            >
              Delete card
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SidebarGroup>
  );
}
