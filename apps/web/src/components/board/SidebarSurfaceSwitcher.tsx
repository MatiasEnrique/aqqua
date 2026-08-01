import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { LayoutGridIcon, MessageSquareIcon } from "lucide-react";

import { cn } from "~/lib/utils";

type ProjectRef = {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
};

export function SidebarSurfaceSwitcher(props: { readonly scopedProjectRef: ProjectRef | null }) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const routeParams = useParams({ strict: false });
  const isBoard = pathname.startsWith("/board/");
  const boardProjectRef = isBoard
    ? {
        environmentId: routeParams.environmentId as EnvironmentId,
        projectId: routeParams.projectId as ProjectId,
      }
    : props.scopedProjectRef;

  return (
    <nav
      aria-label="Workspace view"
      className="grid grid-cols-2 gap-0.5 rounded-lg bg-sidebar-control-surface p-0.5"
    >
      <SurfaceTab
        active={!isBoard}
        icon={<MessageSquareIcon aria-hidden className="size-3.5 shrink-0" />}
        label="Conversations"
        onClick={() => void navigate({ to: "/" })}
      />
      <SurfaceTab
        active={isBoard}
        icon={<LayoutGridIcon aria-hidden className="size-3.5 shrink-0" />}
        label="Board"
        aria-label={
          boardProjectRef ? "Open agentic board" : "Select a project to open its agentic board"
        }
        disabled={boardProjectRef === null}
        onClick={() => {
          if (boardProjectRef === null) return;
          void navigate({
            to: "/board/$environmentId/$projectId",
            params: boardProjectRef,
          });
        }}
      />
    </nav>
  );
}

function SurfaceTab({
  active,
  icon,
  label,
  ...props
}: React.ComponentProps<"button"> & {
  readonly active: boolean;
  readonly icon: React.ReactNode;
  readonly label: string;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs outline-none transition-[color,background-color,box-shadow,scale] focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] motion-reduce:transform-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:text-sidebar-muted-foreground [&_svg]:opacity-60",
        active
          ? "bg-sidebar-row-active font-medium text-sidebar-foreground shadow-xs ring-1 ring-sidebar-border/60 [&_svg]:text-sidebar-foreground [&_svg]:opacity-100"
          : "text-sidebar-muted-foreground hover:text-sidebar-foreground hover:[&_svg]:text-sidebar-foreground hover:[&_svg]:opacity-100",
      )}
      {...props}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}
