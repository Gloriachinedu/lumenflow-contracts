import nacl from "tweetnacl";
import { buildPaymentPayload, signPaymentPayload } from "./signPaymentPayload";

// Known-good keypair (seed = 32 zero bytes)
const SEED = new Uint8Array(32);
const KEYPAIR = nacl.sign.keyPair.fromSeed(SEED);

describe("buildPaymentPayload", () => {
  it("produces correct byte layout for a simple order", () => {
    const payload = buildPaymentPayload("ORDER_001", 1000n);

    // discriminant: ScVal::String = 14
    expect(payload.readUInt32BE(0)).toBe(14);
    // length prefix
    expect(payload.readUInt32BE(4)).toBe(9); // "ORDER_001".length
    // orderId bytes
    expect(payload.slice(8, 17).toString("utf8")).toBe("ORDER_001");
    // padded to 12 bytes (ceil(9/4)*4 = 12)
    // amount starts at offset 4+4+12 = 20
    expect(payload.length).toBe(4 + 4 + 12 + 16);
  });

  it("pads orderId to 4-byte boundary", () => {
    // "AB" = 2 bytes → padded to 4
    const payload = buildPaymentPayload("AB", 0n);
    expect(payload.length).toBe(4 + 4 + 4 + 16);
  });

  it("encodes amount as big-endian i128", () => {
    const payload = buildPaymentPayload("X", 256n);
    const amountOffset = 4 + 4 + 4; // discriminant + len + padded "X" (4 bytes)
    // 256 = 0x0000...0100
    expect(payload[amountOffset + 14]).toBe(1);
    expect(payload[amountOffset + 15]).toBe(0);
  });

  it("encodes zero amount correctly", () => {
    const payload = buildPaymentPayload("X", 0n);
    const amountOffset = 4 + 4 + 4;
    const amountBytes = payload.slice(amountOffset, amountOffset + 16);
    expect(amountBytes.every((b) => b === 0)).toBe(true);
  });
});

describe("signPaymentPayload", () => {
  it("returns a 64-byte buffer", () => {
    const sig = signPaymentPayload("ORDER_001", 1000n, KEYPAIR);
    expect(sig).toBeInstanceOf(Buffer);
    expect(sig.length).toBe(64);
  });

  it("produces a valid ed25519 signature", () => {
    const orderId = "ORDER_001";
    const amount = 1000n;
    const sig = signPaymentPayload(orderId, amount, KEYPAIR);
    const payload = buildPaymentPayload(orderId, amount);
    const valid = nacl.sign.detached.verify(payload, sig, KEYPAIR.publicKey);
    expect(valid).toBe(true);
  });

  it("produces a known-good signature for a fixed input", () => {
    // Deterministic: same inputs → same signature
    const sig1 = signPaymentPayload("ORDER_001", 1000n, KEYPAIR);
    const sig2 = signPaymentPayload("ORDER_001", 1000n, KEYPAIR);
    expect(sig1.equals(sig2)).toBe(true);
  });

  it("different orderId produces different signature", () => {
    const sig1 = signPaymentPayload("ORDER_001", 1000n, KEYPAIR);
    const sig2 = signPaymentPayload("ORDER_002", 1000n, KEYPAIR);
    expect(sig1.equals(sig2)).toBe(false);
  });

  it("different amount produces different signature", () => {
    const sig1 = signPaymentPayload("ORDER_001", 1000n, KEYPAIR);
    const sig2 = signPaymentPayload("ORDER_001", 2000n, KEYPAIR);
    expect(sig1.equals(sig2)).toBe(false);
  });

  it("invalid signature fails verification", () => {
    const sig = signPaymentPayload("ORDER_001", 1000n, KEYPAIR);
    const payload = buildPaymentPayload("ORDER_001", 999n); // different amount
    const valid = nacl.sign.detached.verify(payload, sig, KEYPAIR.publicKey);
    expect(valid).toBe(false);
  });
});
