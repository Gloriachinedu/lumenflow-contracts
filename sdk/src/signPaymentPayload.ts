import nacl from "tweetnacl";
import { xdr, Address, hash } from "@stellar/stellar-sdk";

export interface Keypair {
  publicKey: Uint8Array; // 32 bytes
  secretKey: Uint8Array; // 64 bytes (seed + public key, as returned by nacl.sign.keyPair)
}

/**
 * Builds the exact ed25519 payload that the LumenFlow contract verifies for
 * `process_payment_with_signature`.
 *
 * Payload layout:
 *   [32 bytes] networkId (SHA-256 of network passphrase)
 *   [x bytes]  contractId XDR (ScAddress)
 *   [y bytes]  orderId XDR (ScVal::String)
 *   [16 bytes] amount as big-endian i128 (two's complement)
 */
export function buildPaymentPayload(
  networkPassphrase: string,
  contractId: string,
  orderId: string,
  amount: bigint
): Buffer {
  const networkId = hash(Buffer.from(networkPassphrase, "utf8"));
  const contractIdXdr = Address.fromString(contractId).toScAddress().toXDR();
  const orderIdXdr = xdr.ScVal.scvString(orderId).toXDR();

  const amountBuf = Buffer.alloc(16);
  let val = amount < 0n ? amount + (1n << 128n) : amount;
  for (let i = 15; i >= 0; i--) {
    amountBuf[i] = Number(val & 0xffn);
    val >>= 8n;
  }

  return Buffer.concat([networkId, contractIdXdr, orderIdXdr, amountBuf]);
}

/**
 * Signs the payment payload with the given ed25519 keypair.
 *
 * @param networkPassphrase - The network passphrase
 * @param contractId   - The contract address (e.g. C...)
 * @param orderId      - The unique order identifier string
 * @param amount       - The payment amount as bigint
 * @param signerKeypair - nacl-compatible keypair ({ publicKey, secretKey })
 * @returns 64-byte ed25519 signature as Buffer
 */
export function signPaymentPayload(
  networkPassphrase: string,
  contractId: string,
  orderId: string,
  amount: bigint,
  signerKeypair: Keypair
): Buffer {
  const payload = buildPaymentPayload(networkPassphrase, contractId, orderId, amount);
  const signature = nacl.sign.detached(payload, signerKeypair.secretKey);
  return Buffer.from(signature);
}
