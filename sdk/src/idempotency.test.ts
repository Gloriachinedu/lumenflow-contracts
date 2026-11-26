import { getCached, setCached, evictCached, withIdempotency, CacheEntry } from "./idempotency";

// ---------------------------------------------------------------------------
// Helper: directly poke the in-memory Map that backs the module when
// sessionStorage is absent (Node test environment).  We access it through the
// public API rather than internal state so tests stay black-box.
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Clear every key the tests may have written by evicting known keys.
  // Because we run in Node (no sessionStorage) the in-memory Map is used.
  [
    "key-first",
    "key-second",
    "key-expired",
    "key-no-key",
    "key-evict",
    "key-a",
    "key-b",
  ].forEach((k) => evictCached(k));
});

// ---------------------------------------------------------------------------
// getCached / setCached
// ---------------------------------------------------------------------------

describe("getCached / setCached", () => {
  it("returns undefined for a key that was never set", () => {
    expect(getCached("key-first")).toBeUndefined();
  });

  it("returns the stored value immediately after setCached", () => {
    setCached("key-first", 42);
    expect(getCached("key-first")).toBe(42);
  });

  it("stores and retrieves complex objects", () => {
    const obj = { status: "ok", orderId: "ORDER-1" };
    setCached("key-second", obj);
    expect(getCached("key-second")).toEqual(obj);
  });

  it("returns undefined and evicts an expired entry", () => {
    // Manually write an already-expired entry by manipulating via JSON
    // We use a known storage key so we can bypass setCached's TTL.
    // Since we are in Node the backing store is the module-level Map.
    // We call setCached then fast-forward by reading and re-writing the raw
    // JSON with a past timestamp.  Because we can't reach the Map directly we
    // use evictCached + re-insert via a thin trick:
    //
    // Strategy: call withIdempotency with a mocked Date so the entry is
    // immediately expired when we read it back.
    const originalNow = Date.now;
    try {
      // Write with "current" time set to 10 minutes ago
      const past = Date.now() - 10 * 60 * 1_000;
      Date.now = () => past;
      setCached("key-expired", "stale-value");

      // Restore real time — entry is now in the past
      Date.now = originalNow;

      expect(getCached("key-expired")).toBeUndefined();
    } finally {
      Date.now = originalNow;
    }
  });
});

// ---------------------------------------------------------------------------
// evictCached
// ---------------------------------------------------------------------------

