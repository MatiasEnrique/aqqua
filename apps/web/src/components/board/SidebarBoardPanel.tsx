import { scopeProjectRef } from "@aqqua/client-runtime/environment";
import { canDeleteCard, cardOperation } from "@aqqua/client-runtime/state/boards";
import type {
  EnvironmentId,
  OrchestrationCard,
  ProjectId,
  ScopedProjectRef,
} from "@aqqua/contracts";
import {
  ArchiveIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  FolderIcon,
  FolderTreeIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";

import { cn } from "~/lib/utils";
import { useEnvironmentsBoards } from "../../state/boards";
import { ProjectFavicon } from "../ProjectFavicon";
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
import { Checkbox } from "../ui/checkbox";
import { SidebarGroup } from "../ui/sidebar";
import {
  FlowCardStateBadge,
  SidebarCardActionButton,
  SidebarCardHoverActionSlot,
} from "../sidebar/card";
import { StatusIndicator } from "../StatusIndicator";
import { cardOperationPresentation, formatElapsed } from "./BoardRunTable.logic";
import { CardCreateDialog } from "./CardCreateDialog";
import { BoardSelector, FlowSlimRow, InFlightCardRow, SectionLabel } from "./SidebarBoardRows";
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

/**
 * A row action that stays out of the way: pruning and starting are not what a
 * row is for, so the button only surfaces on hover, focus, or coarse pointers.
 */
function FlowRowHoverAction(props: {
  readonly icon: Parameters<typeof SidebarCardActionButton>[0]["icon"];
  readonly label: string;
  readonly title: string;
  readonly onClick: () => void;
  readonly tone?: "default" | "destructive";
  readonly disabled?: boolean;
}) {
  return (
    <SidebarCardActionButton
      icon={props.icon}
      label={props.label}
      title={props.title}
      {...(props.tone === undefined ? {} : { tone: props.tone })}
      {...(props.disabled === undefined ? {} : { disabled: props.disabled })}
      shape="inline"
      className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover/v2-row:opacity-100 pointer-coarse:opacity-100"
      onClick={props.onClick}
    />
  );
}

function RelativeCardAge({ at }: { readonly at: string | null }) {
  const nowMs = useSidebarRelativeTimeTick();
  return cardAge(at, nowMs);
}

export function TodoCardStateBadge({
  card,
  isStarting,
}: {
  readonly card: OrchestrationCard;
  readonly isStarting: boolean;
}) {
  if (!isStarting) return <FlowCardStateBadge card={card} />;

  const operation = cardOperation(card);
  return (
    <StatusIndicator
      state="working"
      label={operation === null ? "Starting…" : `${cardOperationPresentation(operation).label}…`}
      showLabel
      size="size-2"
      className="px-1 text-sidebar-muted-foreground text-xs"
    />
  );
}

export function FlowProjectGroupingToggle({
  grouped,
  onToggle,
}: {
  readonly grouped: boolean;
  readonly onToggle: () => void;
}) {
  const label = grouped ? "Show flow cards without project groups" : "Group flow cards by project";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={grouped}
      onClick={onToggle}
      className={cn(
        "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md outline-none transition-colors duration-(--duration-fast) ease-(--ease-fluid)",
        "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring",
        grouped && "bg-sidebar-row-selected text-sidebar-foreground",
      )}
    >
      <FolderTreeIcon aria-hidden className="size-3.5" />
    </button>
  );
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
  const [groupByProject, setGroupByProject] = useState(false);
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
        groupedByProject={false}
        showWhenMissing
      />
    );
  }

  return (
    <>
      {projects.length > 1 ? (
        <div className="flex justify-end px-2 pb-1">
          <FlowProjectGroupingToggle
            grouped={groupByProject}
            onToggle={() => setGroupByProject((current) => !current)}
          />
        </div>
      ) : null}
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
          groupedByProject={groupByProject}
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
  groupedByProject,
  showWhenMissing,
}: {
  readonly projectRef: ScopedProjectRef;
  readonly projectTitle: string;
  readonly groupedByProject: boolean;
  /** Scoped view explains a missing board; the all-projects list skips it. */
  readonly showWhenMissing: boolean;
}) {
  const controller = useSidebarProjectBoardController({ projectRef });
  const {
    activeCards,
    archivedCards,
    archivedCollapsed,
    archiveCardRun,
    attachAnimatedList,
    board,
    boardNameFor,
    boards,
    cardDialogOpen,
    chosenBoardIds,
    deleteCardRun,
    editorTarget,
    environmentId,
    handleBoardSubmit,
    handleCardSubmit,
    needsYouCards,
    openCard,
    pendingCardIds,
    pendingArchive,
    pendingDelete,
    project,
    releaseCard,
    retryDeleteCleanup,
    sections,
    selectedCardId,
    setCardDialogOpen,
    setArchivedCollapsed,
    setChosenBoardIds,
    setEditorTarget,
    setPendingDelete,
    setPendingArchive,
    setSettledCollapsed,
    settledCollapsed,
    unsettleCard,
    unarchiveCardRun,
    withPendingCard,
  } = controller;

  if (boards.length === 0 && !showWhenMissing) return null;

  const projectIcon =
    project === null ? (
      <FolderIcon className="size-4 shrink-0 text-sidebar-muted-foreground/50" />
    ) : (
      <ProjectFavicon
        environmentId={environmentId}
        cwd={project.workspaceRoot}
        className="size-4 shrink-0 rounded-sm"
      />
    );

  return (
    <SidebarGroup className="gap-3 px-2 pt-0 pb-4">
      {groupedByProject ? (
        <div
          data-flow-project-group={projectTitle}
          className="flex h-7 items-center gap-1.5 rounded-md px-1"
        >
          {projectIcon}
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-sidebar-muted-foreground">
            {projectTitle}
          </span>
        </div>
      ) : null}
      <BoardSelector
        boards={boards}
        selectedBoardIds={chosenBoardIds}
        projectTitle={projectTitle}
        onSelectionChange={setChosenBoardIds}
        onNewCard={() => setCardDialogOpen(true)}
        onEditBoard={(candidate) => setEditorTarget({ board: candidate })}
        onNewBoard={() => setEditorTarget({ board: null })}
      />

      {boards.length > 0 &&
      needsYouCards.length +
        activeCards.length +
        sections.todo.length +
        sections.done.length +
        sections.settled.length +
        archivedCards.length +
        sections.deleting.length ===
        0 ? (
        <p className="px-2 text-sidebar-muted-foreground text-xs">
          No cards yet. Add one to fill the backlog.
        </p>
      ) : null}

      {needsYouCards.length > 0 ? (
        <section className="flex flex-col">
          <SectionLabel className="text-warning-foreground">
            Needs you · {needsYouCards.length}
          </SectionLabel>
          {/* Panels need air between them to read as separate objects — the
              same gap the conversation list keeps. */}
          <ul ref={attachAnimatedList} className="flex flex-col gap-1">
            {needsYouCards.map((card) => (
              <InFlightCardRow
                key={card.id}
                card={card}
                projectIcon={projectIcon}
                projectName={projectTitle}
                flowName={boardNameFor(card)}
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
          </ul>
        </section>
      ) : null}

      {activeCards.length > 0 ? (
        <section className="flex flex-col">
          <SectionLabel className="text-info-foreground">
            Active · {activeCards.length}
          </SectionLabel>
          <ul ref={attachAnimatedList} className="flex flex-col gap-1">
            {activeCards.map((card) => (
              <InFlightCardRow
                key={card.id}
                card={card}
                projectIcon={projectIcon}
                projectName={projectTitle}
                flowName={boardNameFor(card)}
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
          </ul>
        </section>
      ) : null}

      {sections.todo.length > 0 ? (
        <section className="flex flex-col">
          <SectionLabel
            className="text-sidebar-muted-foreground"
            trailing={<span className="text-sidebar-muted-foreground/60">backlog</span>}
          >
            To-Do · {sections.todo.length}
          </SectionLabel>
          <ul ref={attachAnimatedList} className="flex flex-col gap-1">
            {sections.todo.map((card) => {
              // Release is claimed before the snapshot lands, so the operation —
              // not the snapshot — is what says this card is already on its way.
              const operation = cardOperation(card);
              const starting = operation !== null || pendingCardIds.has(card.id);
              return (
                <FlowSlimRow
                  key={card.id}
                  card={card}
                  projectIcon={projectIcon}
                  projectName={projectTitle}
                  flowName={boardNameFor(card)}
                  selected={card.id === selectedCardId}
                  onOpen={() => openCard(card.id)}
                  recede
                  titleClassName="text-sidebar-foreground/90"
                  trailing={
                    <>
                      {/* Release runs server-side (worktree + checkout + setup)
                          after the RPC returns — the row keeps saying so until
                          the card enters its first step and leaves To-Do. */}
                      <TodoCardStateBadge card={card} isStarting={starting} />
                      {starting ? null : (
                        <>
                          <button
                            type="button"
                            className="shrink-0 rounded-sm px-1 font-medium text-primary text-xs outline-none transition-[color,scale] duration-150 ease-out hover:text-primary/80 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] motion-reduce:transform-none disabled:opacity-50"
                            onClick={(event) => {
                              event.stopPropagation();
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
                            <FlowRowHoverAction
                              icon={Trash2Icon}
                              label={`Delete '${card.title}'`}
                              title={`Delete ${card.title}`}
                              tone="destructive"
                              onClick={() => setPendingDelete({ id: card.id, title: card.title })}
                            />
                          ) : null}
                        </>
                      )}
                    </>
                  }
                />
              );
            })}
          </ul>
        </section>
      ) : null}

      {sections.done.length > 0 ? (
        <section className="flex flex-col">
          <SectionLabel className="text-success-foreground">
            Done · {sections.done.length}
          </SectionLabel>
          <ul ref={attachAnimatedList} className="flex flex-col gap-1">
            {sections.done.map((card) => {
              const busy = pendingCardIds.has(card.id) || cardOperation(card) !== null;
              return (
                <FlowSlimRow
                  key={card.id}
                  card={card}
                  projectIcon={projectIcon}
                  projectName={projectTitle}
                  flowName={boardNameFor(card)}
                  selected={card.id === selectedCardId}
                  onOpen={() => openCard(card.id)}
                  titleClassName="text-sidebar-foreground/90"
                  leading={
                    <CheckCircle2Icon aria-hidden className="size-3.5 shrink-0 text-success" />
                  }
                  trailing={
                    <>
                      <SidebarCardHoverActionSlot
                        reserveWidth
                        resting={
                          <span className="inline-flex items-center gap-2">
                            <span className="text-[10px] text-sidebar-muted-foreground/70 tabular-nums">
                              <RelativeCardAge at={card.completedAt} />
                            </span>
                            <FlowCardStateBadge card={card} />
                          </span>
                        }
                        actions={
                          <>
                            <SidebarCardActionButton
                              icon={ArchiveIcon}
                              label={`Archive '${card.title}'`}
                              title={`Archive ${card.title}`}
                              disabled={busy}
                              shape="inline"
                              onClick={() =>
                                setPendingArchive({
                                  id: card.id,
                                  title: card.title,
                                  deleteWorktree: false,
                                })
                              }
                            />
                            <SidebarCardActionButton
                              icon={Trash2Icon}
                              label={`Delete '${card.title}'`}
                              title={`Delete ${card.title}`}
                              disabled={busy}
                              tone="destructive"
                              shape="inline"
                              onClick={() => setPendingDelete({ id: card.id, title: card.title })}
                            />
                          </>
                        }
                      />
                    </>
                  }
                />
              );
            })}
          </ul>
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
              <ul ref={attachAnimatedList} className="flex flex-col gap-1">
                {sections.settled.map((card) => {
                  const busy = pendingCardIds.has(card.id) || cardOperation(card) !== null;
                  return (
                    <FlowSlimRow
                      key={card.id}
                      card={card}
                      projectIcon={projectIcon}
                      projectName={projectTitle}
                      flowName={boardNameFor(card)}
                      selected={card.id === selectedCardId}
                      onOpen={() => openCard(card.id)}
                      recede
                      titleClassName="text-sidebar-muted-foreground"
                      leading={
                        <CheckCircle2Icon aria-hidden className="size-3.5 shrink-0 text-success" />
                      }
                      trailing={
                        <SidebarCardHoverActionSlot
                          reserveWidth
                          resting={
                            <span className="inline-flex items-center gap-2">
                              <span className="text-[10px] text-sidebar-muted-foreground/70 tabular-nums">
                                <RelativeCardAge at={card.settledAt} />
                              </span>
                              <FlowCardStateBadge card={card} />
                            </span>
                          }
                          actions={
                            <>
                              <SidebarCardActionButton
                                icon={ArchiveIcon}
                                label={`Archive '${card.title}'`}
                                title={`Archive ${card.title}`}
                                disabled={busy}
                                shape="inline"
                                onClick={() =>
                                  setPendingArchive({
                                    id: card.id,
                                    title: card.title,
                                    deleteWorktree: false,
                                  })
                                }
                              />
                              <SidebarCardActionButton
                                icon={Undo2Icon}
                                label={`Un-settle '${card.title}'`}
                                title={`Move ${card.title} back to Done`}
                                disabled={busy}
                                shape="inline"
                                onClick={() => {
                                  void withPendingCard(card.id, () =>
                                    unsettleCard({
                                      environmentId,
                                      input: { cardId: card.id },
                                    }),
                                  );
                                }}
                              />
                              <SidebarCardActionButton
                                icon={Trash2Icon}
                                label={`Delete '${card.title}'`}
                                title={`Delete ${card.title}`}
                                disabled={busy}
                                tone="destructive"
                                shape="inline"
                                onClick={() => setPendingDelete({ id: card.id, title: card.title })}
                              />
                            </>
                          }
                        />
                      }
                    />
                  );
                })}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      {archivedCards.length > 0 ? (
        <section className="flex flex-col gap-0.5">
          <button
            type="button"
            aria-expanded={!archivedCollapsed}
            className="flex items-center gap-2 rounded-sm px-2 pb-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setArchivedCollapsed((current) => !current)}
          >
            <span className="shrink-0 text-[13px] text-sidebar-muted-foreground">
              {archivedCollapsed ? `Archived (${archivedCards.length})` : "Archived"}
            </span>
            <span aria-hidden className="h-px min-w-0 flex-1 bg-sidebar-border" />
            <ChevronDownIcon
              aria-hidden
              className={cn(
                "size-3.5 shrink-0 text-sidebar-muted-foreground transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
                archivedCollapsed && "-rotate-90",
              )}
            />
          </button>
          <div
            inert={archivedCollapsed}
            className={cn(
              "grid transition-[grid-template-rows,opacity] duration-250 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
              archivedCollapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
            )}
          >
            <div className="overflow-hidden">
              <ul ref={attachAnimatedList} className="flex flex-col gap-1">
                {archivedCards.map((card) => (
                  <FlowSlimRow
                    key={card.id}
                    card={card}
                    projectIcon={projectIcon}
                    projectName={projectTitle}
                    flowName={boardNameFor(card)}
                    selected={false}
                    interactive={false}
                    onOpen={() => undefined}
                    recede
                    titleClassName="text-sidebar-muted-foreground"
                    leading={
                      <ArchiveIcon
                        aria-hidden
                        className="size-3.5 shrink-0 text-sidebar-muted-foreground"
                      />
                    }
                    trailing={
                      <SidebarCardHoverActionSlot
                        reserveWidth
                        resting={
                          <span className="font-mono text-[10px] text-sidebar-muted-foreground/70 tabular-nums">
                            <RelativeCardAge at={card.archivedAt} />
                          </span>
                        }
                        actions={
                          <SidebarCardActionButton
                            icon={Undo2Icon}
                            label={`Restore '${card.title}'`}
                            title={`Restore ${card.title}`}
                            disabled={pendingCardIds.has(card.id)}
                            shape="inline"
                            onClick={() => void unarchiveCardRun(card.id)}
                          />
                        }
                      />
                    }
                  />
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      {/* Cards the server has taken for deletion. They are off the working
          board already — this is a receipt, not a place to act. */}
      {sections.deleting.length > 0 ? (
        <section className="flex flex-col">
          <SectionLabel className="text-sidebar-muted-foreground">
            Deleting · {sections.deleting.length}
          </SectionLabel>
          <ul ref={attachAnimatedList} className="flex flex-col gap-1">
            {sections.deleting.map((card) => (
              <FlowSlimRow
                key={card.id}
                card={card}
                projectIcon={projectIcon}
                projectName={projectTitle}
                flowName={boardNameFor(card)}
                selected={false}
                onOpen={() => undefined}
                interactive={false}
                recede
                titleClassName="text-sidebar-muted-foreground line-through"
                trailing={
                  <>
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
                  </>
                }
              />
            ))}
          </ul>
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
      <AlertDialog
        open={pendingArchive !== null}
        onOpenChange={(open) => {
          if (!open) setPendingArchive(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive '{pendingArchive?.title}'?</AlertDialogTitle>
            <AlertDialogDescription>
              This archives the card and every conversation it owns, then removes its artifacts. The
              branch and its commits stay in the repository.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border/70 p-3 text-sm">
            <Checkbox
              checked={pendingArchive?.deleteWorktree ?? false}
              onCheckedChange={(checked) =>
                setPendingArchive((current) =>
                  current === null ? null : { ...current, deleteWorktree: checked === true },
                )
              }
            />
            <span className="grid gap-0.5">
              <span className="font-medium text-foreground">Delete worktree</span>
              <span className="text-muted-foreground text-xs">
                Remove the checkout too. Uncommitted changes in it will be lost.
              </span>
            </span>
          </label>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              onClick={() => {
                const target = pendingArchive;
                setPendingArchive(null);
                if (target === null) return;
                void archiveCardRun(target.id, target.deleteWorktree);
              }}
            >
              Archive card
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SidebarGroup>
  );
}
