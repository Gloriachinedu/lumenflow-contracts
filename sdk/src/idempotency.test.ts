/**
 * idempotency.test.ts
 *
 * Unit tests for automatic idempotency key generation and deduplication.
 */

import {
  generateIdempotencyKey,
  submitPayment,
  IdempotencyStore,
  PaymentRequest,
  PaymentResult,
  PaymentExecutor,
} from "./idempotency";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseRequest: PaymentRequest = {
  merchantAddress: "GMERCHANT123",
  tokenAddress: "GTOKEN456",
  amount: 1000,
  memo: "Test payment",
};

function makeExecutor(override?: Partial<Omit<PaymentResult, "idempotencyKey">>): PaymentExecutor {
  return jest.fn().mockResolvedValue({ success: true, ledger: 100, orderId: "ORD_001", ...override });
}

// ---------------------------------------------------------------------------
// generateIdempotencyKey()
// ---------------------------------------------------------------------------

describe("generateIdempotencyKey()", () => {
  it("returns a non-empty string", () => {
    const key = generateIdempotencyKey();
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);
  });

  it("returns a valid UUID v4 format", () => {
    const key = generateIdempotencyKey();
    // UUID v4: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("returns a different key on each call", () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateIdempotencyKey()));
    expect(keys.size).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// submitPayment() — key resolution
// ---------------------------------------------------------------------------

describe("submitPayment() — idempotency key resolution", () => {
  let store: IdempotencyStore;

  beforeEach(() => {
    store = new IdempotencyStore();
  });

  it("auto-generates a key when none is provided", async () => {
    const executor = makeExecutor();
    const result = await submitPayment(baseRequest, {}, executor, store);
    expect(typeof result.idempotencyKey).toBe("string");
    expect(result.idempotencyKey.length).toBeGreaterThan(0);
  });

  it("exposes the auto-generated key in the returned PaymentResult", async () => {
    const executor = makeExecutor();
    const result = await submitPayment(baseRequest, {}, executor, store);
    expect(result.idempotencyKey).toBeTruthy();
  });

  it("uses a caller-supplied idempotency key when provided", async () => {
    const executor = makeExecutor();
    const customKey = "my-custom-order-uuid";
    const result = await submitPayment(baseRequest, { idempotencyKey: customKey }, executor, store);
    expect(result.idempotencyKey).toBe(customKey);
  });

  it("passes the idempotency key to the executor", async () => {
    const executor = makeExecutor();
    const customKey = "deterministic-key";
    await submitPayment(baseRequest, { idempotencyKey: customKey }, executor, store);
    expect(executor).toHaveBeenCalledWith(baseRequest, customKey);
  });

  it("auto-generated keys are unique across multiple calls", async () => {
    const keys: string[] = [];
    for (let i = 0; i < 20; i++) {
      const s = new IdempotencyStore();
      const result = await submitPayment(baseRequest, {}, makeExecutor(), s);
      keys.push(result.idempotencyKey);
    }
    const unique = new Set(keys);
    expect(unique.size).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// submitPayment() — deduplication
// ---------------------------------------------------------------------------

describe("submitPayment() — deduplication", () => {
  let store: IdempotencyStore;

  beforeEach(() => {
    store = new IdempotencyStore();
  });

  it("returns the cached result for a duplicate key without re-executing", async () => {
    const executor = makeExecutor({ orderId: "ORD_ORIGINAL" });
    const key = "dup-key";

    const first = await submitPayment(baseRequest, { idempotencyKey: key }, executor, store);
    const second = await submitPayment(baseRequest, { idempotencyKey: key }, executor, store);

    expect(second).toEqual(first);
    // Executor should only have been called once.
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it("stores the result in the idempotency store after a successful submission", async () => {
    const key = "store-key";
    await submitPayment(baseRequest, { idempotencyKey: key }, makeExecutor(), store);
    expect(store.has(key)).toBe(true);
  });

  it("different keys result in independent executions", async () => {
    const executor = makeExecutor();
    await submitPayment(baseRequest, { idempotencyKey: "key-a" }, executor, store);
    await submitPayment(baseRequest, { idempotencyKey: "key-b" }, executor, store);
    expect(executor).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// submitPayment() — result shape
// ---------------------------------------------------------------------------

describe("submitPayment() — result shape", () => {
  it("result includes success, idempotencyKey, and executor-provided fields", async () => {
    const store = new IdempotencyStore();
    const executor = makeExecutor({ ledger: 42, orderId: "ORD_42" });
    const result = await submitPayment(
      baseRequest,
      { idempotencyKey: "shape-key" },
      executor,
      store
    );

    expect(result.success).toBe(true);
    expect(result.idempotencyKey).toBe("shape-key");
    expect(result.ledger).toBe(42);
    expect(result.orderId).toBe("ORD_42");
  });
});

// ---------------------------------------------------------------------------
// IdempotencyStore
// ---------------------------------------------------------------------------

describe("IdempotencyStore", () => {
  it("has() returns false for unknown keys", () => {
    const store = new IdempotencyStore();
    expect(store.has("unknown")).toBe(false);
  });

  it("get() returns undefined for unknown keys", () => {
    const store = new IdempotencyStore();
    expect(store.get("unknown")).toBeUndefined();
  });

  it("set() and get() round-trip a result", () => {
    const store = new IdempotencyStore();
    const result: PaymentResult = { success: true, idempotencyKey: "k1" };
    store.set("k1", result);
    expect(store.get("k1")).toEqual(result);
  });

  it("size reflects the number of stored entries", () => {
    const store = new IdempotencyStore();
    store.set("a", { success: true, idempotencyKey: "a" });
    store.set("b", { success: true, idempotencyKey: "b" });
    expect(store.size).toBe(2);
  });

  it("clear() removes all entries", () => {
    const store = new IdempotencyStore();
    store.set("x", { success: true, idempotencyKey: "x" });
    store.clear();
    expect(store.size).toBe(0);
    expect(store.has("x")).toBe(false);
  });
});
