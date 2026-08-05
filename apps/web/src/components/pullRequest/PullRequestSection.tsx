import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";

export function PullRequestSection(props: {
  readonly title: string;
  readonly defaultOpen: boolean;
  readonly badge?: ReactNode;
  readonly children: ReactNode;
  readonly onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Collapsible defaultOpen={props.defaultOpen} onOpenChange={props.onOpenChange}>
      <section className="border-b border-border/70 last:border-b-0">
        <CollapsibleTrigger className="flex min-h-10 w-full items-center gap-2 px-4 text-left text-xs font-medium text-foreground outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-panel-open:[&_svg]:rotate-90">
          <ChevronRightIcon className="size-3.5 text-muted-foreground transition-transform" />
          <span className="flex-1">{props.title}</span>
          {props.badge ? <span className={cn("shrink-0")}>{props.badge}</span> : null}
        </CollapsibleTrigger>
        <CollapsiblePanel>{props.children}</CollapsiblePanel>
      </section>
    </Collapsible>
  );
}
