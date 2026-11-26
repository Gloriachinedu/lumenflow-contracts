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
  /**
   * Optional maximum payment amount enforced during `process_payment`.
   * Maps the Rust `Option<i128>`; `null`/`undefined` means no limit.
   */
  maxPaymentAmount?: bigint | null;
}

/**
 * Arguments for the `set_merchant_payment_limit` admin entrypoint.
 * `limit` of `null` clears the limit (no maximum).
 */
export interface SetMerchantPaymentLimitArgs {
  merchant: string;
  limit: bigint | null;
}

/**
 * Merchant profile as stored by the smart contract.
 *
 * `refundWindowSecs` is the merchant-specific refund window in seconds.
 * When omitted (or `undefined`), the contract falls back to the global
 * default refund window.  Mirrors the Rust `MerchantProfile` struct.
 */
export interface MerchantProfile {
  address: string;
  name: string;
  description: string;
  contactInfo: string;
  category: MerchantCategory;
  active: boolean;
  verified: boolean;
  registeredAt: bigint;
  totalReceived: bigint;
  refundWindowSecs?: bigint;
}

/**
 * Arguments for the `set_refund_window` contract entrypoint.
 *
 * Callable by the merchant to configure their own refund period.
 * `refundWindowSecs` must be a non-negative number of seconds.
 */
export interface SetRefundWindowArgs {
  merchant: string;
  refundWindowSecs: bigint;
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

/**
 * Protocol fee configuration.
 *
 * `bps` is expressed in basis points (1 bps = 0.01%).  A value of `0`
 * disables the fee module entirely, meaning no extra token transfer occurs.
 */
export interface FeeConfig {
  /** Address that receives the deducted protocol fee. */
  recipient: string;
  /** Fee in basis points (0–10000). `0` disables the fee module. */
  bps: number;
}

/**
 * Parameters for a cross-asset payment.
 *
 * The payer sends `sendAsset` (up to `sendMax`) and the merchant receives
 * `destAsset` via a Stellar DEX path payment.  `path` lists intermediate
 * assets used for conversion; pass an empty array for a direct conversion.
 */
export interface CrossAssetPaymentParams {
  /** Asset the payer sends (e.g. "native" or "CODE:ISSUER"). */
  sendAsset: string;
  /** Maximum amount of `sendAsset` the payer is willing to spend. */
  sendMax: bigint;
  /** Asset the merchant receives. */
  destAsset: string;
  /** Intermediate assets used for the conversion path. */
  path: string[];
  /** Minimum amount of `destAsset` the merchant must receive (slippage guard). */
  minReceive: bigint;
}

/** Event emitted after a successful cross-asset payment conversion. */
export interface CrossAssetPaymentEvent {
  orderId: string;
  merchantAddress: string;
  payer: string;
  sendAsset: string;
  sendAmount: bigint;
  destAsset: string;
  destAmount: bigint;
  /** Exchange rate used, expressed as destAmount / sendAmount. */
  exchangeRate: number;
  path: string[];
  timestamp: bigint;
}
