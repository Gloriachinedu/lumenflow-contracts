/**
 * Merchant business category.
 *
 * Simple variants are plain string literals.  The Custom variant carries an
 * arbitrary label (1–32 characters) that mirrors the Rust `Custom(String)`
 * tuple variant defined in the smart contract.
 *
 * @example
 * // Simple variant
 * const category: MerchantCategory = "Retail";
 *
 * // Custom variant
 * const category: MerchantCategory = { Custom: "Handmade" };
 */
export type MerchantCategory =
  | "Retail"
  | "Food"
  | "Services"
  | "Digital"
  | "Other"
  | { Custom: string };

/** Namespace providing named helpers for each MerchantCategory variant. */
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace MerchantCategory {
  export const Retail: MerchantCategory = "Retail";
  export const Food: MerchantCategory = "Food";
  export const Services: MerchantCategory = "Services";
  export const Digital: MerchantCategory = "Digital";
  export const Other: MerchantCategory = "Other";
  /** Create a Custom category value. `label` must be 1–32 characters. */
  export function custom(label: string): MerchantCategory {
    return { Custom: label };
  }
}

export interface Merchant {
  address: string;
  name: string;
  description: string;
  contactInfo: string;
  category: MerchantCategory;
  active: boolean;
  verified: boolean;
  registeredAt: bigint;
  totalReceived: bigint;
}

export enum PaymentStatus {
  Completed = "Completed",
  PartiallyRefunded = "PartiallyRefunded",
  FullyRefunded = "FullyRefunded",
}

export interface PaymentOrder {
  orderId: string;
  merchantAddress: string;
  payer: string;
  token: string;
  amount: bigint;
  status: PaymentStatus;
  paidAt: bigint;
  refundedAmount: bigint;
  memo: string;
  tags?: string[];
  note?: string;
}

export interface PaymentSummary {
  orderId: string;
  merchantAddress: string;
  amount: bigint;
  token: string;
  status: PaymentStatus;
  paidAt: bigint;
}

export interface PaymentRequest {
  requestId: string;
  merchant: string;
  token: string;
  amount: bigint;
  memo: string;
  expiresAt: bigint;
}

export interface BatchPaymentItem {
  orderId: string;
  merchantAddress: string;
  tokenAddress: string;
  amount: bigint;
  memo: string;
  signature: Buffer;
  merchantPublicKey: Buffer;
}

export enum RefundStatus {
  Pending = "Pending",
  Approved = "Approved",
  Rejected = "Rejected",
  Completed = "Completed",
  Disputed = "Disputed",
}

export interface RefundRecord {
  refundId: string;
  orderId: string;
  initiator: string;
  amount: bigint;
  reason: string;
  status: RefundStatus;
  createdAt: bigint;
}

export enum DisputeOutcome {
  FavorPayer = "FavorPayer",
  FavorMerchant = "FavorMerchant",
}

export interface DisputeRecord {
  refundId: string;
  payer: string;
  evidence: string;
  outcome?: DisputeOutcome;
  createdAt: bigint;
}

export interface MultisigPayment {
  paymentId: string;
  merchantAddress: string;
  token: string;
  amount: bigint;
  requiredSignatures: number;
  signers: string[];
  signatures: Buffer[];
  signedBy: string[];
  executed: boolean;
  createdAt: bigint;
}

export enum SortField {
  Date = "Date",
  Amount = "Amount",
}

export enum SortOrder {
  Ascending = "Ascending",
  Descending = "Descending",
}

export enum StatusFilter {
  Any = "Any",
  Completed = "Completed",
  PartiallyRefunded = "PartiallyRefunded",
  FullyRefunded = "FullyRefunded",
}

export interface PaymentFilter {
  dateStart?: bigint;
  dateEnd?: bigint;
  amountMin?: bigint;
  amountMax?: bigint;
  token?: string;
  status: StatusFilter;
  tag?: string;
}

export interface PaymentPage {
  payments: PaymentOrder[];
  nextCursor?: string;
  total: number;
}

export interface GlobalStats {
  totalPayments: number;
  totalVolume: bigint;
  totalRefunds: number;
  totalRefundVolume: bigint;
  activeMerchants: number;
}

export enum SuspiciousActivityReason {
  LargePayment = 1,
  RapidRefunds = 2,
  ManyAuthFailures = 3,
}

export interface SubscriptionPlan {
  planId: string;
  merchant: string;
  token: string;
  amount: bigint;
  intervalSecs: bigint;
  maxCycles: number;
}

export enum SubscriptionStatus {
  Active = "Active",
  Cancelled = "Cancelled",
  Completed = "Completed",
}

export interface Subscription {
  subscriptionId: string;
  planId: string;
  subscriber: string;
  cyclesCharged: number;
  lastChargedAt: bigint;
  status: SubscriptionStatus;
  createdAt: bigint;
}

/**
 * Aggregated payer-facing payment history, returned by the contract's
 * `get_payer_payment_summary` entrypoint.  All values are computed from live
 * storage at query time.
 */
export interface PayerPaymentSummary {
  /** Sum of all amounts paid by the payer. */
  totalPaid: bigint;
  /** Sum of all amounts refunded to the payer. */
  totalRefunded: bigint;
  /** Sum of amounts still held in escrow / awaiting settlement. */
  totalPending: bigint;
  /** Number of payment orders associated with the payer. */
  paymentCount: number;
}

/**
 * Payload of the `EscrowExpiryWarningEvent` emitted by the contract when an
 * escrow's `unlock_at` is within the configured warning lead time.
 */
export interface EscrowExpiryWarningEvent {
  /** Identifier of the escrow record approaching expiry. */
  escrowId: string;
  /** Merchant that owns the escrow. */
  merchant: string;
  /** Payer that funded the escrow. */
  payer: string;
  /** Token held in escrow. */
  token: string;
  /** Amount held in escrow. */
  amount: bigint;
  /** Ledger timestamp at which the escrow auto-cancels. */
  unlockAt: bigint;
  /** Ledger timestamp at which the warning was emitted. */
  currentTime: bigint;
  /** Configured lead time (in seconds) that triggered the warning. */
  warningLeadTime: bigint;
}
