import { subscribe } from "../events";
import { withRetry } from "../retry";

/**
 * Failure-injection tests for upstream Horizon outages.
 *
 * Horizon (SSE stream) and Soroban RPC are external dependencies that regularly
 * return 5xx, time out, or drop connections. These tests inject those failures
 * and assert the SDK degrades gracefully: the event stream reconnects with
 * capped exponential backoff and can still be torn down cleanly, and read
 * helpers retry transient errors but surface permanent ones immediately.
 */

type Listener = ((ev: unknown) => void) | null;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: Listener = null;
  onerror: Listener = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  /** Simulate an upstream Horizon outage (connection error). */
  failUpstream(): void {
    this.onerror?.(new Event("error"));
  }

  /** Simulate a successful event delivery. */
  deliver(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

describe("Horizon SSE outage injection", () => {
  const original = (globalThis as { EventSource?: unknown }).EventSource;

  beforeEach(() => {
    jest.useFakeTimers();
    FakeEventSource.instances = [];
    (globalThis as { EventSource: unknown }).EventSource = FakeEventSource;
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    (globalThis as { EventSource?: unknown }).EventSource = original;
  });

  it("reconnects with exponential backoff during a sustained outage", () => {
    const received: unknown[] = [];
    const unsubscribe = subscribe("CID", {}, (e) => received.push(e));

    expect(FakeEventSource.instances).toHaveLength(1);

    // First outage → reconnect after ~1s
    FakeEventSource.instances[0].failUpstream();
    jest.advanceTimersByTime(1_000);
    expect(FakeEventSource.instances).toHaveLength(2);

    // Second outage → backoff doubles to ~2s (1s is not enough)
    FakeEventSource.instances[1].failUpstream();
    jest.advanceTimersByTime(1_000);
    expect(FakeEventSource.instances).toHaveLength(2);
    jest.advanceTimersByTime(1_000);
    expect(FakeEventSource.instances).toHaveLength(3);

    unsubscribe();
  });

  it("caps the backoff delay at 30s", () => {
    const unsubscribe = subscribe("CID", {}, () => {});
    for (let i = 0; i < 10; i++) {
      FakeEventSource.instances[FakeEventSource.instances.length - 1].failUpstream();
      jest.advanceTimersByTime(30_000);
    }
    const before = FakeEventSource.instances.length;
    FakeEventSource.instances[before - 1].failUpstream();
    jest.advanceTimersByTime(30_000);
    expect(FakeEventSource.instances.length).toBe(before + 1);
    unsubscribe();
  });

  it("stops reconnecting once unsubscribed mid-outage", () => {
    const unsubscribe = subscribe("CID", {}, () => {});
    FakeEventSource.instances[0].failUpstream();
    unsubscribe();
    jest.advanceTimersByTime(120_000);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it("resumes delivering events after the outage clears", () => {
    const received: Array<{ id: string }> = [];
    const unsubscribe = subscribe("CID", {}, (e) => received.push(e as { id: string }));
    FakeEventSource.instances[0].failUpstream();
    jest.advanceTimersByTime(1_000);
    FakeEventSource.instances[1].deliver({ id: "42", type: "contract", topic: ["a", "b"] });
    expect(received).toHaveLength(1);
    expect(received[0].id).toBe("42");
    unsubscribe();
  });
});

describe("Soroban RPC transient-failure injection", () => {
  it("retries a Horizon 503 then succeeds", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error("Horizon responded with 503 Service Unavailable");
        return "ok";
      },
      { baseDelayMs: 0, maxDelayMs: 0, jitter: 0 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("retries dropped connections (ECONNRESET)", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 2) throw new Error("read ECONNRESET");
        return calls;
      },
      { baseDelayMs: 0, maxDelayMs: 0, jitter: 0 },
    );
    expect(result).toBe(2);
  });

  it("gives up after maxAttempts during a total outage", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error("network timeout");
        },
        { maxAttempts: 4, baseDelayMs: 0, maxDelayMs: 0, jitter: 0 },
      ),
    ).rejects.toThrow("network timeout");
    expect(calls).toBe(4);
  });

  it("does not retry a non-transient upstream error", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new Error("400 Bad Request: malformed cursor");
      }),
    ).rejects.toThrow("400 Bad Request");
    expect(calls).toBe(1);
  });
});
