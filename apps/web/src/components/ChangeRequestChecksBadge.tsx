import type { VcsStatusResult } from "@aqqua/contracts";
import { CircleCheckIcon, CircleXIcon, Clock3Icon } from "lucide-react";

import { cn } from "~/lib/utils";

import { aggregateChecksPresentation } from "./PullRequestPanel.logic";
import { Badge } from "./ui/badge";

type ChangeRequestChecksStatus = NonNullable<VcsStatusResult["pr"]>["checksStatus"];

export function ChangeRequestChecksBadge({
  status,
  className,
}: {
  readonly status: ChangeRequestChecksStatus;
  readonly className?: string;
}) {
  const presentation = aggregateChecksPresentation(status);
  const Icon =
    presentation.icon === "check"
      ? CircleCheckIcon
      : presentation.icon === "x"
        ? CircleXIcon
        : Clock3Icon;
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
      <Icon aria-hidden />
      {presentation.label}
    </Badge>
  );
}
