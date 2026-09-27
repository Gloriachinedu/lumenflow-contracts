/**
 * E2E: Full Refund Lifecycle
 *
 * Tests the complete on-chain refund flow driven through the browser UI:
 *   1. Payer initiates a refund on the receipt page
 *   2. Merchant approves the refund
 *   3. Merchant executes the refund (token transfer)
 *
 * Environment:
 *   - Frontend served via playwright.config.ts webServer
 *   - Contract interactions routed through a local mock API
 *     (docker-compose.test.yml spins up the mock before CI runs this suite)
 *   - MOCK_WALLET=1  →  wallet-signing dialogs are bypassed in CI
 *
 * Related issue: #618
 */

import { test, expect } from "@playwright/test";
import {
  seedPayment,
  seedMerchant,
  resetMockState,
  getRefund,
  type MockPayment,
} from "./helpers/contract-mock";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MERCHANT_ADDRESS =
  "GBUYUAI75XXWDZEKLY66CFYKQPET5JR4EAPL7STQKQCRLKJ74SC65VU";
const PAYER_ADDRESS =
  "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
const TOKEN_ADDRESS =
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYF";

const BASE_PAYMENT: MockPayment = {
  order_id: "ORDER_E2E_001",
  merchant_address: MERCHANT_ADDRESS,
  payer_address: PAYER_ADDRESS,
  amount: 10_000_000, // 1.000_0000 XLM in stroops
  token_address: TOKEN_ADDRESS,
  memo: "E2E test payment",
  paid_at: Math.floor(Date.now() / 1000) - 60, // 1 minute ago, within refund window
  status: "Completed",
  refunds: [],
};

const REFUND_ID = "REFUND_E2E_001";
const REFUND_AMOUNT = 5_000_000; // partial refund: 0.5 XLM

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Navigate to the receipt page for a given order. */
async function goToReceipt(page: import("@playwright/test").Page, orderId: string) {
  await page.goto(`/receipt.html?orderId=${orderId}&mockWallet=1`);
  // Wait for the receipt content panel to be visible
  await expect(page.locator("#receipt-content")).toBeVisible({ timeout: 15_000 });
}

// ── Test suite ────────────────────────────────────────────────────────────────

