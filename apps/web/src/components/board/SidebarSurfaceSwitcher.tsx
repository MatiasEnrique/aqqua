import type { EnvironmentId, ProjectId, ThreadId } from "@aqqua/contracts";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { MessageSquareIcon, WorkflowIcon } from "lucide-react";
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
  readonly orientation?: "inline" | "rows";
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
  const orientation = props.orientation ?? "inline";
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
      className={cn(
        "flex shrink-0",
        orientation === "rows" ? "w-full flex-col gap-0.5" : "-mr-1.5 items-center gap-0.5",
      )}
    >
      <SurfaceTab
        active={displayedSurface === "threads"}
        current={!isBoard}
        icon={<MessageSquareIcon aria-hidden />}
        label="Threads"
        orientation={orientation}
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
        icon={<WorkflowIcon aria-hidden />}
        label="Flows"
        orientation={orientation}
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
  orientation,
  ...props
}: React.ComponentProps<"button"> & {
  readonly active: boolean;
  readonly current: boolean;
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly orientation: "inline" | "rows";
}) {
  return (
    <button
      type="button"
      aria-current={current ? "page" : undefined}
      className={cn(
        // Word-only, but not a word-sized target: a bare `text-xs` button is a
        // 12px-tall hit area, and this is the primary surface switch — reachable
        // by thumb in the sidebar header. Padding brings it to WCAG 2.5.8's
        // 24px without changing how it reads.
        "inline-flex min-h-6 shrink-0 cursor-pointer items-center rounded-md outline-none transition-colors duration-(--duration-fast) ease-(--ease-fluid) focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar disabled:pointer-events-none disabled:opacity-50",
        orientation === "rows"
          ? "h-8 w-full justify-start gap-1.5 px-1 text-[13px] font-medium leading-5"
          : "gap-0.5 px-1.5 py-1 text-xs",
        // Weight is the whole indicator. It reads at a glance without spending
        // a rule, a chip or a colour on a two-item switch.
        active
          ? orientation === "rows"
            ? "font-medium text-sidebar-foreground"
            : "font-semibold text-sidebar-foreground"
          : "text-sidebar-foreground/80 hover:text-sidebar-foreground",
      )}
      {...props}
    >
      <span
        className={cn(
          orientation === "rows"
            ? "text-sidebar-muted-foreground [&_svg]:size-3.5 [&_svg]:stroke-[1.5]"
            : "hidden",
        )}
      >
        {icon}
      </span>
      {label}
    </button>
  );
}
