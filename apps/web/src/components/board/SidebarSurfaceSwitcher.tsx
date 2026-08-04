import type { EnvironmentId, ProjectId, ThreadId } from "@aqqua/contracts";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { LayoutGridIcon, MessageSquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import {
  requestSidebarSurfaceNavigation,
  resolveConversationSurfaceTarget,
  resolveDisplayedSidebarSurface,
  type ConversationSurfaceTarget,
  type SidebarSurface,
} from "./SidebarSurfaceSwitcher.logic";

type ProjectRef = {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
};

export function SidebarSurfaceSwitcher(props: {
  readonly scopedProjectRef: ProjectRef | null;
  readonly onFlowsIntent?: () => void;
}) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const routeParams = useParams({ strict: false });
  const isBoard = pathname.startsWith("/board/");
  const routeSurface: SidebarSurface = isBoard ? "flows" : "threads";
  const [pendingSurface, setPendingSurface] = useState<SidebarSurface | null>(null);
  const displayedSurface = resolveDisplayedSidebarSurface(routeSurface, pendingSurface);
  const conversationTargetRef = useRef<ConversationSurfaceTarget>({ kind: "index" });
  const navigationFrameRef = useRef<number | null>(null);
  const routeEnvironmentId = routeParams.environmentId;
  const routeThreadId = routeParams.threadId;
  const routeDraftId = routeParams.draftId;
  useEffect(() => {
    conversationTargetRef.current = resolveConversationSurfaceTarget(
      {
        isBoard,
        params: {
          environmentId: routeEnvironmentId,
          threadId: routeThreadId,
          draftId: routeDraftId,
        },
      },
      conversationTargetRef.current,
    );
  }, [isBoard, routeDraftId, routeEnvironmentId, routeThreadId]);
  useEffect(() => {
    setPendingSurface(null);
  }, [routeSurface]);
  useEffect(
    () => () => {
      if (navigationFrameRef.current !== null) {
        window.cancelAnimationFrame(navigationFrameRef.current);
      }
    },
    [],
  );
  const boardProjectRef = isBoard
    ? {
        environmentId: routeParams.environmentId as EnvironmentId,
        projectId: routeParams.projectId as ProjectId,
      }
    : props.scopedProjectRef;
  const afterSurfacePaint = (run: () => void) => {
    if (navigationFrameRef.current !== null) {
      window.cancelAnimationFrame(navigationFrameRef.current);
    }
    navigationFrameRef.current = window.requestAnimationFrame(() => {
      navigationFrameRef.current = window.requestAnimationFrame(() => {
        navigationFrameRef.current = null;
        run();
      });
    });
  };
  const navigateToThreads = () => {
    const target = conversationTargetRef.current;
    const navigation =
      target.kind === "thread"
        ? navigate({
            to: "/$environmentId/$threadId",
            params: {
              environmentId: target.environmentId as EnvironmentId,
              threadId: target.threadId as ThreadId,
            },
          })
        : target.kind === "draft"
          ? navigate({ to: "/draft/$draftId", params: { draftId: target.draftId } })
          : navigate({ to: "/" });
    void navigation.catch(() => setPendingSurface(null));
  };

  return (
    <nav
      aria-label="Workspace view"
      /* Bleeds past the header group's p-2 so the bar spans the full sidebar
         width and sits flush against its edges. */
      className="-mx-2 -mt-2 mb-1 grid grid-cols-2 border-b border-sidebar-border"
    >
      <SurfaceTab
        active={displayedSurface === "threads"}
        current={!isBoard}
        icon={<MessageSquareIcon aria-hidden className="size-3.5 shrink-0" />}
        label="Threads"
        onClick={() => {
          requestSidebarSurfaceNavigation({
            surface: "threads",
            setPendingSurface,
            afterPaint: afterSurfacePaint,
            navigate: navigateToThreads,
          });
        }}
      />
      <SurfaceTab
        active={displayedSurface === "flows"}
        current={isBoard}
        icon={<LayoutGridIcon aria-hidden className="size-3.5 shrink-0" />}
        label="Flows"
        aria-label={boardProjectRef ? "Open Flows" : "Select a project to open its flows"}
        disabled={boardProjectRef === null}
        onMouseEnter={props.onFlowsIntent}
        onFocus={props.onFlowsIntent}
        onClick={() => {
          if (boardProjectRef === null) return;
          props.onFlowsIntent?.();
          requestSidebarSurfaceNavigation({
            surface: "flows",
            setPendingSurface,
            afterPaint: afterSurfacePaint,
            navigate: () => {
              void navigate({
                to: "/board/$environmentId/$projectId",
                params: boardProjectRef,
              }).catch(() => setPendingSurface(null));
            },
          });
        }}
      />
    </nav>
  );
}

function SurfaceTab({
  active,
  current,
  icon,
  label,
  ...props
}: React.ComponentProps<"button"> & {
  readonly active: boolean;
  readonly current: boolean;
  readonly icon: React.ReactNode;
  readonly label: string;
}) {
  return (
    <button
      type="button"
      aria-current={current ? "page" : undefined}
      className={cn(
        "relative flex h-9 min-w-0 items-center justify-center gap-1.5 px-2 text-xs outline-none transition-colors duration-(--duration-fast) ease-(--ease-fluid) focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50 [&_svg]:text-sidebar-muted-foreground [&_svg]:opacity-60",
        // Underline indicator rather than a raised chip: at full bleed there is
        // no track left for a chip to sit in, and the brand carries separation
        // with hairlines instead of elevation.
        active
          ? "font-medium text-sidebar-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-foreground [&_svg]:text-sidebar-foreground [&_svg]:opacity-100"
          : "text-sidebar-muted-foreground hover:text-sidebar-foreground hover:[&_svg]:text-sidebar-foreground hover:[&_svg]:opacity-100",
      )}
      {...props}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}