test.describe("Full Refund Lifecycle", () => {
  test.beforeEach(async ({ request }) => {
    // Reset mock state and seed fresh payment + merchant for each test
    await resetMockState(request);
    await seedMerchant(request, {
      address: MERCHANT_ADDRESS,
      name: "E2E Test Merchant",
      verified: true,
    });
    await seedPayment(request, BASE_PAYMENT);
  });

  // ── Step 1: Initiate ────────────────────────────────────────────────────────

  test("1 – payer can initiate a refund from the receipt page", async ({
    page,
    request,
  }) => {
    await goToReceipt(page, BASE_PAYMENT.order_id);

    // Receipt must show status "Completed" before refund
    const badge = page.locator("#status-badge");
    await expect(badge).toContainText("Completed");

    // Click the "Request Refund" button (rendered by mock-wallet shim)
    const refundBtn = page.locator('[data-testid="btn-initiate-refund"]');
    await expect(refundBtn).toBeVisible();
    await refundBtn.click();

    // Fill in the refund form
    await page.locator('[data-testid="input-refund-id"]').fill(REFUND_ID);
    await page
      .locator('[data-testid="input-refund-amount"]')
      .fill(String(REFUND_AMOUNT));
    await page
      .locator('[data-testid="input-refund-reason"]')
      .fill("E2E test – partial refund");

    // Submit
    await page.locator('[data-testid="btn-submit-refund"]').click();

    // Expect a success notification
    const successMsg = page.locator('[data-testid="refund-success-msg"]');
    await expect(successMsg).toBeVisible({ timeout: 15_000 });
    await expect(successMsg).toContainText(REFUND_ID);

    // Verify mock state: refund must now be "Pending"
    const refund = await getRefund(request, REFUND_ID);
    expect(refund.status).toBe("Pending");
    expect(refund.amount).toBe(REFUND_AMOUNT);
    expect(refund.order_id).toBe(BASE_PAYMENT.order_id);
  });

  // ── Step 2: Approve ─────────────────────────────────────────────────────────

  test("2 – merchant can approve a pending refund", async ({
    page,
    request,
  }) => {
    // Pre-seed the refund in Pending state via the API so we can test
    // the approval step in isolation
    await request.post(
      `${process.env.API_URL || "http://localhost:8080"}/mock/seed/refund`,
      {
        data: {
          refund_id: REFUND_ID,
          order_id: BASE_PAYMENT.order_id,
          amount: REFUND_AMOUNT,
          reason: "E2E test – partial refund",
          status: "Pending",
          initiator: PAYER_ADDRESS,
        },
      }
    );

    await goToReceipt(page, BASE_PAYMENT.order_id);

    // Merchant view: refund history section must show the pending refund
    const refundsSection = page.locator("#refunds-section");
    await expect(refundsSection).toBeVisible();
    await expect(refundsSection).toContainText(REFUND_ID);
    await expect(refundsSection).toContainText("Pending");

    // Click the approve button rendered for the merchant role
    const approveBtn = page.locator(
      `[data-testid="btn-approve-refund-${REFUND_ID}"]`
    );
    await expect(approveBtn).toBeVisible();
    await approveBtn.click();

    // Confirmation dialog
    const confirmBtn = page.locator('[data-testid="btn-confirm-approve"]');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // Expect status badge on the refund item to update
    const refundStatus = page.locator(
      `[data-testid="refund-status-${REFUND_ID}"]`
    );
    await expect(refundStatus).toContainText("Approved", { timeout: 15_000 });

    // Verify mock state
    const refund = await getRefund(request, REFUND_ID);
    expect(refund.status).toBe("Approved");
  });

  // ── Step 3: Execute ─────────────────────────────────────────────────────────

  test("3 – merchant can execute an approved refund", async ({
    page,
    request,
  }) => {
    // Pre-seed the refund in Approved state
    await request.post(
      `${process.env.API_URL || "http://localhost:8080"}/mock/seed/refund`,
      {
        data: {
          refund_id: REFUND_ID,
          order_id: BASE_PAYMENT.order_id,
          amount: REFUND_AMOUNT,
          reason: "E2E test – partial refund",
          status: "Approved",
          initiator: PAYER_ADDRESS,
        },
      }
    );

    await goToReceipt(page, BASE_PAYMENT.order_id);

    // Execute button must be visible for Approved refunds
    const executeBtn = page.locator(
      `[data-testid="btn-execute-refund-${REFUND_ID}"]`
    );
    await expect(executeBtn).toBeVisible();
    await executeBtn.click();

    // Confirmation dialog
    const confirmBtn = page.locator('[data-testid="btn-confirm-execute"]');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // Status must update to Executed
    const refundStatus = page.locator(
      `[data-testid="refund-status-${REFUND_ID}"]`
    );
    await expect(refundStatus).toContainText("Executed", { timeout: 15_000 });

    // Payment badge must now show PartiallyRefunded (partial amount)
    const paymentBadge = page.locator("#status-badge");
    await expect(paymentBadge).toContainText(/Partially Refunded|PartiallyRefunded/, {
      timeout: 15_000,
    });

    // Verify mock state
    const refund = await getRefund(request, REFUND_ID);
    expect(refund.status).toBe("Executed");
  });

  // ── Full happy-path flow ─────────────────────────────────────────────────────

  test("full flow – initiate → approve → execute updates payment status to PartiallyRefunded", async ({
    page,
    request,
  }) => {
    await goToReceipt(page, BASE_PAYMENT.order_id);

    // ─ Initiate ─
    const refundBtn = page.locator('[data-testid="btn-initiate-refund"]');
    await expect(refundBtn).toBeVisible();
    await refundBtn.click();

    await page.locator('[data-testid="input-refund-id"]').fill(REFUND_ID);
    await page
      .locator('[data-testid="input-refund-amount"]')
      .fill(String(REFUND_AMOUNT));
    await page
      .locator('[data-testid="input-refund-reason"]')
      .fill("Full-flow E2E test");
    await page.locator('[data-testid="btn-submit-refund"]').click();

    await expect(
      page.locator('[data-testid="refund-success-msg"]')
    ).toBeVisible({ timeout: 15_000 });

    let refund = await getRefund(request, REFUND_ID);
    expect(refund.status).toBe("Pending");

    // ─ Approve ─
    const approveBtn = page.locator(
      `[data-testid="btn-approve-refund-${REFUND_ID}"]`
    );
    await expect(approveBtn).toBeVisible();
    await approveBtn.click();
    await page.locator('[data-testid="btn-confirm-approve"]').click();

    await expect(
      page.locator(`[data-testid="refund-status-${REFUND_ID}"]`)
    ).toContainText("Approved", { timeout: 15_000 });

    refund = await getRefund(request, REFUND_ID);
    expect(refund.status).toBe("Approved");

    // ─ Execute ─
    const executeBtn = page.locator(
      `[data-testid="btn-execute-refund-${REFUND_ID}"]`
    );
    await expect(executeBtn).toBeVisible();
    await executeBtn.click();
    await page.locator('[data-testid="btn-confirm-execute"]').click();

    await expect(
      page.locator(`[data-testid="refund-status-${REFUND_ID}"]`)
    ).toContainText("Executed", { timeout: 15_000 });

    // Payment badge reflects partial refund
    await expect(page.locator("#status-badge")).toContainText(
      /Partially Refunded|PartiallyRefunded/,
      { timeout: 15_000 }
    );

    refund = await getRefund(request, REFUND_ID);
    expect(refund.status).toBe("Executed");
  });

  // ── Error handling ───────────────────────────────────────────────────────────

  test("fails meaningfully when contract returns an error", async ({
    page,
  }) => {
    // Instruct mock to return a contract error on the next initiate_refund call
    await page.route("**/mock/contract/initiate_refund", (route) => {
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: "ContractError",
          code: "RefundWindowExpired",
          message: "Refund window has expired for this order.",
        }),
      });
    });

    await goToReceipt(page, BASE_PAYMENT.order_id);

    const refundBtn = page.locator('[data-testid="btn-initiate-refund"]');
    await expect(refundBtn).toBeVisible();
    await refundBtn.click();

    await page.locator('[data-testid="input-refund-id"]').fill("REFUND_ERR");
    await page.locator('[data-testid="input-refund-amount"]').fill("1000");
    await page
      .locator('[data-testid="input-refund-reason"]')
      .fill("Should fail");
    await page.locator('[data-testid="btn-submit-refund"]').click();

    // A meaningful error message must be shown — not a blank/silent failure
    const errorMsg = page.locator('[data-testid="refund-error-msg"]');
    await expect(errorMsg).toBeVisible({ timeout: 15_000 });
    await expect(errorMsg).toContainText(/RefundWindowExpired|Refund window/i);
  });
});
