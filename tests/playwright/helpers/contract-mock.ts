/**
 * Mock contract API helpers for Playwright E2E tests.
 *
 * In CI, these helpers drive a lightweight HTTP mock that mimics the
 * LumenFlow contract RPC responses, allowing tests to run without a
 * live Soroban node.  The mock is started via Docker Compose and
 * configured through the API_URL environment variable.
 *
 * In local development with a real local network, set:
 *   MOCK_WALLET=0 API_URL=http://localhost:8080
 */

import { APIRequestContext } from "@playwright/test";

const API_URL = process.env.API_URL || "http://localhost:8080";

// ── Types mirroring contract structures ──────────────────────────────────────

export interface MockPayment {
  order_id: string;
  merchant_address: string;
  payer_address: string;
  amount: number;
  token_address: string;
  memo: string;
  paid_at: number; // Unix timestamp
  status: "Completed" | "PartiallyRefunded" | "FullyRefunded";
  refunds: MockRefund[];
}

export interface MockRefund {
  refund_id: string;
  order_id: string;
  amount: number;
  reason: string;
  status: "Pending" | "Approved" | "Rejected" | "Executed";
  initiator: string;
}

// ── API helpers ───────────────────────────────────────────────────────────────

/** Seed the mock contract state with a completed payment. */
export async function seedPayment(
  request: APIRequestContext,
  payment: MockPayment
): Promise<void> {
  const res = await request.post(`${API_URL}/mock/seed/payment`, {
    data: payment,
  });
  if (!res.ok()) {
    throw new Error(
      `Failed to seed payment: ${res.status()} ${await res.text()}`
    );
  }
}

/** Seed a merchant record in the mock state. */
export async function seedMerchant(
  request: APIRequestContext,
  opts: {
    address: string;
    name: string;
    verified?: boolean;
  }
): Promise<void> {
  const res = await request.post(`${API_URL}/mock/seed/merchant`, {
    data: { verified: false, ...opts },
  });
  if (!res.ok()) {
    throw new Error(
      `Failed to seed merchant: ${res.status()} ${await res.text()}`
    );
  }
}

/** Initiate a refund via the mock API (simulates payer action). */
export async function initiateRefund(
  request: APIRequestContext,
  opts: {
    refund_id: string;
    order_id: string;
    amount: number;
    reason: string;
    caller: string;
  }
): Promise<void> {
  const res = await request.post(`${API_URL}/mock/contract/initiate_refund`, {
    data: opts,
  });
  if (!res.ok()) {
    throw new Error(
      `initiate_refund failed: ${res.status()} ${await res.text()}`
    );
  }
}

/** Approve a refund via the mock API (simulates merchant action). */
export async function approveRefund(
  request: APIRequestContext,
  opts: { refund_id: string; caller: string }
): Promise<void> {
  const res = await request.post(`${API_URL}/mock/contract/approve_refund`, {
    data: opts,
  });
  if (!res.ok()) {
    throw new Error(
      `approve_refund failed: ${res.status()} ${await res.text()}`
    );
  }
}

/** Execute a refund via the mock API (simulates merchant token transfer). */
export async function executeRefund(
  request: APIRequestContext,
  opts: { refund_id: string }
): Promise<void> {
  const res = await request.post(`${API_URL}/mock/contract/execute_refund`, {
    data: opts,
  });
  if (!res.ok()) {
    throw new Error(
      `execute_refund failed: ${res.status()} ${await res.text()}`
    );
  }
}

/** Fetch the current refund state from the mock. */
export async function getRefund(
  request: APIRequestContext,
  refund_id: string
): Promise<MockRefund> {
  const res = await request.get(
    `${API_URL}/mock/contract/get_refund?refund_id=${refund_id}`
  );
  if (!res.ok()) {
    throw new Error(`get_refund failed: ${res.status()} ${await res.text()}`);
  }
  return res.json() as Promise<MockRefund>;
}

/** Reset all mock state between tests. */
export async function resetMockState(
  request: APIRequestContext
): Promise<void> {
  const res = await request.post(`${API_URL}/mock/reset`);
  if (!res.ok()) {
    throw new Error(
      `Failed to reset mock state: ${res.status()} ${await res.text()}`
    );
  }
}
