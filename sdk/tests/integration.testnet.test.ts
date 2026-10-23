/**
 * SDK integration tests against the Stellar testnet (issue #624).
 *
 * @integration
 *
 * Prerequisites:
 *   - TESTNET_RPC_URL   — Soroban RPC endpoint (default: https://soroban-testnet.stellar.org)
 *   - TESTNET_CONTRACT_ID — deployed LumenFlow contract address on testnet
 *   - TESTNET_SOURCE_SECRET — funded account secret key (funded via Friendbot)
 *
 * These tests are tagged @integration and are NOT run by the standard
 * `npm test` command. Run them with:
 *
 *   npm run test:integration
 *
 * or via the scheduled GitHub Actions workflow.
 *
 * Accounts are funded via Stellar Friendbot automatically in the beforeAll hook.
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
const SOURCE_SECRET = process.env.TESTNET_SOURCE_SECRET;
const NETWORK_PASSPHRASE = Networks.TESTNET;
const FRIENDBOT_URL = "https://friendbot.stellar.org";

// ── Guard — skip unless all required vars are present ────────────────────────

const describeIntegration =
  CONTRACT_ID && SOURCE_SECRET ? describe : describe.skip;

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
  }
);
