import { FolderGit2Icon, GitBranchIcon } from "lucide-react";
import { cn } from "~/lib/utils";

/**
 * Where a row's work lives, said the way a person thinks of it: the branch
 * name, with the full branch and path in the tooltip. Threads derive this from
 * `rowBranchLabel`, flow cards from `cardWorktreeLabel` — the shapes agree, so
 * one component draws both.
 */
export interface SidebarCardBranchLabel {
  readonly label: string;
  readonly title: string;
  /** Own checkout (folder icon) versus the project's (branch icon). */
  readonly isWorktree: boolean;
}

export function SidebarCardBranch(props: {
  readonly branch: SidebarCardBranchLabel | null;
  /** The local checkout is on another branch: the row says so in warning tone. */
  readonly mismatched?: boolean;
  readonly className?: string;
}) {
  if (props.branch === null) return null;
  const Icon = props.branch.isWorktree ? FolderGit2Icon : GitBranchIcon;
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1 leading-none text-muted-foreground/45",
        props.mismatched === true && "text-warning",
        props.className,
      )}
      title={props.branch.title}
    >
      <Icon aria-hidden className="size-3 shrink-0" />
      <span className="min-w-0 truncate font-mono">{props.branch.label}</span>
    </span>
  );
}
