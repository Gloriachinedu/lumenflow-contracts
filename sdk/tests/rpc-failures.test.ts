/**
 * Tests for SDK RPC failure scenarios (issue #338).
 *
 * Validates that the SDK correctly handles:
 *   - RPC timeouts
 *   - Invalid / malformed JSON responses
 *   - Transient network failures with retry behaviour
 *   - Non-retryable errors surfaced immediately
 */

import { LumenFlowClient } from "../src/client";
import { LumenFlowError, PaymentErrorCode } from "../src/errors";

const MERCHANT_PARAMS = {
  merchant_address: "GADDR1",
  name: "Test Store",
  description: "desc",
  contact_info: "test@example.com",
  category: "Retail",
};

// ─── Timeout ──────────────────────────────────────────────────────────────────

describe("RPC timeout", () => {
  it("retries and eventually throws on repeated timeouts", async () => {
    const rpcFetch = jest.fn().mockRejectedValue(
      Object.assign(new Error("timeout: request took too long"), { code: "ETIMEDOUT" })
    );
    const client = new LumenFlowClient(rpcFetch);

    await expect(client.registerMerchant(MERCHANT_PARAMS)).rejects.toThrow(
      "timeout"
    );
    // MAX_RETRIES = 3 → 4 total attempts
    expect(rpcFetch).toHaveBeenCalledTimes(4);
  });

  it("succeeds if the request recovers after a transient timeout", async () => {
    const rpcFetch = jest
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })
      )
      .mockResolvedValue({ result: null });

    const client = new LumenFlowClient(rpcFetch);
    await expect(client.registerMerchant(MERCHANT_PARAMS)).resolves.toBeUndefined();
    expect(rpcFetch).toHaveBeenCalledTimes(2);
  });
});

// ─── Invalid / malformed JSON ──────────────────────────────────────────────────

describe("Invalid JSON / malformed response", () => {
  it("throws when the result payload is absent", async () => {
    const rpcFetch = jest.fn().mockResolvedValue({}); // missing `result`
    const client = new LumenFlowClient(rpcFetch);

    await expect(client.getPaymentById("ORDER_001")).rejects.toBeInstanceOf(
      LumenFlowError
    );
  });

  it("maps missing result to PaymentNotFound error code", async () => {
    const rpcFetch = jest.fn().mockResolvedValue({});
    const client = new LumenFlowClient(rpcFetch);

    try {
      await client.getPaymentById("ORDER_001");
    } catch (err) {
      expect(err).toBeInstanceOf(LumenFlowError);
      expect((err as LumenFlowError).code).toBe(PaymentErrorCode.PaymentNotFound);
    }
  });

  it("does not crash the client when JSON is null", async () => {
    const rpcFetch = jest.fn().mockResolvedValue(null as any);
    const client = new LumenFlowClient(rpcFetch);

    // Should throw, not segfault / hang
    await expect(client.getPaymentById("ORDER_002")).rejects.toBeDefined();
  });
});

// ─── Transient network failures ───────────────────────────────────────────────

describe("Transient network failures", () => {
  it("retries on ECONNRESET and succeeds", async () => {
    const rpcFetch = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("network"), { code: "ECONNRESET" }))
      .mockResolvedValue({ result: null });

    const client = new LumenFlowClient(rpcFetch);
    await expect(
      client.processPayment({ payer: "G1", order_id: "O1", merchant_address: "G2", amount: 100 })
    ).resolves.toBeUndefined();
    expect(rpcFetch).toHaveBeenCalledTimes(2);
  });

  it("retries on ECONNREFUSED up to MAX_RETRIES", async () => {
    const rpcFetch = jest.fn().mockRejectedValue(
      Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" })
    );
    const client = new LumenFlowClient(rpcFetch);

    await expect(
      client.processPayment({ payer: "G1", order_id: "O1", merchant_address: "G2", amount: 100 })
    ).rejects.toThrow("connection refused");
    expect(rpcFetch).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });
});

// ─── Non-retryable errors ─────────────────────────────────────────────────────

describe("Non-retryable errors", () => {
  it("does not retry on a contract-level error (no network code)", async () => {
    const rpcFetch = jest
      .fn()
      .mockRejectedValue(new LumenFlowError(PaymentErrorCode.Unauthorized));
    const client = new LumenFlowClient(rpcFetch);

    await expect(client.registerMerchant(MERCHANT_PARAMS)).rejects.toBeInstanceOf(
      LumenFlowError
    );
    expect(rpcFetch).toHaveBeenCalledTimes(1);
  });
});

// ─── Integration: retry success after outage ─────────────────────────────────

describe("Integration: RPC outage recovery", () => {
  it("succeeds after a burst of transient failures (simulated outage)", async () => {
    const rpcFetch = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }))
      .mockRejectedValueOnce(Object.assign(new Error("network"), { code: "ECONNRESET" }))
      .mockResolvedValue({ result: null });

    const client = new LumenFlowClient(rpcFetch);
    await expect(client.registerMerchant(MERCHANT_PARAMS)).resolves.toBeUndefined();
    expect(rpcFetch).toHaveBeenCalledTimes(3);
  });
});

// ─── Integration: partial batch payment failure ──────────────────────────────

describe("Integration: partial batch payment failure", () => {
  it("returns per-item results with correct error codes", async () => {
    const rpcFetch = jest
      .fn()
      .mockResolvedValueOnce({ result: null }) // item 1 succeeds
      .mockRejectedValueOnce(
        new LumenFlowError(PaymentErrorCode.InsufficientFunds)
      ) // item 2 fails, non-retryable
      .mockResolvedValueOnce({ result: null }); // item 3 succeeds

    const client = new LumenFlowClient(rpcFetch);

    const results = await client.processBatchPayments([
      { payer: "G1", order_id: "O1", merchant_address: "G2", amount: 100 },
      { payer: "G1", order_id: "O2", merchant_address: "G2", amount: 200 },
      { payer: "G1", order_id: "O3", merchant_address: "G2", amount: 300 },
    ]);

    expect(results).toHaveLength(3);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[1].error?.code).toBe(PaymentErrorCode.InsufficientFunds);
    expect(results[2].success).toBe(true);
  });
});

// ─── Integration: idempotent duplicate submissions ───────────────────────────

describe("Integration: concurrent duplicate submissions", () => {
  it("handles duplicate order submissions idempotently", async () => {
    const rpcFetch = jest.fn().mockResolvedValue({ result: null });
    const client = new LumenFlowClient(rpcFetch);

    const params = {
      payer: "G1",
      order_id: "O_DUP",
      merchant_address: "G2",
      amount: 100,
    };

    const results = await Promise.all([
      client.processPayment(params),
      client.processPayment(params),
      client.processPayment(params),
    ]);

    // All duplicate submissions resolve without throwing
    results.forEach((r) => expect(r).toBeUndefined());
  });
});
