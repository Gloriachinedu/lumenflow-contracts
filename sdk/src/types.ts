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

/**
 * Generic page shape used by paginated list endpoints.
 *
 * `nextCursor` is `null` when there are no further pages; consumers should
 * treat both `null` and `undefined` as "end of results".
 */
export interface PaginatedPage<T> {
  items: T[];
  nextCursor?: string | null;
  total: number;
}

export interface PaymentPage {
  payments: PaymentOrder[];
  nextCursor?: string | null;
  total: number;
}

/** Event types emitted by the smart contract that can be subscribed to. */
export type LumenFlowEventType =
  | "PaymentReceived"
  | "RefundInitiated"
  | "RefundCompleted"
  | "DisputeOpened"
  | "DisputeResolved"
  | "MerchantRegistered"
  | "SubscriptionCharged";

/** Map of event type to its decoded payload shape. */
export interface LumenFlowEventPayloadMap {
  PaymentReceived: PaymentSummary;
  RefundInitiated: RefundRecord;
  RefundCompleted: RefundRecord;
  DisputeOpened: DisputeRecord;
  DisputeResolved: DisputeRecord;
  MerchantRegistered: Merchant;
  SubscriptionCharged: Subscription;
}

/**
 * Typed event payload delivered to subscription handlers.
 *
 * `payload` is the decoded, strongly-typed event body (never raw XDR).
 */
export interface TypedEventPayload<T extends LumenFlowEventType> {
  type: T;
  payload: LumenFlowEventPayloadMap[T];
  ledger: number;
  txHash: string;
  timestamp: bigint;
}

/** Handler invoked for each event received by a subscription. */
export type EventHandler<T extends LumenFlowEventType> = (
  event: TypedEventPayload<T>,
) => void | Promise<void>;

/** Options controlling event subscription polling. */
export interface SubscribeOptions {
  /** Polling interval in milliseconds. Defaults to 5000 (5 s). */
  intervalMs?: number;
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
