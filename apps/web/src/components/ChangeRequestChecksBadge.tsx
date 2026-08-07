import type { VcsStatusResult } from "@aqqua/contracts";
import { CircleCheckIcon, CircleXIcon, Clock3Icon } from "lucide-react";

import { cn } from "~/lib/utils";

import { StatusIndicator } from "./StatusIndicator";
import { aggregateChecksPresentation, type StatusPresentation } from "./PullRequestPanel.logic";
import { Badge } from "./ui/badge";

type ChangeRequestChecksStatus = NonNullable<VcsStatusResult["pr"]>["checksStatus"];

export function ChangeRequestStatusIcon({
  presentation,
  className,
}: {
  readonly presentation: StatusPresentation;
  readonly className?: string;
}) {
  if (presentation.tone === "pending") {
    return (
      <StatusIndicator
        state="needsInput"
        label={presentation.label}
        size="size-2"
        {...(className === undefined ? {} : { className })}
      />
    );
  }

  const Icon =
    presentation.icon === "check"
      ? CircleCheckIcon
      : presentation.icon === "x"
        ? CircleXIcon
        : Clock3Icon;

  return <Icon aria-hidden className={cn("size-4 shrink-0", className)} />;
}

export function ChangeRequestChecksBadge({
  status,
  className,
}: {
  readonly status: ChangeRequestChecksStatus;
  readonly className?: string;
}) {
  const presentation = aggregateChecksPresentation(status);
  const variant =
    presentation.tone === "success"
      ? "success"
      : presentation.tone === "failure"
        ? "error"
        : presentation.tone === "pending"
          ? "warning"
          : "outline";

  return (
    <Badge
      aria-label={`Pull request checks: ${presentation.label}`}
      className={cn("gap-1", className)}
      size="sm"
      variant={variant}
    >
      <ChangeRequestStatusIcon presentation={presentation} />
      {presentation.label}
    </Badge>
  );
}
