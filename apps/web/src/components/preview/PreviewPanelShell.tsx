import { type ReactNode, useEffect, useLayoutEffect, useState } from "react";

import { isElectron } from "~/env";
import { useResizableWidth } from "~/hooks/useResizableWidth";
import { cn } from "~/lib/utils";

import { RightPanelResizeHandle } from "./RightPanelResizeHandle";

export type PreviewPanelMode = "inline" | "sheet" | "sidebar" | "embedded";

const PREVIEW_PANEL_WIDTH_STORAGE_KEY = "aqqua:preview-panel-width";
const PREVIEW_PANEL_MIN_WIDTH = 360;
/** Fraction of the viewport allowed, preserving the remaining space for chat. */
const PREVIEW_PANEL_MAX_WIDTH_FRACTION = 0.7;
const PREVIEW_PANEL_DEFAULT_WIDTH = 540;

export function getPreviewPanelMaxWidth(availableWidth: number): number {
  return Math.max(
    PREVIEW_PANEL_MIN_WIDTH,
    Math.min(Math.floor(availableWidth * PREVIEW_PANEL_MAX_WIDTH_FRACTION), availableWidth - 400),
  );
}

/**
 * Shell for the preview panel. In inline mode the panel is user-resizable
 * via a drag handle on the left edge; width persists per browser. In
 * sheet/sidebar modes the parent owns the size.
 */
export function PreviewPanelShell(props: {
  mode: PreviewPanelMode;
  maximized?: boolean;
  collapsed?: boolean;
  children: ReactNode;
}) {
  const useDragRegion = isElectron && props.mode !== "sheet" && props.mode !== "embedded";
  const isInline = props.mode === "inline";
  const isCollapsed = props.collapsed === true;
  const viewportMaxWidth = useViewportClampedMaxWidth();
  const [panelElement, setPanelElement] = useState<HTMLDivElement | null>(null);
  const parentWidth = useParentWidth(panelElement, isInline && !isCollapsed);
  const maxWidth =
    parentWidth === undefined ? viewportMaxWidth : getPreviewPanelMaxWidth(parentWidth);
  const { width, handlers } = useResizableWidth({
    storageKey: PREVIEW_PANEL_WIDTH_STORAGE_KEY,
    defaultWidth: PREVIEW_PANEL_DEFAULT_WIDTH,
    minWidth: PREVIEW_PANEL_MIN_WIDTH,
    maxWidth,
    edge: "left",
  });

  return (
    <div
      ref={setPanelElement}
      className={cn(
        // Chrome-coloured shell: the panel's own content surface paints the
        // background, so the leading gutter reads as a gap between two cards
        // rather than one continuous slab shared with the chat column.
        "relative flex h-full min-h-0 min-w-0 flex-col self-stretch bg-sidebar",
        isCollapsed
          ? "w-11 shrink-0"
          : isInline
            ? props.maximized
              ? "flex-1"
              : "shrink-0"
            : "w-full",
        isInline && !isCollapsed && "md:ms-1.5",
      )}
      style={isInline && !isCollapsed && !props.maximized ? { width: `${width}px` } : undefined}
      data-preview-panel-mode={props.mode}
      data-preview-panel-maximized={props.maximized ? "true" : "false"}
    >
      {isInline && !isCollapsed && !props.maximized ? (
        <RightPanelResizeHandle
          handlers={handlers}
          className="top-[var(--workspace-topbar-height)]"
        />
      ) : null}
      {useDragRegion && !isCollapsed ? (
        <div className="electron-drag-region h-0 w-full" aria-hidden />
      ) : null}
      {props.children}
    </div>
  );
}

function useParentWidth(element: HTMLDivElement | null, enabled: boolean): number | undefined {
  const [width, setWidth] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const parent = enabled ? element?.parentElement : null;
    if (!parent) {
      setWidth(undefined);
      return;
    }
    const update = () => setWidth(parent.clientWidth);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [element, enabled]);
  return width;
}

/**
 * Track viewport width to derive a sensible upper bound for the panel.
 * Resize-aware so dragging the OS window narrower re-clamps the stored
 * width on the next render (the hook's clamp picks this up automatically).
 */
function useViewportClampedMaxWidth(): number {
  const [vw, setVw] = useState(() => (typeof window === "undefined" ? 1280 : window.innerWidth));
  useEffect(() => {
    if (typeof window === "undefined") return;
    let frame = 0;
    const onResize = () => {
      // Coalesce rapid resize events into one rAF tick.
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setVw(window.innerWidth);
      });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);
  return getPreviewPanelMaxWidth(vw);
}
