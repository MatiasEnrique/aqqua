import type { EnvironmentId, ProjectId, ThreadId } from "@aqqua/contracts";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
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
      /* Word-only, and no rule beneath it. Two surfaces do not need a tab bar:
         at this size the words carry the switch, and the sidebar's first
         hairline is better spent on something the eye has to find. */
      className="flex shrink-0 items-center gap-3.5"
    >
      <SurfaceTab
        active={displayedSurface === "threads"}
        current={!isBoard}
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
  label,
  ...props
}: React.ComponentProps<"button"> & {
  readonly active: boolean;
  readonly current: boolean;
  readonly label: string;
}) {
  return (
    <button
      type="button"
      aria-current={current ? "page" : undefined}
      className={cn(
        "shrink-0 cursor-pointer rounded-sm text-xs outline-none transition-colors duration-(--duration-fast) ease-(--ease-fluid) focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar disabled:pointer-events-none disabled:opacity-50",
        // Weight is the whole indicator. It reads at a glance without spending
        // a rule, a chip or a colour on a two-item switch.
        active
          ? "font-semibold text-sidebar-foreground"
          : "text-sidebar-muted-foreground hover:text-sidebar-foreground",
      )}
      {...props}
    >
      {label}
    </button>
  );
}
