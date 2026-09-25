/**
 * eventPoller.test.ts
 *
 * Unit tests for event subscription and cleanup behaviour.
 * Uses Jest fake timers to control polling intervals without real I/O.
 */

import {
  subscribeToEvents,
  LumenFlowEvent,
  EventFetcher,
  Unsubscribe,
} from "./eventPoller";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(name: string, ledger: number): LumenFlowEvent {
  return {
    name,
    ledger,
    timestamp: new Date().toISOString(),
    payload: {},
  };
}

/** Resolves on the next tick so async poll() can complete. */
const nextTick = () => new Promise<void>((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("subscribeToEvents()", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── Basic delivery ────────────────────────────────────────────────────────

  it("invokes the callback with events returned by the fetcher", async () => {
    const events = [makeEvent("lumenflow/payment_processed", 100)];
    const fetcher: EventFetcher = jest.fn().mockResolvedValueOnce(events);
    const callback = jest.fn();

    subscribeToEvents(callback, {}, fetcher);

    // Let the initial async poll complete.
    await nextTick();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(events);
  });

  it("does not invoke the callback when the fetcher returns an empty array", async () => {
    const fetcher: EventFetcher = jest.fn().mockResolvedValue([]);
    const callback = jest.fn();

    subscribeToEvents(callback, {}, fetcher);
    await nextTick();

    expect(callback).not.toHaveBeenCalled();
  });

  // ── Interval polling ──────────────────────────────────────────────────────

  it("polls on the configured interval", async () => {
    const fetcher: EventFetcher = jest.fn().mockResolvedValue([]);
    subscribeToEvents(jest.fn(), { pollingIntervalMs: 1000 }, fetcher);

    await nextTick(); // initial poll
    expect(fetcher).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1000);
    await nextTick();
    expect(fetcher).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(1000);
    await nextTick();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  // ── Unsubscribe ───────────────────────────────────────────────────────────

  it("returns an unsubscribe function", () => {
    const unsubscribe = subscribeToEvents(jest.fn(), {}, jest.fn().mockResolvedValue([]));
    expect(typeof unsubscribe).toBe("function");
  });

  it("stops polling after unsubscribe() is called", async () => {
    const fetcher: EventFetcher = jest.fn().mockResolvedValue([]);
    const unsubscribe = subscribeToEvents(jest.fn(), { pollingIntervalMs: 500 }, fetcher);

    await nextTick();
    unsubscribe();

    const countAfterStop = (fetcher as jest.Mock).mock.calls.length;

    jest.advanceTimersByTime(2000);
    await nextTick();

    expect((fetcher as jest.Mock).mock.calls.length).toBe(countAfterStop);
  });

  it("unsubscribe() is safe to call multiple times", async () => {
    const unsubscribe = subscribeToEvents(jest.fn(), {}, jest.fn().mockResolvedValue([]));
    await nextTick();
    expect(() => {
      unsubscribe();
      unsubscribe();
      unsubscribe();
    }).not.toThrow();
  });

  it("does not invoke the callback after unsubscribe()", async () => {
    const events = [makeEvent("lumenflow/merchant_registered", 200)];
    let resolveFetch!: (v: LumenFlowEvent[]) => void;
    const fetcher: EventFetcher = jest.fn().mockReturnValue(
      new Promise<LumenFlowEvent[]>((resolve) => {
        resolveFetch = resolve;
      })
    );
    const callback = jest.fn();

    const unsubscribe = subscribeToEvents(callback, {}, fetcher);
    unsubscribe(); // unsubscribe before the in-flight poll resolves
    resolveFetch(events);
    await nextTick();

    expect(callback).not.toHaveBeenCalled();
  });

  // ── Ledger cursor advancement ─────────────────────────────────────────────

  it("advances the ledger cursor so subsequent polls start after the last seen ledger", async () => {
    const batch1 = [makeEvent("lumenflow/payment_processed", 100)];
    const batch2 = [makeEvent("lumenflow/refund_initiated", 150)];

    const fetcher: EventFetcher = jest
      .fn()
      .mockResolvedValueOnce(batch1)
      .mockResolvedValueOnce(batch2);

    subscribeToEvents(jest.fn(), { pollingIntervalMs: 500 }, fetcher);
    await nextTick();

    jest.advanceTimersByTime(500);
    await nextTick();

    // Second call should use ledger 100 as the cursor.
    expect((fetcher as jest.Mock).mock.calls[1][0]).toBe(100);
  });

  // ── eventPrefix filter ────────────────────────────────────────────────────

  it("passes eventPrefix to the fetcher", async () => {
    const fetcher: EventFetcher = jest.fn().mockResolvedValue([]);
    subscribeToEvents(jest.fn(), { eventPrefix: "lumenflow/refund" }, fetcher);
    await nextTick();

    expect((fetcher as jest.Mock).mock.calls[0][1]).toBe("lumenflow/refund");
  });

  // ── AbortSignal ───────────────────────────────────────────────────────────

  it("stops polling when the AbortSignal is aborted", async () => {
    const controller = new AbortController();
    const fetcher: EventFetcher = jest.fn().mockResolvedValue([]);

    subscribeToEvents(jest.fn(), { pollingIntervalMs: 500, signal: controller.signal }, fetcher);
    await nextTick();

    controller.abort();

    const countAfterAbort = (fetcher as jest.Mock).mock.calls.length;
    jest.advanceTimersByTime(2000);
    await nextTick();

    expect((fetcher as jest.Mock).mock.calls.length).toBe(countAfterAbort);
  });

  it("returns a no-op unsubscribe immediately if signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const fetcher: EventFetcher = jest.fn().mockResolvedValue([]);
    const unsubscribe: Unsubscribe = subscribeToEvents(
      jest.fn(),
      { signal: controller.signal },
      fetcher
    );

    jest.advanceTimersByTime(5000);
    await nextTick();

    // Fetcher should never have been called.
    expect(fetcher).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });

  // ── Error resilience ──────────────────────────────────────────────────────

  it("does not stop polling after a fetcher error", async () => {
    const fetcher: EventFetcher = jest
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValue([]);

    subscribeToEvents(jest.fn(), { pollingIntervalMs: 500 }, fetcher);
    await nextTick();

    jest.advanceTimersByTime(500);
    await nextTick();

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not stop polling when the callback throws", async () => {
    const events = [makeEvent("lumenflow/admin_set", 50)];
    const fetcher: EventFetcher = jest.fn().mockResolvedValue(events);
    const callback = jest.fn().mockImplementation(() => {
      throw new Error("callback error");
    });

    subscribeToEvents(callback, { pollingIntervalMs: 500 }, fetcher);
    await nextTick();
    jest.advanceTimersByTime(500);
    await nextTick();

    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
