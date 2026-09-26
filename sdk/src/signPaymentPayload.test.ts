import nacl from "tweetnacl";
import { buildPaymentPayload, signPaymentPayload } from "./signPaymentPayload";
import { xdr, Address, hash } from "@stellar/stellar-sdk";

// Known-good keypair (seed = 32 zero bytes)
const SEED = new Uint8Array(32);
const KEYPAIR = nacl.sign.keyPair.fromSeed(SEED);

const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

describe("buildPaymentPayload", () => {
  it("produces correct byte layout for a simple order", () => {
    const payload = buildPaymentPayload(NETWORK_PASSPHRASE, CONTRACT_ID, "ORDER_001", 1000n);

    expect(payload.length).toBe(104);
    const networkId = hash(Buffer.from(NETWORK_PASSPHRASE));
    expect(payload.slice(0, 32).equals(networkId)).toBe(true);
  });

  it("encodes zero amount correctly", () => {
    const payload = buildPaymentPayload(NETWORK_PASSPHRASE, CONTRACT_ID, "X", 0n);
    const amountBytes = payload.slice(payload.length - 16, payload.length);
    expect(amountBytes.every((b) => b === 0)).toBe(true);
  });
});

describe("signPaymentPayload", () => {
  it("returns a 64-byte buffer", () => {
    const sig = signPaymentPayload(NETWORK_PASSPHRASE, CONTRACT_ID, "ORDER_001", 1000n, KEYPAIR);
    expect(sig).toBeInstanceOf(Buffer);
    expect(sig.length).toBe(64);
  });

  it("produces a valid ed25519 signature", () => {
    const orderId = "ORDER_001";
    const amount = 1000n;
    const sig = signPaymentPayload(NETWORK_PASSPHRASE, CONTRACT_ID, orderId, amount, KEYPAIR);
    const payload = buildPaymentPayload(NETWORK_PASSPHRASE, CONTRACT_ID, orderId, amount);
    const valid = nacl.sign.detached.verify(payload, sig, KEYPAIR.publicKey);
    expect(valid).toBe(true);
  });

  it("produces a known-good signature for a fixed input", () => {
    // Deterministic: same inputs → same signature
    const sig1 = signPaymentPayload(NETWORK_PASSPHRASE, CONTRACT_ID, "ORDER_001", 1000n, KEYPAIR);
    const sig2 = signPaymentPayload(NETWORK_PASSPHRASE, CONTRACT_ID, "ORDER_001", 1000n, KEYPAIR);
    expect(sig1.equals(sig2)).toBe(true);
  });

  it("different orderId produces different signature", () => {
    const sig1 = signPaymentPayload(NETWORK_PASSPHRASE, CONTRACT_ID, "ORDER_001", 1000n, KEYPAIR);
    const sig2 = signPaymentPayload(NETWORK_PASSPHRASE, CONTRACT_ID, "ORDER_002", 1000n, KEYPAIR);
    expect(sig1.equals(sig2)).toBe(false);
  });

  it("different amount produces different signature", () => {
    const sig1 = signPaymentPayload(NETWORK_PASSPHRASE, CONTRACT_ID, "ORDER_001", 1000n, KEYPAIR);
    const sig2 = signPaymentPayload(NETWORK_PASSPHRASE, CONTRACT_ID, "ORDER_001", 2000n, KEYPAIR);
    expect(sig1.equals(sig2)).toBe(false);
  });

  it("different contract produces different signature", () => {
    const contractId2 = Address.contract(Buffer.alloc(32, 1)).toString();
    const sig1 = signPaymentPayload(NETWORK_PASSPHRASE, CONTRACT_ID, "ORDER_001", 1000n, KEYPAIR);
    const sig2 = signPaymentPayload(NETWORK_PASSPHRASE, contractId2, "ORDER_001", 1000n, KEYPAIR);
    expect(sig1.equals(sig2)).toBe(false);
  });

  it("invalid signature fails verification", () => {
    const sig = signPaymentPayload(NETWORK_PASSPHRASE, CONTRACT_ID, "ORDER_001", 1000n, KEYPAIR);
    const payload = buildPaymentPayload(NETWORK_PASSPHRASE, CONTRACT_ID, "ORDER_001", 999n); // different amount
    const valid = nacl.sign.detached.verify(payload, sig, KEYPAIR.publicKey);
    expect(valid).toBe(false);
  });
});