import { CheckCheckIcon, EllipsisIcon, Trash2Icon } from "lucide-react";
import { canSettle } from "@aqqua/client-runtime/state/thread-settled";
import type { EnvironmentId, ServerConfig } from "@aqqua/contracts";
import {
  resolveSidebarWorktreeDeleteAction,
  resolveSidebarWorktreeSettleAction,
  type SidebarWorktreeGroup,
} from "../Sidebar.worktreeGroups";
import { Button } from "../ui/button";
import { Popover, PopoverClose, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { cn } from "~/lib/utils";

/**
 * Settle-all / delete for one worktree, with the availability rules applied.
 *
 * Shared by the worktree group header and the worktree card so the two
 * surfaces can't drift on when an action is offered — the rules live in
 * `Sidebar.worktreeGroups`, and this is their only rendering.
 */
export function WorktreeActionsPopover(props: {
  readonly group: SidebarWorktreeGroup;
  readonly serverConfigs: ReadonlyMap<EnvironmentId, ServerConfig>;
  readonly removingWorktreeKey: string | null;
  readonly settlingWorktreeKey: string | null;
  readonly onSettleWorktree: (group: SidebarWorktreeGroup) => void;
  readonly onDeleteWorktree: (group: SidebarWorktreeGroup) => void;
  readonly className?: string;
}) {
  const { group } = props;
  const settlementSupported =
    props.serverConfigs.get(group.environmentId)?.environment.capabilities.threadSettlement ===
    true;
  const settleAction = resolveSidebarWorktreeSettleAction({
    conversationCount: group.unsettled.length,
    settlementSupported,
    hasBlockedConversation: group.unsettled.some(
      (thread) => !canSettle(thread, { now: new Date().toISOString() }),
    ),
    isSettling: props.settlingWorktreeKey !== null,
    isRemoving: props.removingWorktreeKey !== null,
  });
  const deleteAction = resolveSidebarWorktreeDeleteAction({
    isProjectCheckout: group.isProjectCheckout,
    worktreeCreated: group.workspaceRoot !== null && group.projectRoot !== null,
    isRemoving: props.removingWorktreeKey !== null,
    isSettling: props.settlingWorktreeKey !== null,
  });

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Worktree actions for ${group.label}`}
            className={cn(
              "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/55 transition-[background-color,color,scale] hover:bg-sidebar-row-hover hover:text-foreground active:scale-[0.96] motion-reduce:transform-none",
              props.className,
            )}
          />
        }
      >
        <EllipsisIcon aria-hidden className="size-4" />
      </PopoverTrigger>
      <PopoverPopup side="right" align="start" className="w-56" viewportClassName="p-1">
        <div className="grid gap-1">
          <div>
            <PopoverClose
              render={
                <Button
                  size="lg"
                  variant="outline"
                  disabled={!settleAction.enabled}
                  title={settleAction.disabledReason ?? undefined}
                  onClick={() => props.onSettleWorktree(group)}
                  className="h-10 w-full justify-start px-3"
                />
              }
            >
              <CheckCheckIcon aria-hidden />
              Settle all
            </PopoverClose>
          </div>
          <div>
            <PopoverClose
              render={
                <Button
                  size="lg"
                  variant="destructive-outline"
                  disabled={!deleteAction.enabled}
                  title={deleteAction.disabledReason ?? undefined}
                  onClick={() => props.onDeleteWorktree(group)}
                  className="h-10 w-full justify-start px-3"
                />
              }
            >
              <Trash2Icon aria-hidden />
              Delete worktree
            </PopoverClose>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
