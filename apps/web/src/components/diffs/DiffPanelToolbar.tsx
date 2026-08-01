import {
  ArrowDownToLineIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  Columns2Icon,
  PilcrowIcon,
  RefreshCwIcon,
  Rows3Icon,
  TextWrapIcon,
} from "lucide-react";

import { DiffStatLabel } from "../chat/DiffStatLabel";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

type DiffRenderMode = "stacked" | "split";

interface DiffPanelToolbarProps {
  readonly canRefresh: boolean;
  readonly isRefreshing: boolean;
  readonly onRefresh: () => void;
  readonly showPull: boolean;
  readonly isPulling: boolean;
  readonly isSourceControlBusy: boolean;
  readonly onPull: () => void;
  readonly fileCount: number;
  readonly additions: number;
  readonly deletions: number;
  readonly allFilesCollapsed: boolean;
  readonly onToggleAllFiles: () => void;
  readonly renderMode: DiffRenderMode;
  readonly onRenderModeChange: (mode: DiffRenderMode) => void;
  readonly wordWrap: boolean;
  readonly onWordWrapChange: (enabled: boolean) => void;
  readonly showWhitespaceControl: boolean;
  readonly ignoreWhitespace: boolean;
  readonly onIgnoreWhitespaceChange: (enabled: boolean) => void;
}

export function DiffPanelToolbar({
  canRefresh,
  isRefreshing: isRefreshingDiff,
  onRefresh: handleRefreshDiff,
  showPull: showPullControl,
  isPulling,
  isSourceControlBusy,
  onPull: handlePull,
  fileCount,
  additions,
  deletions,
  allFilesCollapsed: allDiffFilesCollapsed,
  onToggleAllFiles: toggleDiffFileCollapse,
  renderMode: diffRenderMode,
  onRenderModeChange,
  wordWrap,
  onWordWrapChange,
  showWhitespaceControl,
  ignoreWhitespace: diffIgnoreWhitespace,
  onIgnoreWhitespaceChange,
}: DiffPanelToolbarProps) {
  return (
    <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Refresh diff"
              disabled={isRefreshingDiff || !canRefresh}
              onClick={handleRefreshDiff}
            />
          }
        >
          {isRefreshingDiff ? (
            <Spinner className="size-3.5" />
          ) : (
            <RefreshCwIcon className="size-3.5" />
          )}
        </TooltipTrigger>
        <TooltipPopup side="top">
          {isRefreshingDiff ? "Refreshing diff..." : "Refresh diff"}
        </TooltipPopup>
      </Tooltip>
      {showPullControl && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="xs"
                variant="outline"
                aria-label="Pull the current branch"
                disabled={isPulling || isSourceControlBusy}
                onClick={handlePull}
              />
            }
          >
            {isPulling ? (
              <Spinner className="size-3" />
            ) : (
              <ArrowDownToLineIcon className="size-3" />
            )}
            Pull
          </TooltipTrigger>
          <TooltipPopup side="top">
            {isPulling ? "Pulling..." : "Pull the current branch"}
          </TooltipPopup>
        </Tooltip>
      )}
      {fileCount > 0 && (
        <DiffStatLabel
          additions={additions}
          deletions={deletions}
          className="mr-1 text-[11px]"
          layout="inline"
        />
      )}
      {fileCount > 0 && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="icon-xs"
                variant="outline"
                aria-label={allDiffFilesCollapsed ? "Expand all files" : "Collapse all files"}
                onClick={toggleDiffFileCollapse}
              />
            }
          >
            {allDiffFilesCollapsed ? (
              <ChevronsUpDownIcon className="size-3" />
            ) : (
              <ChevronsDownUpIcon className="size-3" />
            )}
          </TooltipTrigger>
          <TooltipPopup side="top">
            {allDiffFilesCollapsed ? "Expand all files" : "Collapse all files"}
          </TooltipPopup>
        </Tooltip>
      )}
      <ToggleGroup
        className="shrink-0"
        variant="outline"
        size="xs"
        value={[diffRenderMode]}
        onValueChange={(value) => {
          const next = value[0];
          if (next === "stacked" || next === "split") {
            onRenderModeChange(next);
          }
        }}
      >
        <Toggle aria-label="Stacked diff view" value="stacked">
          <Rows3Icon className="size-3" />
        </Toggle>
        <Toggle aria-label="Split diff view" value="split">
          <Columns2Icon className="size-3" />
        </Toggle>
      </ToggleGroup>
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              aria-label={wordWrap ? "Disable diff line wrapping" : "Enable diff line wrapping"}
              variant="outline"
              size="xs"
              pressed={wordWrap}
              onPressedChange={(pressed) => {
                onWordWrapChange(Boolean(pressed));
              }}
            />
          }
        >
          <TextWrapIcon className="size-3" />
        </TooltipTrigger>
        <TooltipPopup side="top">
          {wordWrap ? "Disable line wrapping" : "Enable line wrapping"}
        </TooltipPopup>
      </Tooltip>
      {showWhitespaceControl ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                aria-label={
                  diffIgnoreWhitespace ? "Show whitespace changes" : "Hide whitespace changes"
                }
                variant="outline"
                size="xs"
                pressed={diffIgnoreWhitespace}
                onPressedChange={(pressed) => {
                  onIgnoreWhitespaceChange(Boolean(pressed));
                }}
              />
            }
          >
            <PilcrowIcon className="size-3" />
          </TooltipTrigger>
          <TooltipPopup side="top">
            {diffIgnoreWhitespace ? "Show whitespace changes" : "Hide whitespace changes"}
          </TooltipPopup>
        </Tooltip>
      ) : null}
    </div>
  );
}
