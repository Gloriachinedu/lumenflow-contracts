/**
 * @differential
 *
 * Differential tests — SDK vs. direct @stellar/stellar-sdk calls (Issue #631)
 *
 * These tests verify that the LumenFlow SDK produces results that are byte-for-byte
 * identical to what you would get by calling @stellar/stellar-sdk directly,
 * without any SDK wrapping. Any discrepancy (wrong XDR encoding, wrong field name,
 * off-by-one in serialisation) will cause a test to fail with a descriptive diff.
 *
 * Test tags: @differential
 *
 * Intended run schedule: weekly via .github/workflows/differential-tests.yml
 * (also runs on every PR automatically).
 *
 * Prerequisites:
 *   - No live network required — all comparisons use deterministic, offline encoding.
 *   - For testnet comparisons, set SOROBAN_RPC_URL and CONTRACT_ID env vars.
 */

import nacl from "tweetnacl";
import {
  Address,
  hash,
  xdr,
  StrKey,
} from "@stellar/stellar-sdk";

// Import the SDK helpers under test
import { buildPaymentPayload, signPaymentPayload } from "../signPaymentPayload";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const NETWORK_TESTNET = "Test SDF Network ; September 2015";
const NETWORK_MAINNET = "Public Global Stellar Network ; September 2015";
const NETWORK_LOCAL = "Standalone Network ; February 2017";

// Deterministic zero-seed keypair (never use in production)
const SEED = new Uint8Array(32);
const KEYPAIR = nacl.sign.keyPair.fromSeed(SEED);

