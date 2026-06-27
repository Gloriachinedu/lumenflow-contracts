/**
 * Signature payload helpers for LumenFlow payment authorisation.
 *
 * See docs/signature-format.md for the full specification.
 */

export interface SignaturePayloadParams {
  /** Unique order identifier */
  orderId: string;
  /** Stellar G… address of the merchant */
  merchantAddress: string;
  /** Stellar G… address of the payer */
  payerAddress: string;
  /** Stellar G… address of the token contract */
  tokenAddress: string;
  /** Payment amount in stroops (bigint to handle i128 safely) */
  amount: bigint;
}

/**
 * Build the canonical UTF-8 payload that the merchant must sign with their
 * Ed25519 private key before a `process_payment_with_signature` call.
 *
 * Format: `<order_id>:<merchant_address>:<payer_address>:<token_address>:<amount>`
 */
export function buildSignaturePayload(params: SignaturePayloadParams): Uint8Array {
  const { orderId, merchantAddress, payerAddress, tokenAddress, amount } = params;

  if (!orderId || !merchantAddress || !payerAddress || !tokenAddress) {
    throw new Error("All address and orderId fields are required");
  }
  if (amount <= 0n) {
    throw new Error("amount must be a positive bigint");
  }

  const raw = `${orderId}:${merchantAddress}:${payerAddress}:${tokenAddress}:${amount.toString()}`;
  return new TextEncoder().encode(raw);
}

/**
 * Return the payload as a plain string (for display / debugging).
 */
export function buildSignaturePayloadString(params: SignaturePayloadParams): string {
  return new TextDecoder().decode(buildSignaturePayload(params));
}
