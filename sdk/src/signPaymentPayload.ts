import nacl from "tweetnacl";

/**
 * Builds the exact ed25519 payload that the LumenFlow contract verifies for
 * `process_payment_with_signature`.
 *
 * Payload layout (matches `order_id.to_xdr() || amount.to_be_bytes()` in Rust):
 *   [4 bytes] ScVal discriminant for String (14) as big-endian u32
 *   [4 bytes] UTF-8 byte length of orderId as big-endian u32
 *   [n bytes] orderId UTF-8 bytes
 *   [p bytes] zero-padding to next 4-byte boundary
 *   [16 bytes] amount as big-endian i128 (two's complement)
 */
export function buildPaymentPayload(orderId: string, amount: bigint): Buffer {
  const orderIdBytes = Buffer.from(orderId, "utf8");
  const len = orderIdBytes.length;
  const padded = Math.ceil(len / 4) * 4;

  // ScVal::String discriminant = 14
  const discriminant = Buffer.alloc(4);
  discriminant.writeUInt32BE(14, 0);

  const lengthPrefix = Buffer.alloc(4);
  lengthPrefix.writeUInt32BE(len, 0);

  const paddedOrderId = Buffer.alloc(padded);
  orderIdBytes.copy(paddedOrderId);

  // i128 big-endian (16 bytes)
  const amountBuf = Buffer.alloc(16);
  // Handle negative values via two's complement
  let val = amount < 0n ? amount + (1n << 128n) : amount;
  for (let i = 15; i >= 0; i--) {
    amountBuf[i] = Number(val & 0xffn);
    val >>= 8n;
  }

  return Buffer.concat([discriminant, lengthPrefix, paddedOrderId, amountBuf]);
}

export interface Keypair {
  publicKey: Uint8Array; // 32 bytes
  secretKey: Uint8Array; // 64 bytes (seed + public key, as returned by nacl.sign.keyPair)
}

/**
 * Signs the payment payload with the given ed25519 keypair.
 *
 * @param orderId      - The unique order identifier string
 * @param amount       - The payment amount as bigint
 * @param signerKeypair - nacl-compatible keypair ({ publicKey, secretKey })
 * @returns 64-byte ed25519 signature as Buffer
 */
export function signPaymentPayload(
  orderId: string,
  amount: bigint,
  signerKeypair: Keypair
): Buffer {
  const payload = buildPaymentPayload(orderId, amount);
  const signature = nacl.sign.detached(payload, signerKeypair.secretKey);
  return Buffer.from(signature);
}
