import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";

import { FileSaveCoordinator } from "./fileSaveCoordinator";

type WriteResult = AtomCommandResult<void, Error>;

function deferred() {
  let resolve!: (result: WriteResult) => void;
  const promise = new Promise<WriteResult>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function failure(message = "write failed"): WriteResult {
  return AsyncResult.failure(Cause.fail(new Error(message)));
}

describe("FileSaveCoordinator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces edits and persists only the latest contents", async () => {
    vi.useFakeTimers();
    const persist = vi
      .fn<(contents: string) => Promise<WriteResult>>()
      .mockResolvedValue(AsyncResult.success(undefined));
    const onPendingChange = vi.fn();
    const onConfirmed = vi.fn();
    const coordinator = new FileSaveCoordinator({
      debounceMs: 500,
      persist,
      onPendingChange,
      onConfirmed,
      onError: vi.fn(),
    });

    coordinator.change("first");
    await vi.advanceTimersByTimeAsync(300);
    coordinator.change("latest");
    await vi.advanceTimersByTimeAsync(499);
    expect(persist).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith("latest");
    expect(onConfirmed).toHaveBeenCalledWith("latest");
    expect(onPendingChange.mock.calls).toEqual([[true], [true], [false]]);
  });

  it("keeps pending state until an edit made during a write is also saved", async () => {
    vi.useFakeTimers();
    const firstWrite = deferred();
    const persist = vi
      .fn<(contents: string) => Promise<WriteResult>>()
      .mockReturnValueOnce(firstWrite.promise)
      .mockResolvedValueOnce(AsyncResult.success(undefined));
    const onPendingChange = vi.fn();
    const coordinator = new FileSaveCoordinator({
      debounceMs: 500,
      persist,
      onPendingChange,
      onConfirmed: vi.fn(),
      onError: vi.fn(),
    });

    coordinator.change("first");
    await vi.advanceTimersByTimeAsync(500);
    coordinator.change("latest");
    await vi.advanceTimersByTimeAsync(500);
    expect(persist).toHaveBeenCalledTimes(1);

    firstWrite.resolve(AsyncResult.success(undefined));
    await vi.runAllTimersAsync();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenLastCalledWith("latest");
    expect(onPendingChange.mock.calls.at(-1)).toEqual([false]);
  });

  describe("flush", () => {
    it("writes immediately instead of waiting out the debounce", async () => {
      vi.useFakeTimers();
      const persist = vi
        .fn<(contents: string) => Promise<WriteResult>>()
        .mockResolvedValue(AsyncResult.success(undefined));
      const onPendingChange = vi.fn();
      const coordinator = new FileSaveCoordinator({
        debounceMs: 500,
        persist,
        onPendingChange,
        onConfirmed: vi.fn(),
        onError: vi.fn(),
      });

      coordinator.change("typed");
      coordinator.flush();
      await vi.advanceTimersByTimeAsync(0);

      expect(persist).toHaveBeenCalledOnce();
      expect(persist).toHaveBeenCalledWith("typed");
      expect(onPendingChange.mock.calls.at(-1)).toEqual([false]);

      // The debounce timer must have been cancelled, not merely pre-empted.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(persist).toHaveBeenCalledOnce();
    });

    it("does nothing when there is no buffered edit", async () => {
      vi.useFakeTimers();
      const persist = vi
        .fn<(contents: string) => Promise<WriteResult>>()
        .mockResolvedValue(AsyncResult.success(undefined));
      const coordinator = new FileSaveCoordinator({
        debounceMs: 500,
        persist,
        onPendingChange: vi.fn(),
        onConfirmed: vi.fn(),
        onError: vi.fn(),
      });

      coordinator.flush();
      await vi.runAllTimersAsync();
      expect(persist).not.toHaveBeenCalled();
    });

    it("skips the remaining debounce for an edit made during an in-flight write", async () => {
      vi.useFakeTimers();
      const firstWrite = deferred();
      const persist = vi
        .fn<(contents: string) => Promise<WriteResult>>()
        .mockReturnValueOnce(firstWrite.promise)
        .mockResolvedValue(AsyncResult.success(undefined));
      const coordinator = new FileSaveCoordinator({
        debounceMs: 500,
        persist,
        onPendingChange: vi.fn(),
        onConfirmed: vi.fn(),
        onError: vi.fn(),
      });

      coordinator.change("first");
      await vi.advanceTimersByTimeAsync(500);
      expect(persist).toHaveBeenCalledTimes(1);

      coordinator.change("latest");
      coordinator.flush();
      firstWrite.resolve(AsyncResult.success(undefined));
      await vi.advanceTimersByTimeAsync(0);

      expect(persist).toHaveBeenCalledTimes(2);
      expect(persist).toHaveBeenLastCalledWith("latest");
    });
  });

  describe("failed writes", () => {
    it("retries with backoff and clears pending once a retry succeeds", async () => {
      vi.useFakeTimers();
      const persist = vi
        .fn<(contents: string) => Promise<WriteResult>>()
        .mockResolvedValueOnce(failure())
        .mockResolvedValue(AsyncResult.success(undefined));
      const onPendingChange = vi.fn();
      const onError = vi.fn();
      const coordinator = new FileSaveCoordinator({
        debounceMs: 500,
        persist,
        onPendingChange,
        onConfirmed: vi.fn(),
        onError,
      });

      coordinator.change("latest");
      await vi.advanceTimersByTimeAsync(500);
      expect(persist).toHaveBeenCalledTimes(1);
      expect(onPendingChange).not.toHaveBeenCalledWith(false);

      // 400ms is the first backoff step; nothing before it.
      await vi.advanceTimersByTimeAsync(399);
      expect(persist).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);

      expect(persist).toHaveBeenCalledTimes(2);
      expect(persist).toHaveBeenLastCalledWith("latest");
      expect(onError).not.toHaveBeenCalled();
      expect(onPendingChange.mock.calls.at(-1)).toEqual([false]);
    });

    it("reports the failure once retries are exhausted and keeps the file pending", async () => {
      vi.useFakeTimers();
      const persist = vi
        .fn<(contents: string) => Promise<WriteResult>>()
        .mockResolvedValue(failure("disk full"));
      const onPendingChange = vi.fn();
      const onConfirmed = vi.fn();
      const onError = vi.fn();
      const coordinator = new FileSaveCoordinator({
        debounceMs: 500,
        persist,
        onPendingChange,
        onConfirmed,
        onError,
      });

      coordinator.change("latest");
      await vi.runAllTimersAsync();

      // Initial write plus two bounded retries (400ms, 800ms), then it stops.
      expect(persist).toHaveBeenCalledTimes(3);
      expect(onError).toHaveBeenCalledOnce();
      expect(onError.mock.calls[0]?.[0]).toMatchObject({ _tag: "Failure" });
      expect(onConfirmed).not.toHaveBeenCalled();
      expect(onPendingChange).toHaveBeenCalledWith(true);
      expect(onPendingChange).not.toHaveBeenCalledWith(false);
    });

    it("does not report the same failure twice while it keeps failing", async () => {
      vi.useFakeTimers();
      const persist = vi
        .fn<(contents: string) => Promise<WriteResult>>()
        .mockResolvedValue(failure());
      const onError = vi.fn();
      const coordinator = new FileSaveCoordinator({
        debounceMs: 500,
        persist,
        onPendingChange: vi.fn(),
        onConfirmed: vi.fn(),
        onError,
      });

      coordinator.change("one");
      await vi.runAllTimersAsync();
      expect(onError).toHaveBeenCalledOnce();

      coordinator.change("two");
      await vi.runAllTimersAsync();
      expect(onError).toHaveBeenCalledOnce();
    });

    it("keeps the newest contents rather than dropping the edit", async () => {
      vi.useFakeTimers();
      const persist = vi
        .fn<(contents: string) => Promise<WriteResult>>()
        .mockResolvedValueOnce(failure())
        .mockResolvedValue(AsyncResult.success(undefined));
      const onConfirmed = vi.fn();
      const coordinator = new FileSaveCoordinator({
        debounceMs: 500,
        persist,
        onPendingChange: vi.fn(),
        onConfirmed,
        onError: vi.fn(),
      });

      coordinator.change("first");
      await vi.advanceTimersByTimeAsync(500);
      expect(persist).toHaveBeenLastCalledWith("first");

      coordinator.change("second");
      await vi.runAllTimersAsync();
      expect(persist).toHaveBeenLastCalledWith("second");
      expect(onConfirmed).toHaveBeenCalledWith("second");
    });

    it("gives an explicit save a fresh retry budget after giving up", async () => {
      vi.useFakeTimers();
      const persist = vi
        .fn<(contents: string) => Promise<WriteResult>>()
        .mockResolvedValue(failure());
      const onError = vi.fn();
      const coordinator = new FileSaveCoordinator({
        debounceMs: 500,
        persist,
        onPendingChange: vi.fn(),
        onConfirmed: vi.fn(),
        onError,
      });

      coordinator.change("latest");
      await vi.runAllTimersAsync();
      expect(persist).toHaveBeenCalledTimes(3);
      expect(onError).toHaveBeenCalledOnce();

      coordinator.flush();
      await vi.runAllTimersAsync();
      expect(persist).toHaveBeenCalledTimes(6);
      expect(onError).toHaveBeenCalledTimes(2);
    });

    it("ignores an interrupted write instead of alarming the user", async () => {
      vi.useFakeTimers();
      const persist = vi
        .fn<(contents: string) => Promise<WriteResult>>()
        .mockResolvedValue(AsyncResult.failure(Cause.interrupt(1)));
      const onError = vi.fn();
      const coordinator = new FileSaveCoordinator({
        debounceMs: 500,
        persist,
        onPendingChange: vi.fn(),
        onConfirmed: vi.fn(),
        onError,
      });

      coordinator.change("latest");
      await vi.runAllTimersAsync();

      expect(persist).toHaveBeenCalledOnce();
      expect(onError).not.toHaveBeenCalled();
    });

    it("reports a failed final write from dispose without leaving a timer behind", async () => {
      vi.useFakeTimers();
      const persist = vi
        .fn<(contents: string) => Promise<WriteResult>>()
        .mockResolvedValue(failure());
      const onError = vi.fn();
      const coordinator = new FileSaveCoordinator({
        debounceMs: 500,
        persist,
        onPendingChange: vi.fn(),
        onConfirmed: vi.fn(),
        onError,
      });

      coordinator.change("latest");
      coordinator.dispose();
      await vi.advanceTimersByTimeAsync(0);

      expect(persist).toHaveBeenCalledOnce();
      expect(onError).toHaveBeenCalledOnce();

      await vi.runAllTimersAsync();
      expect(persist).toHaveBeenCalledOnce();
    });
  });
});
