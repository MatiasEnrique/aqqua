import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";

import * as Electron from "electron";

import { makeComponentLogger } from "../app/DesktopObservability.ts";
import type { DesktopIpcNavigationListener, DesktopIpcSender } from "../ipc/DesktopIpc.ts";

export interface PowerSaveBlockerApi {
  readonly start: (type: "prevent-display-sleep") => number;
  readonly stop: (id: number) => void;
  readonly isStarted: (id: number) => boolean;
}

export interface OrphanReleaseScheduler {
  readonly schedule: (release: () => void, delayMs: number) => () => void;
}

interface RequesterRegistration {
  readonly sender: DesktopIpcSender;
  readonly onDestroyed: () => void;
  readonly onNavigationStarted: DesktopIpcNavigationListener;
  cancelOrphanRelease: (() => void) | null;
}

export const ORPHANED_RENDERER_RELEASE_MS = 2 * 60 * 60 * 1_000;

export class ElectronPowerSaveBlocker extends Context.Service<
  ElectronPowerSaveBlocker,
  {
    readonly setAgentActive: (sender: DesktopIpcSender, active: boolean) => Effect.Effect<void>;
  }
>()("@aqqua/desktop/electron/ElectronPowerSaveBlocker") {}

const { logWarning } = makeComponentLogger("agent-awake");

function reportBlockerFailure(message: string, cause: unknown): void {
  Effect.runFork(logWarning(message, { cause }));
}

export const make = Effect.fn("desktop.electron.powerSaveBlocker.make")(function* (
  blocker: PowerSaveBlockerApi = Electron.powerSaveBlocker,
  injectedOrphanReleaseScheduler?: OrphanReleaseScheduler,
) {
  const context = yield* Effect.context<never>();
  const runFork = Effect.runForkWith(context);
  const orphanReleaseScheduler =
    injectedOrphanReleaseScheduler ??
    ({
      schedule: (release, delayMs) => {
        const fiber = runFork(Effect.sleep(delayMs).pipe(Effect.andThen(Effect.sync(release))));
        return () => {
          runFork(Fiber.interrupt(fiber));
        };
      },
    } satisfies OrphanReleaseScheduler);
  const requesters = new Map<number, RequesterRegistration>();
  let blockerId: number | null = null;

  const stopBlocker = () => {
    if (blockerId === null) return;
    const activeBlockerId = blockerId;
    blockerId = null;
    try {
      if (blocker.isStarted(activeBlockerId)) {
        blocker.stop(activeBlockerId);
      }
    } catch (error) {
      reportBlockerFailure("Failed to stop the display sleep blocker.", error);
    }
  };

  const reconcile = () => {
    if (requesters.size === 0) {
      stopBlocker();
      return;
    }
    if (blockerId !== null) {
      try {
        if (blocker.isStarted(blockerId)) return;
      } catch (error) {
        reportBlockerFailure("Failed to inspect the display sleep blocker.", error);
        return;
      }
    }
    try {
      blockerId = blocker.start("prevent-display-sleep");
    } catch (error) {
      blockerId = null;
      reportBlockerFailure("Failed to start the display sleep blocker.", error);
    }
  };

  const removeRequester = (senderId: number) => {
    const registration = requesters.get(senderId);
    if (registration === undefined) return;
    requesters.delete(senderId);
    registration.sender.removeListener("destroyed", registration.onDestroyed);
    registration.sender.removeListener("did-start-navigation", registration.onNavigationStarted);
    registration.cancelOrphanRelease?.();
  };

  const releaseRequester = (senderId: number) => {
    removeRequester(senderId);
    reconcile();
  };

  const markRequesterOrphaned = (senderId: number) => {
    const registration = requesters.get(senderId);
    if (registration === undefined || registration.cancelOrphanRelease !== null) return;
    registration.cancelOrphanRelease = orphanReleaseScheduler.schedule(
      () => releaseRequester(senderId),
      ORPHANED_RENDERER_RELEASE_MS,
    );
  };

  const clearOrphanedRequesters = () => {
    for (const [senderId, registration] of requesters) {
      if (registration.cancelOrphanRelease !== null) removeRequester(senderId);
    }
  };

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const registration of requesters.values()) {
        registration.sender.removeListener("destroyed", registration.onDestroyed);
        registration.sender.removeListener(
          "did-start-navigation",
          registration.onNavigationStarted,
        );
        registration.cancelOrphanRelease?.();
      }
      requesters.clear();
      stopBlocker();
    }),
  );

  return ElectronPowerSaveBlocker.of({
    setAgentActive: (sender, active) =>
      Effect.sync(() => {
        clearOrphanedRequesters();
        if (!active || sender.isDestroyed()) {
          removeRequester(sender.id);
          reconcile();
          return;
        }
        if (!requesters.has(sender.id)) {
          const onDestroyed = () => markRequesterOrphaned(sender.id);
          const onNavigationStarted: DesktopIpcNavigationListener = (event) => {
            if (event.isSameDocument || !event.isMainFrame) return;
            markRequesterOrphaned(sender.id);
          };
          requesters.set(sender.id, {
            sender,
            onDestroyed,
            onNavigationStarted,
            cancelOrphanRelease: null,
          });
          sender.once("destroyed", onDestroyed);
          sender.on("did-start-navigation", onNavigationStarted);
        }
        reconcile();
      }),
  });
});

export const layer = Layer.effect(ElectronPowerSaveBlocker, make());

export const layerTest = (
  blocker: PowerSaveBlockerApi,
  orphanReleaseScheduler?: OrphanReleaseScheduler,
) => Layer.effect(ElectronPowerSaveBlocker, make(blocker, orphanReleaseScheduler));
