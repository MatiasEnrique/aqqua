import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";

import type { DesktopIpcNavigationListener, DesktopIpcSender } from "../ipc/DesktopIpc.ts";
import * as ElectronPowerSaveBlocker from "./ElectronPowerSaveBlocker.ts";

function makeSender(id: number) {
  let destroyed = false;
  const destroyedListeners = new Set<() => void>();
  const navigationListeners = new Set<DesktopIpcNavigationListener>();
  const sender: DesktopIpcSender = {
    id,
    isDestroyed: () => destroyed,
    on: (_eventName, listener) => {
      navigationListeners.add(listener);
    },
    once: (_eventName, listener) => {
      destroyedListeners.add(listener);
    },
    removeListener: (eventName, listener) => {
      if (eventName === "destroyed") {
        destroyedListeners.delete(listener as () => void);
      } else {
        navigationListeners.delete(listener as DesktopIpcNavigationListener);
      }
    },
  };
  return {
    sender,
    destroy: () => {
      destroyed = true;
      for (const listener of destroyedListeners) listener();
    },
    reload: () => {
      for (const listener of navigationListeners) {
        listener({ isSameDocument: false, isMainFrame: true });
      }
    },
    listenerCount: () => destroyedListeners.size,
  };
}

function makeBlocker() {
  const started = new Set<number>();
  let nextId = 1;
  return {
    api: {
      start: vi.fn(() => {
        const id = nextId++;
        started.add(id);
        return id;
      }),
      stop: vi.fn((id: number) => {
        started.delete(id);
      }),
      isStarted: vi.fn((id: number) => started.has(id)),
    },
    started,
  };
}

function makeOrphanReleaseScheduler() {
  let release: (() => void) | null = null;
  let delayMs: number | null = null;
  const cancel = vi.fn(() => {
    release = null;
  });
  return {
    scheduler: {
      schedule: vi.fn((nextRelease: () => void, nextDelayMs: number) => {
        release = nextRelease;
        delayMs = nextDelayMs;
        return cancel;
      }),
    },
    cancel,
    delayMs: () => delayMs,
    release: () => release?.(),
  };
}

