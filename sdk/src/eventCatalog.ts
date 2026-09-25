/**
 * LumenFlow Event Catalog
 *
 * All events emitted by the LumenFlow smart contract. Each entry describes the
 * event name, the topics array, and the shape of the decoded payload.
 *
 * Events follow the Soroban convention:
 *   Topics: ["lumenflow", "<event_name>"]
 *   Data:   XDR-encoded payload (decoded shape described per event)
 */

/** All event names emitted by the LumenFlow contract. */
export type LumenFlowEventName =
  | "admin_set"
  | "merchant_registered"
  | "payment_processed"
  | "payment_archived"
  | "payment_note_added"
  | "refund_initiated"
  | "refund_approved"
  | "refund_rejected"
  | "refund_executed"
  | "refund_disputed"
  | "dispute_resolved"
  | "multisig_initiated"
  | "multisig_executed"
  | "payment_request_paid"
  | "suspicious_activity"
  | "subscription_charged"
  | "subscription_cancelled"
  | "merchant_verified"
  | "merchant_unverified"
  | "config_updated";

// ── Payload shapes ────────────────────────────────────────────────────────────

/** `lumenflow/admin_set` — emitted when the contract admin is initialized. */
export interface AdminSetPayload {
  admin: string; // Address
}

/** `lumenflow/merchant_registered` — emitted on new merchant registration. */
export interface MerchantRegisteredPayload {
  merchant_address: string; // Address
}

/** `lumenflow/payment_processed` — emitted on completed payment. */
export interface PaymentProcessedPayload {
  order_id: string;
  payer: string; // Address
  merchant: string; // Address
  amount: bigint; // i128
}

/** `lumenflow/payment_archived` — emitted when an admin removes a payment record. */
export interface PaymentArchivedPayload {
  order_id: string;
}

/** `lumenflow/payment_note_added` — emitted when a merchant adds a note to a payment. */
export interface PaymentNoteAddedPayload {
  order_id: string;
}

/** `lumenflow/refund_initiated` — emitted when a refund request is opened. */
export interface RefundInitiatedPayload {
  refund_id: string;
}

/** `lumenflow/refund_approved` — emitted when a refund is approved. */
export interface RefundApprovedPayload {
  refund_id: string;
}

/** `lumenflow/refund_rejected` — emitted when a refund is rejected. */
export interface RefundRejectedPayload {
  refund_id: string;
}

/** `lumenflow/refund_executed` — emitted when a refund transfer is completed. */
export interface RefundExecutedPayload {
  refund_id: string;
}

/** `lumenflow/refund_disputed` — emitted when a payer disputes a rejected refund. */
export interface RefundDisputedPayload {
  refund_id: string;
  payer: string; // Address
}

/** `lumenflow/dispute_resolved` — emitted when an admin resolves a dispute. */
export interface DisputeResolvedPayload {
  refund_id: string;
}

/** `lumenflow/multisig_initiated` — emitted when a multisig payment is created. */
export interface MultisigInitiatedPayload {
  payment_id: string;
}

/** `lumenflow/multisig_executed` — emitted when a multisig payment is executed. */
export interface MultisigExecutedPayload {
  payment_id: string;
}

/** `lumenflow/payment_request_paid` — emitted when a payment request is paid. */
export interface PaymentRequestPaidPayload {
  request_id: string;
}

/** Reason codes for the `suspicious_activity` event. */
export enum SuspiciousActivityReason {
  LargePayment = 1,
  RapidRefunds = 2,
  ManyAuthFailures = 3,
}

/** `lumenflow/suspicious_activity` — emitted when a safety threshold is exceeded. */
export interface SuspiciousActivityPayload {
  reason: SuspiciousActivityReason;
  actor: string; // Address
  value: bigint; // i128
}

/** `lumenflow/subscription_charged` — emitted when a subscription cycle is charged. */
export interface SubscriptionChargedPayload {
  subscription_id: string;
  cycles_charged: number; // u32
}

/** `lumenflow/subscription_cancelled` — emitted when a subscription is cancelled. */
export interface SubscriptionCancelledPayload {
  subscription_id: string;
}

/** `lumenflow/merchant_verified` — emitted when a merchant is verified by admin. */
export interface MerchantVerifiedPayload {
  merchant_address: string; // Address
}

/** `lumenflow/merchant_unverified` — emitted when merchant verification is revoked. */
export interface MerchantUnverifiedPayload {
  merchant_address: string; // Address
}

/**
 * `lumenflow/config_updated` — emitted when an admin changes a configurable parameter.
 *
 * Triggered by: `set_platform_fee`, `set_refund_window`, `set_min_refund_amount`,
 * `set_multisig_expiry_duration`.
 *
 * - `param`: one of `"platform_fee"` | `"refund_window"` | `"min_refund_amount"` | `"multisig_expiry_duration"`
 * - `old_value`: previous value (as i128)
 * - `new_value`: new value (as i128)
 * - `admin`: Address of the admin who made the change
 * - `timestamp`: ledger timestamp of the change
 */
export interface ConfigUpdatedPayload {
  param:
    | "platform_fee"
    | "refund_window"
    | "min_refund_amount"
    | "multisig_expiry_duration";
  old_value: bigint; // i128
  new_value: bigint; // i128
  admin: string; // Address
  timestamp: bigint; // u64
}

// ── Catalog ───────────────────────────────────────────────────────────────────

/**
 * A typed map of all LumenFlow events. Useful for building event handlers
 * and ensuring compile-time exhaustiveness.
 *
 * @example
 * ```ts
 * import { EventCatalog } from './eventCatalog';
 *
 * function handleConfigUpdated(payload: EventCatalog["config_updated"]) {
 *   console.log(`${payload.param} changed from ${payload.old_value} to ${payload.new_value}`);
 * }
 * ```
 */
export interface EventCatalog {
  admin_set: AdminSetPayload;
  merchant_registered: MerchantRegisteredPayload;
  payment_processed: PaymentProcessedPayload;
  payment_archived: PaymentArchivedPayload;
  payment_note_added: PaymentNoteAddedPayload;
  refund_initiated: RefundInitiatedPayload;
  refund_approved: RefundApprovedPayload;
  refund_rejected: RefundRejectedPayload;
  refund_executed: RefundExecutedPayload;
  refund_disputed: RefundDisputedPayload;
  dispute_resolved: DisputeResolvedPayload;
  multisig_initiated: MultisigInitiatedPayload;
  multisig_executed: MultisigExecutedPayload;
  payment_request_paid: PaymentRequestPaidPayload;
  suspicious_activity: SuspiciousActivityPayload;
  subscription_charged: SubscriptionChargedPayload;
  subscription_cancelled: SubscriptionCancelledPayload;
  merchant_verified: MerchantVerifiedPayload;
  merchant_unverified: MerchantUnverifiedPayload;
  config_updated: ConfigUpdatedPayload;
}

/**
 * All valid LumenFlow event topic pairs as `[namespace, event_name]`.
 *
 * Use this to filter Soroban events from the RPC `getEvents` endpoint.
 */
export const EVENT_TOPICS: Record<LumenFlowEventName, [string, string]> =
  Object.fromEntries(
    (Object.keys({} as EventCatalog) as LumenFlowEventName[]).map((name) => [
      name,
      ["lumenflow", name],
    ])
  ) as Record<LumenFlowEventName, [string, string]>;
