import type { VcsStatusResult } from "@aqqua/contracts";
import { resolveChangeRequestPresentation } from "@aqqua/shared/sourceControl";

export type ThreadPr = NonNullable<VcsStatusResult["pr"]>;

export interface ThreadPrPresentation {
  readonly number: number;
  readonly state: ThreadPr["state"];
  readonly url: string;
  /** Compact pull request number label, e.g. "3774". */
  readonly label: string;
  /** Full, provider-aware label for assistive technologies. */
  readonly accessibilityLabel: string;
  readonly textClassName: string;
  /** Compact aggregate checks label, omitted when the provider reports no status. */
  readonly checksLabel: "Pending" | "Passing" | "Failing" | null;
  readonly checksTextClassName: string | null;
}

const PR_STATE_TEXT_CLASS: Record<ThreadPr["state"], string> = {
  open: "text-emerald-600 dark:text-emerald-400",
  merged: "text-violet-600 dark:text-violet-400",
  closed: "text-zinc-500 dark:text-zinc-400",
};

const PR_CHECKS_PRESENTATION = {
  pending: {
    label: "Pending",
    textClassName: "text-amber-600 dark:text-amber-400",
  },
  success: {
    label: "Passing",
    textClassName: "text-emerald-600 dark:text-emerald-400",
  },
  failure: {
    label: "Failing",
    textClassName: "text-red-600 dark:text-red-400",
  },
} as const;

export function presentThreadPr(
  pr: ThreadPr,
  provider: VcsStatusResult["sourceControlProvider"] | null | undefined,
): ThreadPrPresentation {
  const presentation = resolveChangeRequestPresentation(provider);
  const checksPresentation = pr.checksStatus ? PR_CHECKS_PRESENTATION[pr.checksStatus] : null;
  return {
    number: pr.number,
    state: pr.state,
    url: pr.url,
    label: String(pr.number),
    accessibilityLabel: `#${pr.number} ${presentation.longName} ${pr.state}${
      checksPresentation ? `, checks ${checksPresentation.label.toLowerCase()}` : ""
    }`,
    textClassName: PR_STATE_TEXT_CLASS[pr.state],
    checksLabel: checksPresentation?.label ?? null,
    checksTextClassName: checksPresentation?.textClassName ?? null,
  };
}
