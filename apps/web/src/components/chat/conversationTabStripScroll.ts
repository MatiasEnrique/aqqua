import { useSyncExternalStore } from "react";

/**
 * The conversation tab strip's scroll position, published for controls that
 * live outside it.
 *
 * In the desktop titlebar the arrows that page the strip sit in the sidebar's
 * traffic-light row — the one place on that line with room to spare — which is
 * a different React tree from the strip they move. Rather than thread a ref
 * through the layout, the strip registers its viewport here and the arrows
 * read from it. There is only ever one strip mounted, so a module store is the
 * whole coordination.
 */

/** How much of the visible strip one nudge travels. */
const NUDGE_RATIO = 0.8;

/** Sub-pixel scroll offsets are routine, so the edges need a little tolerance. */
const EDGE_EPSILON = 1;

export type ConversationTabStripScroll = {
  /** False when no strip is mounted — settings and usage have no tabs. */
  readonly present: boolean;
  readonly canScrollStart: boolean;
  readonly canScrollEnd: boolean;
};

const ABSENT: ConversationTabStripScroll = {
  present: false,
  canScrollStart: false,
  canScrollEnd: false,
};

let viewport: HTMLElement | null = null;
let observer: ResizeObserver | null = null;
let snapshot: ConversationTabStripScroll = ABSENT;
const listeners = new Set<() => void>();

const publish = (next: ConversationTabStripScroll) => {
  if (
    next.present === snapshot.present &&
    next.canScrollStart === snapshot.canScrollStart &&
    next.canScrollEnd === snapshot.canScrollEnd
  ) {
    return;
  }
  snapshot = next;
  for (const listener of listeners) listener();
};

const measure = () => {
  if (viewport === null) {
    publish(ABSENT);
    return;
  }
  const remaining = viewport.scrollWidth - viewport.clientWidth - viewport.scrollLeft;
  publish({
    present: true,
    canScrollStart: viewport.scrollLeft > EDGE_EPSILON,
    canScrollEnd: remaining > EDGE_EPSILON,
  });
};

/**
 * Publish a strip's scroll viewport, or `null` to retract it. Returns nothing:
 * callers unregister by registering `null` when they unmount.
 */
export function registerConversationTabStrip(element: HTMLElement | null): void {
  if (viewport === element) return;

  viewport?.removeEventListener("scroll", measure);
  observer?.disconnect();
  observer = null;
  viewport = element;

  if (element === null) {
    measure();
    return;
  }

  element.addEventListener("scroll", measure, { passive: true });
  // The list grows with tabs and with retitled conversations, so watch the
  // content as well as the viewport rather than only its own box.
  observer = new ResizeObserver(measure);
  observer.observe(element);
  const list = element.firstElementChild;
  if (list !== null) observer.observe(list);
  measure();
}

/** Move the strip by most of a screenful; -1 scrolls left, 1 scrolls right. */
export function nudgeConversationTabStrip(direction: -1 | 1): void {
  viewport?.scrollBy({
    left: direction * viewport.clientWidth * NUDGE_RATIO,
    behavior: "smooth",
  });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => snapshot;

export function useConversationTabStripScroll(): ConversationTabStripScroll {
  return useSyncExternalStore(subscribe, getSnapshot, () => ABSENT);
}