describe("evictCached", () => {
  it("removes an existing entry so subsequent getCached returns undefined", () => {
    setCached("key-evict", "value");
    evictCached("key-evict");
    expect(getCached("key-evict")).toBeUndefined();
  });

  it("is a no-op for keys that do not exist", () => {
    expect(() => evictCached("key-nonexistent")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// withIdempotency
// ---------------------------------------------------------------------------

describe("withIdempotency", () => {
  it("calls fn on the first invocation and returns its result", async () => {
    const fn = jest.fn().mockResolvedValue(undefined);
    await withIdempotency("key-a", fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("returns cached result on second call without invoking fn again", async () => {
    const fn = jest.fn().mockResolvedValue(undefined);

    await withIdempotency("key-a", fn);
    await withIdempotency("key-a", fn);

    // fn must have been called exactly once
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("calls fn again after the cache entry has expired", async () => {
    const fn = jest.fn().mockResolvedValue(undefined);
    const originalNow = Date.now;

    try {
      // First call — set entry 10 minutes in the past
      const past = Date.now() - 10 * 60 * 1_000;
      Date.now = () => past;
      await withIdempotency("key-b", fn);

      // Restore real time so the stored entry is now expired
      Date.now = originalNow;

      // Second call — entry is expired, fn should be called again
      await withIdempotency("key-b", fn);

      expect(fn).toHaveBeenCalledTimes(2);
    } finally {
      Date.now = originalNow;
    }
  });

  it("does not cache when idempotencyKey is undefined — always calls fn", async () => {
    const fn = jest.fn().mockResolvedValue(undefined);

    await withIdempotency(undefined, fn);
    await withIdempotency(undefined, fn);

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("propagates errors thrown by fn without caching them", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("RPC failure"));

    await expect(withIdempotency("key-a", fn)).rejects.toThrow("RPC failure");

    // Entry must NOT be cached — second call must invoke fn again
    await expect(withIdempotency("key-a", fn)).rejects.toThrow("RPC failure");

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("caches non-undefined return values (e.g. objects)", async () => {
    const result = { orderId: "ORDER-1", status: "ok" };
    const fn = jest.fn().mockResolvedValue(result);

    const first = await withIdempotency("key-a", fn);
    const second = await withIdempotency("key-a", fn);

    expect(first).toEqual(result);
    expect(second).toEqual(result);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("treats distinct keys independently", async () => {
    const fn1 = jest.fn().mockResolvedValue(undefined);
    const fn2 = jest.fn().mockResolvedValue(undefined);

    await withIdempotency("key-a", fn1);
    await withIdempotency("key-b", fn2);

    // Each key's fn is called exactly once; they do not share cache
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);

    // Repeating with key-a hits cache, key-b still hits cache too
    await withIdempotency("key-a", fn1);
    await withIdempotency("key-b", fn2);
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Concurrent duplicate submissions (chaos: duplicate payment races)
// ---------------------------------------------------------------------------

describe("withIdempotency — concurrent duplicate submissions", () => {
  it("returns the same result to all concurrent callers for one key", async () => {
    const result = { orderId: "ORDER-RACE-1", status: "ok" };
    const fn = jest.fn().mockResolvedValue(result);

    const results = await Promise.all([
      withIdempotency("key-a", fn),
      withIdempotency("key-a", fn),
      withIdempotency("key-a", fn),
      withIdempotency("key-a", fn),
      withIdempotency("key-a", fn),
    ]);

    for (const r of results) {
      expect(r).toEqual(result);
    }
  });

  it("invokes fn at most once when submissions race for the same key", async () => {
    let resolveFn: (value: unknown) => void = () => {};
    const fn = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
    );

    const pending = [
      withIdempotency("key-a", fn),
      withIdempotency("key-a", fn),
      withIdempotency("key-a", fn),
    ];

    // Let the microtask queue drain so the first call registers.
    await Promise.resolve();

    resolveFn({ orderId: "ORDER-RACE-2" });

    const results = await Promise.all(pending);
    expect(fn).toHaveBeenCalledTimes(1);
    for (const r of results) {
      expect(r).toEqual({ orderId: "ORDER-RACE-2" });
    }
  });

  it("does not cache a failed submission so a retry can succeed", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("RPC timeout"))
      .mockResolvedValueOnce({ orderId: "ORDER-RACE-3", status: "ok" });

    await expect(withIdempotency("key-a", fn)).rejects.toThrow("RPC timeout");

    const retried = await withIdempotency("key-a", fn);
    expect(retried).toEqual({ orderId: "ORDER-RACE-3", status: "ok" });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("keeps concurrent submissions for distinct keys isolated", async () => {
    const fnA = jest.fn().mockResolvedValue({ orderId: "ORDER-A" });
    const fnB = jest.fn().mockResolvedValue({ orderId: "ORDER-B" });

    const [a1, b1, a2, b2] = await Promise.all([
      withIdempotency("key-a", fnA),
      withIdempotency("key-b", fnB),
      withIdempotency("key-a", fnA),
      withIdempotency("key-b", fnB),
    ]);

    expect(a1).toEqual({ orderId: "ORDER-A" });
    expect(a2).toEqual({ orderId: "ORDER-A" });
    expect(b1).toEqual({ orderId: "ORDER-B" });
    expect(b2).toEqual({ orderId: "ORDER-B" });
    expect(fnA).toHaveBeenCalledTimes(1);
    expect(fnB).toHaveBeenCalledTimes(1);
  });
});