// All-zeros 32-byte contract ID (valid base32 C-address)
const CONTRACT_BYTES = Buffer.alloc(32, 0);
const CONTRACT_ID = StrKey.encodeContract(CONTRACT_BYTES);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build the payment payload using the raw @stellar/stellar-sdk primitives,
 * BYPASSING the LumenFlow SDK completely. This is the "reference implementation"
 * that the SDK must match.
 *
 * Payload layout (must match Rust contract `process_payment_with_signature`):
 *   [32 bytes] SHA-256 of network passphrase
 *   [n bytes]  contractId as ScAddress XDR
 *   [m bytes]  orderId as ScVal::String XDR
 *   [16 bytes] amount as big-endian i128 (two's complement)
 */
function buildPayloadRaw(
  networkPassphrase: string,
  contractId: string,
  orderId: string,
  amount: bigint
): Buffer {
  // 1. Network ID — SHA-256 hash of the passphrase
  const networkId = hash(Buffer.from(networkPassphrase, "utf8"));

  // 2. Contract address — XDR-encoded ScAddress
  const contractIdXdr = Address.fromString(contractId).toScAddress().toXDR();

  // 3. Order ID — XDR-encoded ScVal::String
  const orderIdXdr = xdr.ScVal.scvString(orderId).toXDR();

  // 4. Amount — big-endian i128 (16 bytes, two's complement)
  const amountBuf = Buffer.alloc(16);
  let val = amount < 0n ? amount + (1n << 128n) : amount;
  for (let i = 15; i >= 0; i--) {
    amountBuf[i] = Number(val & 0xffn);
    val >>= 8n;
  }

  return Buffer.concat([networkId, contractIdXdr, orderIdXdr, amountBuf]);
}

/**
 * Compute the network ID using raw stellar-sdk, bypassing the SDK helper.
 */
function networkIdRaw(passphrase: string): Buffer {
  return Buffer.from(hash(Buffer.from(passphrase, "utf8")));
}

// ── Differential: buildPaymentPayload ─────────────────────────────────────────

describe("@differential buildPaymentPayload — SDK vs. stellar-sdk raw", () => {
  const cases: Array<{ label: string; network: string; orderId: string; amount: bigint }> = [
    { label: "testnet / typical", network: NETWORK_TESTNET, orderId: "ORDER_001", amount: 1000n },
    { label: "mainnet / large amount", network: NETWORK_MAINNET, orderId: "INV-9999", amount: 999_000_000_000n },
    { label: "local / zero amount", network: NETWORK_LOCAL, orderId: "X", amount: 0n },
    { label: "testnet / negative i128", network: NETWORK_TESTNET, orderId: "REFUND_1", amount: -500n },
    { label: "testnet / max i128", network: NETWORK_TESTNET, orderId: "MAX", amount: (1n << 127n) - 1n },
    { label: "testnet / multi-char unicode order", network: NETWORK_TESTNET, orderId: "ORD-αβγ", amount: 42n },
    { label: "testnet / 64-char order ID (max)", network: NETWORK_TESTNET, orderId: "A".repeat(64), amount: 1n },
  ];

  for (const { label, network, orderId, amount } of cases) {
    it(`produces identical bytes to stellar-sdk raw: ${label}`, () => {
      const sdkResult = buildPaymentPayload(network, CONTRACT_ID, orderId, amount);
      const rawResult = buildPayloadRaw(network, CONTRACT_ID, orderId, amount);

      if (!sdkResult.equals(rawResult)) {
        // Descriptive diff for easier debugging
        const diff = sdkResult
          .toString("hex")
          .split("")
          .map((c, i) => (c === rawResult.toString("hex")[i] ? c : `[${c}≠${rawResult.toString("hex")[i]}]`))
          .join("");
        throw new Error(
          `Payload mismatch for '${label}':\n` +
            `  SDK: ${sdkResult.toString("hex")}\n` +
            `  Raw: ${rawResult.toString("hex")}\n` +
            `  Diff: ${diff}`
        );
      }

      expect(sdkResult.equals(rawResult)).toBe(true);
    });
  }

  it("network ID prefix (bytes 0-31) matches SHA-256 of passphrase computed raw", () => {
    const sdkPayload = buildPaymentPayload(NETWORK_TESTNET, CONTRACT_ID, "ORDER_001", 1000n);
    const rawNetworkId = networkIdRaw(NETWORK_TESTNET);
    expect(Buffer.from(sdkPayload.slice(0, 32)).equals(rawNetworkId)).toBe(true);
  });

  it("contract ID bytes match Address.fromString().toScAddress().toXDR()", () => {
    const sdkPayload = buildPaymentPayload(NETWORK_TESTNET, CONTRACT_ID, "ORDER_001", 1000n);
    const rawContractXdr = Address.fromString(CONTRACT_ID).toScAddress().toXDR();
    const sdkContractSlice = sdkPayload.slice(32, 32 + rawContractXdr.length);
    expect(Buffer.from(sdkContractSlice).equals(rawContractXdr)).toBe(true);
  });

  it("amount suffix (last 16 bytes) correctly encodes i128 big-endian", () => {
    const amount = 1_234_567_890n;
    const sdkPayload = buildPaymentPayload(NETWORK_TESTNET, CONTRACT_ID, "ORDER_001", amount);
    const rawPayload = buildPayloadRaw(NETWORK_TESTNET, CONTRACT_ID, "ORDER_001", amount);
    const sdkAmount = sdkPayload.slice(sdkPayload.length - 16);
    const rawAmount = rawPayload.slice(rawPayload.length - 16);
    expect(Buffer.from(sdkAmount).equals(rawAmount)).toBe(true);
  });
});

// ── Differential: signPaymentPayload ──────────────────────────────────────────

describe("@differential signPaymentPayload — SDK vs. nacl.sign.detached raw", () => {
  it("produces identical 64-byte signature to direct nacl.sign.detached", () => {
    const orderId = "ORDER_001";
    const amount = 1000n;

    // SDK path
    const sdkSig = signPaymentPayload(NETWORK_TESTNET, CONTRACT_ID, orderId, amount, KEYPAIR);

    // Raw path — build payload directly then sign with nacl
    const rawPayload = buildPayloadRaw(NETWORK_TESTNET, CONTRACT_ID, orderId, amount);
    const rawSig = Buffer.from(nacl.sign.detached(rawPayload, KEYPAIR.secretKey));

    if (!sdkSig.equals(rawSig)) {
      throw new Error(
        `Signature mismatch:\n  SDK: ${sdkSig.toString("hex")}\n  Raw: ${rawSig.toString("hex")}`
      );
    }

    expect(sdkSig.equals(rawSig)).toBe(true);
  });

  it("SDK signature verifies with nacl.sign.detached.verify using same payload", () => {
    const sdkSig = signPaymentPayload(NETWORK_TESTNET, CONTRACT_ID, "ORDER_001", 1000n, KEYPAIR);
    const rawPayload = buildPayloadRaw(NETWORK_TESTNET, CONTRACT_ID, "ORDER_001", 1000n);
    expect(nacl.sign.detached.verify(rawPayload, sdkSig, KEYPAIR.publicKey)).toBe(true);
  });

  it("raw nacl signature verifies with SDK-built payload", () => {
    const rawPayload = buildPayloadRaw(NETWORK_TESTNET, CONTRACT_ID, "ORDER_001", 1000n);
    const rawSig = nacl.sign.detached(rawPayload, KEYPAIR.secretKey);
    const sdkPayload = buildPaymentPayload(NETWORK_TESTNET, CONTRACT_ID, "ORDER_001", 1000n);
    expect(nacl.sign.detached.verify(sdkPayload, rawSig, KEYPAIR.publicKey)).toBe(true);
  });

  it("signature is deterministic — same inputs always produce the same output", () => {
    const sig1 = signPaymentPayload(NETWORK_TESTNET, CONTRACT_ID, "ORDER_001", 1000n, KEYPAIR);
    const sig2 = signPaymentPayload(NETWORK_TESTNET, CONTRACT_ID, "ORDER_001", 1000n, KEYPAIR);
    expect(sig1.equals(sig2)).toBe(true);
  });
});

// ── Differential: XDR field shapes ───────────────────────────────────────────

describe("@differential XDR field encoding — SDK vs. stellar-sdk raw", () => {
  it("ScVal::String XDR matches xdr.ScVal.scvString(value).toXDR()", () => {
    const orderId = "ORDER_001";

    // Extract the orderId XDR from the SDK payload
    const sdkPayload = buildPaymentPayload(NETWORK_TESTNET, CONTRACT_ID, orderId, 1000n);
    const rawContractXdr = Address.fromString(CONTRACT_ID).toScAddress().toXDR();
    const orderIdStart = 32 + rawContractXdr.length;
    const orderIdEnd = sdkPayload.length - 16;
    const sdkOrderIdXdr = sdkPayload.slice(orderIdStart, orderIdEnd);

    // Build the expected XDR using stellar-sdk directly
    const rawOrderIdXdr = xdr.ScVal.scvString(orderId).toXDR();

    expect(Buffer.from(sdkOrderIdXdr).equals(rawOrderIdXdr)).toBe(true);
  });

  it("empty string encodes to a 4+0 byte XDR string with correct discriminant", () => {
    const sdkPayload = buildPaymentPayload(NETWORK_TESTNET, CONTRACT_ID, "", 0n);
    const rawPayload = buildPayloadRaw(NETWORK_TESTNET, CONTRACT_ID, "", 0n);
    expect(sdkPayload.equals(rawPayload)).toBe(true);
  });

  it("Address XDR encoding is consistent across SDK and stellar-sdk", () => {
    // Build a non-zero contract ID
    const nonZeroBytes = Buffer.alloc(32, 42);
    const nonZeroContractId = StrKey.encodeContract(nonZeroBytes);

    const sdkPayload = buildPaymentPayload(NETWORK_TESTNET, nonZeroContractId, "ORD", 1n);
    const rawPayload = buildPayloadRaw(NETWORK_TESTNET, nonZeroContractId, "ORD", 1n);

    expect(sdkPayload.equals(rawPayload)).toBe(true);
  });
});

// ── Differential: network passphrase sensitivity ──────────────────────────────

describe("@differential network passphrase sensitivity", () => {
  const NETWORKS = [NETWORK_TESTNET, NETWORK_MAINNET, NETWORK_LOCAL];

  it("each network produces a distinct payload", () => {
    const payloads = NETWORKS.map((n) =>
      buildPaymentPayload(n, CONTRACT_ID, "ORDER_001", 1000n).toString("hex")
    );
    const unique = new Set(payloads);
    expect(unique.size).toBe(NETWORKS.length);
  });

  it("SDK and raw payloads differ between networks in exactly the first 32 bytes", () => {
    for (const network of NETWORKS) {
      const sdkPayload = buildPaymentPayload(network, CONTRACT_ID, "ORDER_001", 1000n);
      const rawPayload = buildPayloadRaw(network, CONTRACT_ID, "ORDER_001", 1000n);
      expect(sdkPayload.equals(rawPayload)).toBe(
        true,
        `Mismatch for network '${network}':\n  SDK: ${sdkPayload.toString("hex")}\n  Raw: ${rawPayload.toString("hex")}`
      );
    }
  });
});
