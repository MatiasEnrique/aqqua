import type { TurnId } from "@aqqua/contracts";
import type { TimestampFormat } from "@aqqua/contracts/settings";
import { ArrowLeftIcon, ChevronDownIcon } from "lucide-react";

import { formatShortTimestamp } from "../../timestampFormat";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../ui/menu";

interface TurnDiffSummary {
  readonly turnId: TurnId;
  readonly checkpointTurnCount?: number | null;
  readonly completedAt: string;
}

interface DiffScopeSelectorProps {
  readonly commit: {
    readonly label: string;
    readonly onBack?: () => void;
  } | null;
  readonly selectedScopeLabel: string;
  readonly selectedTurnId: TurnId | null;
  readonly selectedGitScope: "branch" | "unstaged";
  readonly selectedTurnIdForHighlight: TurnId | null;
  readonly latestTurnId: TurnId | null;
  readonly turns: ReadonlyArray<TurnDiffSummary>;
  readonly inferredTurnCounts: Readonly<Record<string, number>>;
  readonly timestampFormat: TimestampFormat;
  readonly onSelectGitScope: (scope: "branch" | "unstaged") => void;
  readonly onSelectTurn: (turnId: TurnId) => void;
}

export function DiffScopeSelector({
  commit,
  selectedScopeLabel,
  selectedTurnId,
  selectedGitScope,
  selectedTurnIdForHighlight,
  latestTurnId,
  turns,
  inferredTurnCounts,
  timestampFormat,
  onSelectGitScope,
  onSelectTurn,
}: DiffScopeSelectorProps) {
  return (
    <>
      {commit ? (
        <div className="flex min-w-0 items-center gap-1.5">
          {commit.onBack ? (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="@min-[720px]/history:hidden"
              aria-label="Back to Git history"
              onClick={commit.onBack}
            >
              <ArrowLeftIcon className="size-3.5" />
            </Button>
          ) : null}
          <span
            className="truncate rounded-md bg-muted/70 px-2 py-1 text-xs font-medium text-foreground"
            title={commit.label}
          >
            {commit.label}
          </span>
        </div>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex h-6 max-w-full items-center gap-1 rounded-md bg-muted/70 px-2 text-xs font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Diff scope: ${selectedScopeLabel}`}
          >
            <span className="truncate">{selectedScopeLabel}</span>
            <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuItem
              className={
                selectedTurnId === null && selectedGitScope === "unstaged"
                  ? "bg-foreground/[0.08]"
                  : undefined
              }
              onClick={() => onSelectGitScope("unstaged")}
            >
              <span>Working tree</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className={
                selectedTurnId === null && selectedGitScope === "branch"
                  ? "bg-foreground/[0.08]"
                  : undefined
              }
              onClick={() => onSelectGitScope("branch")}
            >
              <span>Branch changes</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className={
                selectedTurnId !== null && selectedTurnIdForHighlight === latestTurnId
                  ? "bg-foreground/[0.08]"
                  : undefined
              }
              onClick={() => {
                if (latestTurnId) onSelectTurn(latestTurnId);
              }}
            >
              <span>Latest turn</span>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Turn</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-64">
                {turns.map((summary) => {
                  const turnCount =
                    summary.checkpointTurnCount ?? inferredTurnCounts[summary.turnId] ?? "?";
                  return (
                    <DropdownMenuItem
                      key={summary.turnId}
                      className={
                        summary.turnId === selectedTurnIdForHighlight
                          ? "bg-foreground/[0.08]"
                          : undefined
                      }
                      onClick={() => onSelectTurn(summary.turnId)}
                    >
                      <span>Turn {turnCount}</span>
                      <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                        {formatShortTimestamp(summary.completedAt, timestampFormat)}
                      </span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}
