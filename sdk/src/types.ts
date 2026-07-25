/**
 * TypeScript type definitions for the LumenFlow smart contract.
 *
 * These interfaces mirror the Rust `#[contracttype]` structs defined in
 * contracts/lumenflow/src/types.rs and are used as strongly-typed response
 * shapes across all public SDK methods.
 */

// ── Generic helpers ──────────────────────────────────────────────────────────

/** Mirrors Soroban SDK's Option<T>. */
export type Option<T> = T | null;

/** Mirrors Soroban SDK's Vec<T> (array in TypeScript). */
export type Vec<T> = T[];

// ── Merchant ─────────────────────────────────────────────────────────────────

export type MerchantCategory = 'Retail' | 'Food' | 'Services' | 'Digital' | 'Other';

/** Mirrors Rust `Merchant` struct. */
export interface Merchant {
  address: string;
  name: string;
  description: string;
  contact_info: string;
  category: MerchantCategory;
  active: boolean;
  verified: boolean;
  registered_at: bigint;
  total_received: bigint;
}

// ── Payment ───────────────────────────────────────────────────────────────────

export type PaymentStatus = 'Completed' | 'PartiallyRefunded' | 'FullyRefunded';

/** Mirrors Rust `PaymentOrder` struct. */
export interface PaymentOrder {
  order_id: string;
  merchant_address: string;
  payer: string;
  token: string;
  amount: bigint;
  status: PaymentStatus;
  paid_at: bigint;
  refunded_amount: bigint;
  memo: string;
  tags: Option<Vec<string>>;
  note: Option<string>;
}

/** Mirrors Rust `PaymentSummary` struct. */
export interface PaymentSummary {
  order_id: string;
  merchant_address: string;
  amount: bigint;
  token: string;
  status: PaymentStatus;
  paid_at: bigint;
}

/** Mirrors Rust `PaymentRequest` struct. */
export interface PaymentRequest {
  request_id: string;
  merchant: string;
  token: string;
  amount: bigint;
  memo: string;
  expires_at: bigint;
}

/** Mirrors Rust `BatchPaymentItem` struct. */
export interface BatchPaymentItem {
  order_id: string;
  merchant_address: string;
  token_address: string;
  amount: bigint;
  memo: string;
  signature: Uint8Array;
  merchant_public_key: Uint8Array;
}

// ── Refund ────────────────────────────────────────────────────────────────────

export type RefundStatus = 'Pending' | 'Approved' | 'Rejected' | 'Completed' | 'Disputed';

/** Mirrors Rust `RefundRecord` struct. */
export interface RefundRecord {
  refund_id: string;
  order_id: string;
  initiator: string;
  amount: bigint;
  reason: string;
  status: RefundStatus;
  created_at: bigint;
}

// ── Dispute ───────────────────────────────────────────────────────────────────

export type DisputeOutcome = 'FavorPayer' | 'FavorMerchant';

/** Mirrors Rust `DisputeRecord` struct. */
export interface DisputeRecord {
  refund_id: string;
  payer: string;
  evidence: string;
  outcome: Option<DisputeOutcome>;
  created_at: bigint;
}

// ── Multisig ──────────────────────────────────────────────────────────────────

/** Mirrors Rust `MultisigPayment` struct. */
export interface MultisigPayment {
  payment_id: string;
  merchant_address: string;
  token: string;
  amount: bigint;
  required_signatures: number;
  signers: Vec<string>;
  signatures: Vec<Uint8Array>;
  signed_by: Vec<string>;
  executed: boolean;
  created_at: bigint;
}

// ── Query helpers ─────────────────────────────────────────────────────────────

export type SortField = 'Date' | 'Amount';
export type SortOrder = 'Ascending' | 'Descending';
export type StatusFilter = 'Any' | 'Completed' | 'PartiallyRefunded' | 'FullyRefunded';

/** Mirrors Rust `PaymentFilter` struct. */
export interface PaymentFilter {
  date_start: Option<bigint>;
  date_end: Option<bigint>;
  amount_min: Option<bigint>;
  amount_max: Option<bigint>;
  token: Option<string>;
  status: StatusFilter;
  tag: Option<string>;
}

/** Mirrors Rust `PaymentPage` struct (paginated response). */
export interface PaymentPage {
  payments: Vec<PaymentOrder>;
  next_cursor: Option<string>;
  total: number;
}

// ── Stats ─────────────────────────────────────────────────────────────────────

/** Mirrors Rust `GlobalStats` struct. */
export interface GlobalStats {
  total_payments: number;
  total_volume: bigint;
  total_refunds: number;
  total_refund_volume: bigint;
  active_merchants: number;
}

/** Per-merchant stats derived from payment history. */
export interface MerchantStats {
  merchant_address: string;
  total_payments: number;
  total_volume: bigint;
  total_refunded: bigint;
  active: boolean;
}

// ── Suspicious Activity ───────────────────────────────────────────────────────

export type SuspiciousActivityReason =
  | 'LargePayment'
  | 'RapidRefunds'
  | 'ManyAuthFailures';

// ── Subscription ──────────────────────────────────────────────────────────────

export type SubscriptionStatus = 'Active' | 'Cancelled' | 'Completed';

/** Mirrors Rust `SubscriptionPlan` struct. */
export interface SubscriptionPlan {
  plan_id: string;
  merchant: string;
  token: string;
  amount: bigint;
  interval_secs: bigint;
  max_cycles: number;
}

/** Mirrors Rust `Subscription` struct. */
export interface Subscription {
  subscription_id: string;
  plan_id: string;
  subscriber: string;
  cycles_charged: number;
  last_charged_at: bigint;
  status: SubscriptionStatus;
  created_at: bigint;
}

// ── Payment Event (used by WebSocket/SSE subscription) ───────────────────────

/** A real-time payment event delivered via Horizon SSE. */
export interface PaymentEvent {
  /** Horizon event type, e.g. "payment_processed" */
  type: string;
  /** The LumenFlow order ID */
  order_id: string;
  /** Merchant address involved */
  merchant_address: string;
  /** Payer address */
  payer: string;
  /** Token asset address */
  token: string;
  /** Payment amount */
  amount: bigint;
  /** Unix timestamp (seconds) */
  timestamp: bigint;
  /** Full raw event payload from Horizon */
  raw: Record<string, unknown>;
}
