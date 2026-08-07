import { scopedThreadKey, scopeThreadRef } from "@aqqua/client-runtime/environment";
import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/models";
import { threadWokeAt } from "@aqqua/client-runtime/state/thread-settled";
import type { ReactNode } from "react";
import type { SidebarDraftRow as SidebarDraftRowModel } from "../Sidebar.logic";
import { snoozeWakeLabel } from "../Sidebar.snooze";
import { resolveRegularSidebarSubAgentStateCounts } from "../Sidebar.summaryState";
import type { SidebarV2ViewModel } from "./models";
import { SidebarConversationRow } from "./SidebarConversationRow";
import { SidebarDraftRow } from "./SidebarDraftRow";

export type SidebarThreadRowSection = "active" | "snoozed" | "settled";

export interface SidebarRowRenderers {
  readonly renderThreadRow: (
    thread: EnvironmentThreadShell,
    section: SidebarThreadRowSection,
  ) => ReactNode;
  readonly renderDraftRow: (row: SidebarDraftRowModel) => ReactNode;
}

/**
 * The conversation and draft rows, as a function of the view model.
 *
 * Extracted so every sidebar presentation — grouped list, flat list, worktree
 * cards — renders the *same* row with the same props. Row chrome is where
 * behaviour lives (rename, settle, snooze, multi-select, context menu); a
 * second copy would be a second set of bugs.
 */
export function useSidebarRowRenderers(model: SidebarV2ViewModel): SidebarRowRenderers {
  const { route, projects, threads, threadLifecycle, navigation } = model;

  const renderThreadRow = (
    thread: EnvironmentThreadShell,
    section: SidebarThreadRowSection,
  ): ReactNode => {
    const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    const treeMeta =
      section === "active"
        ? threads.activeTreeMetaByKey.get(threadKey)
        : section === "settled"
          ? threads.settledTreeMetaByKey.get(threadKey)
          : undefined;
    const depth = treeMeta?.depth ?? 0;
    // Settled, snoozed and sub-agent rows are the ONLY things that collapse a
    // row: every other thread is a full card. Density comes from users (or the
    // auto rules) actually parking work, and from delegation nesting under its
    // orchestrator — not from the sidebar second-guessing what still matters.
    const rowVariant = section !== "active" ? "slim" : depth > 0 ? "sub" : "card";
    // Every conversation is a panel, whichever shelf it sits on. Active and
    // settled both nest, so both band by family; snoozed rows render flat, so
    // each closes its own.
    const band =
      section === "active"
        ? (threads.activeFamilyBandByKey.get(threadKey) ?? "single")
        : section === "settled"
          ? (threads.settledFamilyBandByKey.get(threadKey) ?? "single")
          : "single";
    return (
      <SidebarConversationRow
        // Keyed per variant on purpose: when a thread settles, the card fades
        // out in place and the slim row fades in at its settled position
        // instead of one element FLIP-sliding through every row in between
        // (rows here are translucent, so a crossing row reads as text painted
        // over text).
        key={`${threadKey}:${rowVariant}`}
        thread={thread}
        variant={rowVariant}
        depth={depth}
        childCount={treeMeta?.childCount ?? 0}
        subAgentStateCounts={resolveRegularSidebarSubAgentStateCounts({
          groupingMode: threads.sidebarThreadGroupingMode,
          threadKey,
          countsByThreadKey: threads.activeSubAgentStateCountsByKey,
        })}
        reserveExpandGutter={threads.reserveSubAgentGutter}
        isExpanded={
          threads.expandedThreadKeys.has(threadKey) ||
          threads.settledExpandedThreadKeys.has(threadKey)
        }
        onToggleExpanded={threadLifecycle.toggleThreadExpanded}
        // Snoozed rows wake; settled rows un-settle (explicit settles clear the
        // override, auto-settled rows get pinned active); cards settle.
        variantAction={
          section === "snoozed" ? "unsnooze" : section === "settled" ? "unsettle" : "settle"
        }
        settlementSupported={
          threads.serverConfigs.get(thread.environmentId)?.environment.capabilities
            .threadSettlement === true
        }
        snoozeSupported={
          threads.serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSnooze ===
          true
        }
        deletable={!threads.flowOwnedThreadKeys.has(threadKey)}
        snoozeWakeLabelText={
          section === "snoozed" && thread.snoozedUntil != null
            ? snoozeWakeLabel(thread.snoozedUntil, new Date())
            : null
        }
        // All sections: a woken thread can classify straight into the settled
        // tail (PR merged while snoozed), and the wake signal must survive the
        // trip. Still-snoozed rows resolve to null on their own.
        wokeAt={threadWokeAt(thread, { now: threads.snoozeNow })}
        isActive={route.routeThreadKey === threadKey}
        jumpLabel={threads.showJumpHints ? (threads.jumpLabelByKey.get(threadKey) ?? null) : null}
        environmentLabel={projects.environmentLabelById.get(thread.environmentId) ?? null}
        projectCwd={
          projects.projectCwdByKey.get(`${thread.environmentId}:${thread.projectId}`) ?? null
        }
        projectTitle={
          projects.projectDisplayNameByKey.get(`${thread.environmentId}:${thread.projectId}`) ??
          null
        }
        showProjectIdentity={
          section !== "settled" && threads.sidebarThreadGroupingMode !== "worktree"
        }
        showBranch={threads.sidebarThreadGroupingMode !== "worktree"}
        band={band}
        providerEntryByInstanceId={threads.providerEntryByInstanceId}
        onThreadClick={threadLifecycle.handleThreadClick}
        onThreadActivate={navigation.navigateToThread}
        onStartRename={threadLifecycle.startThreadRename}
        onRenameTitleChange={threadLifecycle.setRenamingTitle}
        onCommitRename={threadLifecycle.commitThreadRename}
        onCancelRename={threadLifecycle.cancelThreadRename}
        isRenaming={threadLifecycle.renamingThreadKey === threadKey}
        renamingTitle={
          threadLifecycle.renamingThreadKey === threadKey ? threadLifecycle.renamingTitle : ""
        }
        onContextMenu={threadLifecycle.handleThreadContextMenu}
        onSettle={threadLifecycle.attemptSettle}
        onUnsettle={threadLifecycle.attemptUnsettle}
        onSnooze={threadLifecycle.attemptSnooze}
        onUnsnooze={threadLifecycle.attemptUnsnooze}
        onDelete={threadLifecycle.attemptDeleteThread}
        onChangeRequestState={threads.handleChangeRequestState}
      />
    );
  };

  const renderDraftRow = (row: SidebarDraftRowModel): ReactNode => {
    const projectKey = `${row.environmentId}:${row.projectId}`;
    return (
      <SidebarDraftRow
        key={`draft:${row.draftId}`}
        draftId={row.draftId}
        title={row.title}
        environmentId={row.environmentId}
        projectCwd={projects.projectCwdByKey.get(projectKey) ?? null}
        projectTitle={projects.projectDisplayNameByKey.get(projectKey) ?? null}
        showProjectIdentity={threads.sidebarThreadGroupingMode !== "worktree"}
        isActive={route.routeDraftId === row.draftId}
        onClick={navigation.navigateToDraft}
        onDiscard={navigation.discardDraft}
      />
    );
  };

  return { renderThreadRow, renderDraftRow };
}
