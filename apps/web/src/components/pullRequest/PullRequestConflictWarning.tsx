import { TriangleAlertIcon } from "lucide-react";

export function PullRequestConflictWarning(props: { readonly baseRef: string }) {
  return (
    <div
      role="alert"
      className="mx-4 mb-3 flex items-start gap-2.5 rounded-lg bg-destructive/10 px-3 py-2.5 text-destructive"
    >
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-xs font-semibold">Merge conflicts</p>
        <p className="mt-0.5 text-pretty text-xs leading-relaxed text-destructive/90">
          This branch conflicts with <span className="font-mono">{props.baseRef}</span>. Resolve the
          conflicts before merging.
        </p>
      </div>
    </div>
  );
}
