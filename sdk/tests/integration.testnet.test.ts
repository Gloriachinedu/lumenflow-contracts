/**
 * SDK integration tests against the Stellar testnet (issue #624).
 *
 * @integration
 *
 * Prerequisites:
 *   - TESTNET_RPC_URL   — Soroban RPC endpoint (default: https://soroban-testnet.stellar.org)
 *   - TESTNET_CONTRACT_ID — deployed LumenFlow contract address on testnet
 *   - STELLAR_TESTNET_KEY — funded account secret key (funded via Friendbot).
 *                           Falls back to TESTNET_SOURCE_SECRET for backwards
 *                           compatibility.
 *
 * These tests are tagged @integration and are NOT run by the standard
 * `npm test` command. Run them with:
 *
 *   npm run test:integration
 *
 * or via the `testnet` GitHub Actions job (triggered on PRs to `main`). When
 * the STELLAR_TESTNET_KEY secret is absent (e.g. fork PRs) the suite skips
 * cleanly instead of failing.
 *
 * Accounts are funded via Stellar Friendbot automatically in the beforeAll hook,
 * and any state created during the run is cleaned up in the afterAll hook.
 */

import {
  Keypair,
  Networks,
  SorobanRpc,
  TransactionBuilder,
  TimeoutInfinite,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { LumenFlowClient } from "../src/client";
import { LumenFlowError, PaymentErrorCode } from "../src/errors";

// ── Environment ───────────────────────────────────────────────────────────────

const RPC_URL =
  process.env.TESTNET_RPC_URL || "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.TESTNET_CONTRACT_ID;
// CI provisions the account via the STELLAR_TESTNET_KEY secret; fall back to
// the legacy TESTNET_SOURCE_SECRET name for local runs.
const SOURCE_SECRET =
  process.env.STELLAR_TESTNET_KEY || process.env.TESTNET_SOURCE_SECRET;
const NETWORK_PASSPHRASE = Networks.TESTNET;
const FRIENDBOT_URL = "https://friendbot.stellar.org";

// ── Guard — skip unless all required vars are present ────────────────────────
// When STELLAR_TESTNET_KEY is absent (fork PRs) the whole suite is skipped so
// CI stays green rather than failing on missing credentials.

const describeIntegration =
  CONTRACT_ID && SOURCE_SECRET ? describe : describe.skip;

if (!SOURCE_SECRET) {
  // eslint-disable-next-line no-console
  console.warn(
    "[integration.testnet] STELLAR_TESTNET_KEY not set — skipping testnet integration tests."
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Fund an account on testnet via Friendbot.
 */
async function fundAccount(publicKey: string): Promise<void> {
  const res = await fetch(`${FRIENDBOT_URL}?addr=${publicKey}`);
  if (!res.ok) {
    const text = await res.text();
    // Friendbot returns 400 when the account is already funded — that is fine.
    if (!text.includes("createAccountAlreadyExist")) {
      throw new Error(`Friendbot failed for ${publicKey}: ${text}`);
    }
  }
}

/**
 * Build a signer that signs with the provided Keypair.
 */
function makeKeypairSigner(keypair: Keypair) {
  return async (tx: any) => {
    tx.sign(keypair);
    return tx;
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describeIntegration(
  "SDK integration — Stellar testnet @integration",
  () => {
    let client: LumenFlowClient;
    let merchantKeypair: Keypair;
    let payerKeypair: Keypair;
    // Track contract state created during the run so afterAll can clean it up.
    const createdOrderIds: string[] = [];
    const createdRefundIds: string[] = [];
    const registeredMerchants: string[] = [];
    const ORDER_ID = `ORDER-INTEGRATION-${Date.now()}`;
    const REFUND_ID = `REFUND-INTEGRATION-${Date.now()}`;

    // ── Setup ───────────────────────────────────────────────────────────────

    beforeAll(async () => {
      // Use the supplied key as the source/payer; generate a fresh merchant key
      payerKeypair = Keypair.fromSecret(SOURCE_SECRET!);
      merchantKeypair = Keypair.random();

      // Fund both accounts via Friendbot
      await Promise.all([
        fundAccount(payerKeypair.publicKey()),
        fundAccount(merchantKeypair.publicKey()),
      ]);

      client = new LumenFlowClient({
        contractId: CONTRACT_ID!,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: makeKeypairSigner(payerKeypair),
      });
    }, 90_000);

    // ── Merchant registration ─────────────────────────────────────────────

    it(
      "@integration registers a merchant on testnet",
      async () => {
        const merchantClient = new LumenFlowClient({
          contractId: CONTRACT_ID!,
          rpcUrl: RPC_URL,
          networkPassphrase: NETWORK_PASSPHRASE,
          signer: makeKeypairSigner(merchantKeypair),
        });

        await expect(
          merchantClient.registerMerchant({
            merchant_address: merchantKeypair.publicKey(),
            name: "Testnet Integration Store",
            description: "Created by SDK integration tests",
            contact_info: "integration@testnet.local",
            category: "Retail",
          })
        ).resolves.not.toThrow();

        registeredMerchants.push(merchantKeypair.publicKey());
      },
      60_000
    );

    it(
      "@integration rejects duplicate merchant registration",
      async () => {
        const merchantClient = new LumenFlowClient({
          contractId: CONTRACT_ID!,
          rpcUrl: RPC_URL,
          networkPassphrase: NETWORK_PASSPHRASE,
          signer: makeKeypairSigner(merchantKeypair),
        });

        await expect(
          merchantClient.registerMerchant({
            merchant_address: merchantKeypair.publicKey(),
            name: "Duplicate Store",
            description: "Should fail",
            contact_info: "dup@testnet.local",
            category: "Retail",
          })
        ).rejects.toBeInstanceOf(LumenFlowError);
      },
      60_000
    );

    // ── Payment processing ────────────────────────────────────────────────

    it(
      "@integration processes a payment on testnet",
      async () => {
        await expect(
          client.processPayment({
            payer: payerKeypair.publicKey(),
            order_id: ORDER_ID,
            merchant_address: merchantKeypair.publicKey(),
            amount: 1000,
          })
        ).resolves.not.toThrow();

        createdOrderIds.push(ORDER_ID);
      },
      60_000
    );

    it(
      "@integration rejects duplicate order ID",
      async () => {
        await expect(
          client.processPayment({
            payer: payerKeypair.publicKey(),
            order_id: ORDER_ID,
            merchant_address: merchantKeypair.publicKey(),
            amount: 500,
          })
        ).rejects.toBeInstanceOf(LumenFlowError);
      },
      60_000
    );

    // ── Refund lifecycle ──────────────────────────────────────────────────

    it(
      "@integration initiates a refund on testnet",
      async () => {
        await expect(
          client.initiateRefund({
            caller: payerKeypair.publicKey(),
            refund_id: REFUND_ID,
            order_id: ORDER_ID,
            amount: 500,
            reason: "Integration test refund",
          })
        ).resolves.not.toThrow();

        createdRefundIds.push(REFUND_ID);
      },
      60_000
    );

    // ── Payment history ───────────────────────────────────────────────────

    it(
      "@integration retrieves merchant payment history",
      async () => {
        const merchantClient = new LumenFlowClient({
          contractId: CONTRACT_ID!,
          rpcUrl: RPC_URL,
          networkPassphrase: NETWORK_PASSPHRASE,
          signer: makeKeypairSigner(merchantKeypair),
        });

        const page = await merchantClient.getMerchantPaymentHistory({
          merchant: merchantKeypair.publicKey(),
          cursor: null,
          limit: 10,
          filter: null,
          sort_field: "Date",
          sort_order: "Descending",
        });

        expect(page).toBeDefined();
        expect(Array.isArray(page.payments)).toBe(true);
      },
      60_000
    );

    it(
      "@integration throws PaymentNotFound for unknown order",
      async () => {
        try {
          await client.getPaymentById("NONEXISTENT-INTEGRATION-99999");
          fail("expected LumenFlowError");
        } catch (err) {
          expect(err).toBeInstanceOf(LumenFlowError);
          expect((err as LumenFlowError).code).toBe(
            PaymentErrorCode.PaymentNotFound
          );
        }
      },
      60_000
    );

    // ── Teardown ────────────────────────────────────────────────────────────
    // Best-effort cleanup of any state created during the run so repeated CI
    // runs start from a clean slate. Failures here must not fail the suite.

    afterAll(async () => {
      const cleanupClient = client;
      if (!cleanupClient) return;

      for (const refundId of createdRefundIds) {
        try {
          await (cleanupClient as any).cancelRefund?.({
            caller: payerKeypair.publicKey(),
            refund_id: refundId,
          });
        } catch {
          // Ignore — refund may already be settled or unsupported.
        }
      }

      for (const orderId of createdOrderIds) {
        try {
          await (cleanupClient as any).cancelOrder?.({
            caller: payerKeypair.publicKey(),
            order_id: orderId,
          });
        } catch {
          // Ignore — order may already be completed or unsupported.
        }
      }

      for (const merchant of registeredMerchants) {
        try {
          await (cleanupClient as any).deactivateMerchant?.({
            caller: merchant,
            merchant_address: merchant,
          });
        } catch {
          // Ignore — merchant may already be deactivated or unsupported.
        }
      }
    }, 120_000);
  }
);