describe("ElectronPowerSaveBlocker", () => {
  it.effect("holds one blocker until the final active renderer releases it", () =>
    Effect.gen(function* () {
      const blocker = makeBlocker();
      const first = makeSender(1);
      const second = makeSender(2);

      yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* ElectronPowerSaveBlocker.ElectronPowerSaveBlocker;
          yield* service.setAgentActive(first.sender, true);
          yield* service.setAgentActive(second.sender, true);
          assert.equal(blocker.api.start.mock.calls.length, 1);
          assert.equal(blocker.started.size, 1);

          yield* service.setAgentActive(first.sender, false);
          assert.equal(blocker.api.stop.mock.calls.length, 0);
          assert.equal(blocker.started.size, 1);

          yield* service.setAgentActive(second.sender, false);
          assert.equal(blocker.api.stop.mock.calls.length, 1);
          assert.equal(blocker.started.size, 0);
        }).pipe(Effect.provide(ElectronPowerSaveBlocker.layerTest(blocker.api))),
      );
    }),
  );

  it.effect("bounds an orphaned renderer request instead of releasing it immediately", () =>
    Effect.gen(function* () {
      const blocker = makeBlocker();
      const requester = makeSender(7);
      const orphanRelease = makeOrphanReleaseScheduler();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* ElectronPowerSaveBlocker.ElectronPowerSaveBlocker;
          yield* service.setAgentActive(requester.sender, true);
          assert.equal(requester.listenerCount(), 1);
          requester.destroy();
          assert.equal(blocker.api.stop.mock.calls.length, 0);
          assert.equal(blocker.started.size, 1);
          assert.equal(
            orphanRelease.delayMs(),
            ElectronPowerSaveBlocker.ORPHANED_RENDERER_RELEASE_MS,
          );

          orphanRelease.release();
          assert.equal(blocker.api.stop.mock.calls.length, 1);
          assert.equal(blocker.started.size, 0);
        }).pipe(
          Effect.provide(ElectronPowerSaveBlocker.layerTest(blocker.api, orphanRelease.scheduler)),
        ),
      );
    }),
  );

  it.effect("bounds a renderer reload without dropping an active blocker", () =>
    Effect.gen(function* () {
      const blocker = makeBlocker();
      const requester = makeSender(7);
      const orphanRelease = makeOrphanReleaseScheduler();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* ElectronPowerSaveBlocker.ElectronPowerSaveBlocker;
          yield* service.setAgentActive(requester.sender, true);
          requester.reload();

          assert.equal(orphanRelease.scheduler.schedule.mock.calls.length, 1);
          assert.equal(blocker.api.stop.mock.calls.length, 0);
          assert.equal(blocker.started.size, 1);

          yield* service.setAgentActive(requester.sender, true);
          assert.equal(orphanRelease.cancel.mock.calls.length, 1);
          assert.equal(blocker.api.stop.mock.calls.length, 0);
          assert.equal(blocker.started.size, 1);

          requester.reload();
          orphanRelease.release();
          assert.equal(blocker.api.stop.mock.calls.length, 1);
          assert.equal(blocker.started.size, 0);
        }).pipe(
          Effect.provide(ElectronPowerSaveBlocker.layerTest(blocker.api, orphanRelease.scheduler)),
        ),
      );
    }),
  );

  it.effect("preserves an orphaned request when another renderer reports inactive", () =>
    Effect.gen(function* () {
      const blocker = makeBlocker();
      const orphaned = makeSender(7);
      const replacement = makeSender(8);
      const orphanRelease = makeOrphanReleaseScheduler();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* ElectronPowerSaveBlocker.ElectronPowerSaveBlocker;
          yield* service.setAgentActive(orphaned.sender, true);
          orphaned.destroy();

          yield* service.setAgentActive(replacement.sender, false);

          assert.equal(orphanRelease.cancel.mock.calls.length, 0);
          assert.equal(blocker.api.stop.mock.calls.length, 0);
          assert.equal(blocker.started.size, 1);

          orphanRelease.release();
          assert.equal(blocker.api.stop.mock.calls.length, 1);
          assert.equal(blocker.started.size, 0);
        }).pipe(
          Effect.provide(ElectronPowerSaveBlocker.layerTest(blocker.api, orphanRelease.scheduler)),
        ),
      );
    }),
  );

  it.effect("releases orphaned requests when the preference is disabled", () =>
    Effect.gen(function* () {
      const blocker = makeBlocker();
      const orphaned = makeSender(7);
      const replacement = makeSender(8);
      const orphanRelease = makeOrphanReleaseScheduler();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* ElectronPowerSaveBlocker.ElectronPowerSaveBlocker;
          yield* service.setAgentActive(orphaned.sender, true);
          orphaned.destroy();

          yield* service.setAgentActive(replacement.sender, false, { releaseOrphans: true });

          assert.equal(orphanRelease.cancel.mock.calls.length, 1);
          assert.equal(blocker.api.stop.mock.calls.length, 1);
          assert.equal(blocker.started.size, 0);
        }).pipe(
          Effect.provide(ElectronPowerSaveBlocker.layerTest(blocker.api, orphanRelease.scheduler)),
        ),
      );
    }),
  );

  it.effect("stops the blocker and detaches listeners when the desktop scope closes", () =>
    Effect.gen(function* () {
      const blocker = makeBlocker();
      const requester = makeSender(9);

      yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* ElectronPowerSaveBlocker.ElectronPowerSaveBlocker;
          yield* service.setAgentActive(requester.sender, true);
        }).pipe(Effect.provide(ElectronPowerSaveBlocker.layerTest(blocker.api))),
      );

      assert.equal(blocker.api.stop.mock.calls.length, 1);
      assert.equal(blocker.started.size, 0);
      assert.equal(requester.listenerCount(), 0);
    }),
  );
});
