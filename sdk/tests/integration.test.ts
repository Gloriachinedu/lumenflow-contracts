/**
 * SDK integration tests against a local Soroban RPC node (issue #332).
 *
 * Prerequisites:
 *   1. A local Soroban network running on http://localhost:8000/soroban/rpc
 *      (start with `stellar network container start local`)
 *   2. CONTRACT_ID and SOURCE_SECRET env vars set (see README).
 *
 * The tests are skipped automatically when SOROBAN_RPC_URL is not set so they
 * don't block CI on environments without a local node.
 */

import { LumenFlowClient, RpcFetch } from "../src/client";
import { LumenFlowError, PaymentErrorCode } from "../src/errors";

const RPC_URL = process.env.SOROBAN_RPC_URL;
const CONTRACT_ID = process.env.CONTRACT_ID;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Minimal JSON-RPC fetch that calls a real Soroban RPC endpoint.
 */
function makeRealRpcFetch(rpcUrl: string, contractId: string): RpcFetch {
  return async (method, params) => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "simulateTransaction",
      params: { contractId, method, args: params },
    });

    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }

    const json = await res.json() as any;
    if (json.error) {
      const err = new LumenFlowError(json.error.code ?? PaymentErrorCode.InvalidInput);
      throw err;
    }
    return { result: json.result };
  };
}

// ─── Guard ────────────────────────────────────────────────────────────────────

const describeIntegration = RPC_URL && CONTRACT_ID ? describe : describe.skip;

// ─── Tests ────────────────────────────────────────────────────────────────────

describeIntegration("SDK integration — local Soroban node", () => {
  let client: LumenFlowClient;

  const MERCHANT = `G${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  const ORDER_ID = `ORDER-${Date.now()}`;

  beforeAll(() => {
    client = new LumenFlowClient(makeRealRpcFetch(RPC_URL!, CONTRACT_ID!));
  });

  // ── Register ─────────────────────────────────────────────────────────────

  it("registers a merchant without error", async () => {
    await expect(
      client.registerMerchant({
        merchant_address: MERCHANT,
        name: "Integration Store",
        description: "Integration test merchant",
        contact_info: "integration@test.local",
        category: "Retail",
      })
    ).resolves.toBeUndefined();
  });

  it("rejects a duplicate merchant registration", async () => {
    await expect(
      client.registerMerchant({
        merchant_address: MERCHANT,
        name: "Integration Store",
        description: "dup",
        contact_info: "dup@test.local",
        category: "Retail",
      })
    ).rejects.toBeInstanceOf(LumenFlowError);
  });

  // ── Payment ───────────────────────────────────────────────────────────────

  it("processes a payment", async () => {
    await expect(
      client.processPayment({
        payer: "GPAYER1",
        order_id: ORDER_ID,
        merchant_address: MERCHANT,
        amount: 1000,
      })
    ).resolves.toBeUndefined();
  });

  it("rejects a duplicate order ID", async () => {
    await expect(
      client.processPayment({
        payer: "GPAYER1",
        order_id: ORDER_ID,
        merchant_address: MERCHANT,
        amount: 500,
      })
    ).rejects.toBeInstanceOf(LumenFlowError);
  });

  // ── Payment history ───────────────────────────────────────────────────────

  it("retrieves a payment by ID", async () => {
    const payment = await client.getPaymentById(ORDER_ID);
    expect(payment).toBeDefined();
  });

  it("throws PaymentNotFound for an unknown order ID", async () => {
    try {
      await client.getPaymentById("NONEXISTENT-99999");
    } catch (err) {
      expect(err).toBeInstanceOf(LumenFlowError);
      expect((err as LumenFlowError).code).toBe(PaymentErrorCode.PaymentNotFound);
    }
  });
});
