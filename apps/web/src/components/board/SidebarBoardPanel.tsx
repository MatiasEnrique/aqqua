import { scopeProjectRef } from "@aqqua/client-runtime/environment";
import { canDeleteCard, cardOperation } from "@aqqua/client-runtime/state/boards";

import type { OrchestrationBoard, OrchestrationCard, ScopedProjectRef } from "@aqqua/contracts";
import {
  ArchiveIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  FolderIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";

import { cn } from "~/lib/utils";
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
import type { FlowProject } from "./flowSelection";
import { FlowSlimRow, InFlightCardRow, SectionLabel } from "./SidebarBoardRows";
import { useSidebarFlows } from "./SidebarFlowsProvider";
import { useSidebarProjectBoardController } from "./useSidebarProjectBoardController";
import { useSidebarRelativeTimeTick } from "./useSidebarRelativeTimeTick";

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

export type BoardPanelProject = FlowProject;

/**
 * Board mode for the sidebar's scrolling body: the cards of the one flow the
 * scope row in the header names. Everything about which flow that is lives in
 * `SidebarFlowsProvider`, so the header and this list cannot disagree.
 */
export function SidebarBoardPanel() {
  const { selected, cardDialogOpen, setCardDialogOpen } = useSidebarFlows();
  if (selected === null) {
    return (
      <SidebarGroup className="px-2 pt-0">
        <p className="px-2 text-[13px] text-sidebar-muted-foreground">
          No flows yet. Create one from the picker above.
        </p>
      </SidebarGroup>
    );
  }
  return (
    <FlowCardList
      key={selected.flow.id}
      projectRef={scopeProjectRef(selected.project.environmentId, selected.project.id)}
      project={selected.project}
      flow={selected.flow}
      cardDialogOpen={cardDialogOpen}
      onCardDialogOpenChange={setCardDialogOpen}
    />
  );
}

/**
 * The selected flow's cards, grouped the way the design reads them — Needs you,
 * Active, To-Do (Start inline), Done, then Settled and Archived last.
 */
function FlowCardList({
  projectRef,
  project,
  flow,
  cardDialogOpen,
  onCardDialogOpenChange,
}: {
  readonly projectRef: ScopedProjectRef;
  readonly project: FlowProject;
  readonly flow: OrchestrationBoard;
  readonly cardDialogOpen: boolean;
  readonly onCardDialogOpenChange: (open: boolean) => void;
}) {
  const controller = useSidebarProjectBoardController({ projectRef, boardId: flow.id });
  const {
    activeCards,
    archivedCards,
    archivedCollapsed,
    archiveCardRun,
    attachAnimatedList,
    deleteCardRun,
    environmentId,
    handleCardSubmit,
    needsYouCards,
    openCard,
    pendingCardIds,
    pendingArchive,
    pendingDelete,
    projectDetails,
    releaseCard,
    retryDeleteCleanup,
    sections,
    selectedCardId,
    setArchivedCollapsed,
    setPendingDelete,
    setPendingArchive,
    setSettledCollapsed,
    settledCollapsed,
    unsettleCard,
    unarchiveCardRun,
    withPendingCard,
  } = controller;
  const projectTitle = project.displayName;
  const flowName = flow.name;

  const projectIcon =
    projectDetails === null ? (
      <FolderIcon className="size-3.5 shrink-0 text-sidebar-muted-foreground/50" />
    ) : (
      <ProjectFavicon
        environmentId={environmentId}
        cwd={projectDetails.workspaceRoot}
        className="size-3.5 shrink-0 rounded-sm"
      />
    );

  return (
    <SidebarGroup className="gap-4 px-2 pt-0 pb-4">
      {needsYouCards.length +
        activeCards.length +
        sections.todo.length +
        sections.done.length +
        sections.settled.length +
        archivedCards.length +
        sections.deleting.length ===
      0 ? (
        <p className="px-2 text-[13px] text-sidebar-muted-foreground">
          No cards yet. Add one to fill the backlog.
        </p>
      ) : null}

      {needsYouCards.length > 0 ? (
        <section className="flex flex-col">
          <SectionLabel className="text-warning-foreground" count={needsYouCards.length}>
            Needs you
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
                flowName={flowName}
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
          <SectionLabel className="text-info-foreground" count={activeCards.length}>
            Active
          </SectionLabel>
          <ul ref={attachAnimatedList} className="flex flex-col gap-1">
            {activeCards.map((card) => (
              <InFlightCardRow
                key={card.id}
                card={card}
                projectIcon={projectIcon}
                projectName={projectTitle}
                flowName={flowName}
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
            count={sections.todo.length}
            trailing={<span className="text-sidebar-muted-foreground/60">backlog</span>}
          >
            To-Do
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
                  flowName={flowName}
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
          <SectionLabel className="text-success-foreground" count={sections.done.length}>
            Done
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
                  flowName={flowName}
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
                            <span className="text-[11px] text-sidebar-muted-foreground/70 tabular-nums">
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
            className="flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md pl-1 pr-2 text-left text-sidebar-muted-foreground outline-none transition-colors duration-(--duration-fast) ease-(--ease-fluid) hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            onClick={() => setSettledCollapsed((current) => !current)}
          >
            <ChevronRightIcon
              aria-hidden
              className={cn(
                "size-3.5 shrink-0 transition-transform duration-(--duration-fast) ease-(--ease-fluid) motion-reduce:transition-none",
                !settledCollapsed && "rotate-90",
              )}
            />
            <span className="text-[13px] font-medium leading-5">Settled</span>
            <span className="text-[11px] tabular-nums text-sidebar-muted-foreground/70">
              {sections.settled.length}
            </span>
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
                      flowName={flowName}
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
                              <span className="text-[11px] text-sidebar-muted-foreground/70 tabular-nums">
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
            className="flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md pl-1 pr-2 text-left text-sidebar-muted-foreground outline-none transition-colors duration-(--duration-fast) ease-(--ease-fluid) hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            onClick={() => setArchivedCollapsed((current) => !current)}
          >
            <ChevronRightIcon
              aria-hidden
              className={cn(
                "size-3.5 shrink-0 transition-transform duration-(--duration-fast) ease-(--ease-fluid) motion-reduce:transition-none",
                !archivedCollapsed && "rotate-90",
              )}
            />
            <span className="text-[13px] font-medium leading-5">Archived</span>
            <span className="text-[11px] tabular-nums text-sidebar-muted-foreground/70">
              {archivedCards.length}
            </span>
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
                    flowName={flowName}
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
                          <span className="font-mono text-[11px] text-sidebar-muted-foreground/70 tabular-nums">
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
          <SectionLabel className="text-sidebar-muted-foreground" count={sections.deleting.length}>
            Deleting
          </SectionLabel>
          <ul ref={attachAnimatedList} className="flex flex-col gap-1">
            {sections.deleting.map((card) => (
              <FlowSlimRow
                key={card.id}
                card={card}
                projectIcon={projectIcon}
                projectName={projectTitle}
                flowName={flowName}
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

      {/* The picker already chose the flow, so the dialog asks only for the
          card's inputs. */}
      <CardCreateDialog
        open={cardDialogOpen}
        boards={[flow]}
        initialBoardId={flow.id}
        onOpenChange={onCardDialogOpenChange}
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
