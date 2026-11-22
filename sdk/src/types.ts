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
 * Merchant volume tier.
 *
 * Tiers are assigned based on the merchant's 30-day rolling payment volume
 * and grant progressively larger fee reductions.
 */
export enum MerchantTier {
  Standard = "Standard",
  Silver = "Silver",
  Gold = "Gold",
  Platinum = "Platinum",
}

/**
 * Fee reduction configuration for a single tier.
 *
 * `feeReductionBps` is expressed in basis points (0–10000), where 0 means the
 * full fee is charged and 10000 means the fee is waived entirely.
 */
export interface MerchantTierFeeConfig {
  tier: MerchantTier;
  /** Minimum 30-day rolling volume (in base token units) required for this tier. */
  minVolume: bigint;
  /** Fee reduction in basis points (0–10000). */
  feeReductionBps: number;
}

/** Full tier configuration, as managed by the admin. */
export interface MerchantTierConfig {
  tiers: MerchantTierFeeConfig[];
}

/**
 * Read-only tier information for a merchant.
 *
 * `nextTier` and `nextTierThreshold` are `undefined` when the merchant is
 * already at the highest tier.
 */
export interface MerchantTierInfo {
  merchant: string;
  tier: MerchantTier;
  /** 30-day rolling payment volume used for the tier calculation. */
  rollingVolume: bigint;
  /** Fee reduction in basis points currently applied to this merchant. */
  feeReductionBps: number;
  nextTier?: MerchantTier;
  /** Volume required to reach `nextTier`. */
  nextTierThreshold?: bigint;
}

/** A single itemised payment row in a settlement report. */
export interface SettlementLineItem {
  orderId: string;
  payer: string;
  token: string;
  amount: bigint;
  fee: bigint;
  net: bigint;
  paidAt: bigint;
  status: PaymentStatus;
}

/** Aggregated settlement report for a merchant over a date range. */
export interface SettlementSummary {
  merchant: string;
  dateStart: bigint;
  dateEnd: bigint;
  lineItems: SettlementLineItem[];
  totalAmount: bigint;
  totalFee: bigint;
  totalNet: bigint;
  paymentCount: number;
}
