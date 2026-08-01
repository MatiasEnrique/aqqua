import { useSyncExternalStore } from "react";

interface SidebarRelativeTimeClock {
  nowMs: number;
  intervalId: ReturnType<typeof setInterval> | null;
  readonly listeners: Set<() => void>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => number;
}

const clock: SidebarRelativeTimeClock = {
  nowMs: Date.now(),
  intervalId: null,
  listeners: new Set(),
  subscribe(listener) {
    clock.listeners.add(listener);
    if (clock.intervalId === null) {
      clock.intervalId = setInterval(() => {
        clock.nowMs = Date.now();
        for (const notify of clock.listeners) notify();
      }, 1_000);
    }
    return () => {
      clock.listeners.delete(listener);
      if (clock.listeners.size === 0 && clock.intervalId !== null) {
        clearInterval(clock.intervalId);
        clock.intervalId = null;
      }
    };
  },
  getSnapshot: () => clock.nowMs,
};

/** One sidebar clock shared by every leaf relative-time label. */
export function useSidebarRelativeTimeTick() {
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot);
}
