/**
 * LumenFlow SDK — TypeScript type definitions
 *
 * These types mirror the Soroban contract types defined in
 * contracts/lumenflow/src/types.rs and are intended for use
 * in front-end applications and Node.js integrations.
 */

// ── Merchant ──────────────────────────────────────────────────────────────────

export type MerchantCategory = "Retail" | "Food" | "Services" | "Digital" | "Other";

export interface Merchant {
  address: string;
  name: string;
  description: string;
  contact_info: string;
  category: MerchantCategory;
  active: boolean;
  registered_at: number; // Unix timestamp (seconds)
  total_received: bigint;
}

// ── Payment ───────────────────────────────────────────────────────────────────

export type PaymentStatus = "Completed" | "PartiallyRefunded" | "FullyRefunded";

export interface PaymentOrder {
  order_id: string;
  merchant_address: string;
  payer: string;
  token: string;
  amount: bigint;
  status: PaymentStatus;
  paid_at: number; // Unix timestamp (seconds)
  refunded_amount: bigint;
  memo: string;
  /**
   * Optional tags for this payment. Maximum 5 tags, each 1–32 characters.
   */
  tags?: string[];
}

/**
 * A single item in a batch payment request.
 *
 * Updated in issue #660: added the optional `tags` field so merchants
 * can label individual batch items the same way as single payments.
 */
export interface BatchPaymentItem {
  /** Unique order identifier for this item. Must not already exist on-chain. */
  order_id: string;
  /** Merchant receiving this payment. Must be a registered, active merchant. */
  merchant_address: string;
  /** SAC token address to transfer. */
  token_address: string;
  /** Payment amount in the token's smallest unit. Must be > 0. */
  amount: bigint;
  /** Optional human-readable memo for this item. */
  memo: string;
  /**
   * Optional tags for categorising this batch item.
   *
   * Rules (validated server-side with `validate_tags`):
   * - Maximum **5** tags per item.
   * - Each tag must be between **1** and **32** characters.
   * - An invalid tag in any item causes the **entire batch** to be rejected.
   *
   * @example ["invoice", "q3-2026", "europe"]
   */
  tags?: string[];
  /** ed25519 signature over `order_id_xdr || amount_be_bytes` by the merchant key. */
  signature: Uint8Array;
  /** ed25519 public key of the merchant (32 bytes). */
  merchant_public_key: Uint8Array;
}

// ── Refund ────────────────────────────────────────────────────────────────────

export type RefundStatus = "Pending" | "Approved" | "Rejected" | "Completed";

export interface RefundRecord {
  refund_id: string;
  order_id: string;
  initiator: string;
  amount: bigint;
  reason: string;
  status: RefundStatus;
  created_at: number; // Unix timestamp (seconds)
}

// ── Multisig ──────────────────────────────────────────────────────────────────

export interface MultisigPayment {
  payment_id: string;
  merchant_address: string;
  token: string;
  amount: bigint;
  required_signatures: number;
  signers: string[];
  signatures: Uint8Array[];
  executed: boolean;
  created_at: number; // Unix timestamp (seconds)
}

// ── Query helpers ─────────────────────────────────────────────────────────────

export type SortField = "Date" | "Amount";
export type SortOrder = "Ascending" | "Descending";
export type StatusFilter = "Any" | "Completed" | "PartiallyRefunded" | "FullyRefunded";

export interface PaymentFilter {
  date_start?: number;
  date_end?: number;
  amount_min?: bigint;
  amount_max?: bigint;
  token?: string;
  status: StatusFilter;
  tag?: string;
}

export interface PaymentPage {
  payments: PaymentOrder[];
  next_cursor?: string;
  total: number;
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export interface GlobalStats {
  total_payments: number;
  total_volume: bigint;
  total_refunds: number;
  total_refund_volume: bigint;
  active_merchants: number;
}
