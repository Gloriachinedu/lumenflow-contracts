/**
 * @file events.ts
 *
 * Canonical TypeScript types for every LumenFlow contract event payload.
 *
 * Each interface mirrors the `#[contracttype]` struct published as the *data*
 * field of the corresponding Soroban event.  Field names and types are kept in
 * 1-to-1 correspondence with the Rust definitions in `contracts/lumenflow/src/types.rs`
 * so that generated bindings (e.g. `stellar contract bindings typescript`) can
 * be validated against these interfaces at build time.
 *
 * Topic tuple for all events: `["lumenflow", "<event_name>"]`
 */

// ---------------------------------------------------------------------------
// Shared value types (mirrors Soroban XDR scalar types used in events)
// ---------------------------------------------------------------------------

/** Stellar account or contract address encoded as a string (StrKey). */
export type StellarAddress = string;

/** i128 value represented as a JavaScript bigint (Soroban i128 → JS BigInt). */
export type I128 = bigint;

// ---------------------------------------------------------------------------
// Payment status (mirrors PaymentStatus enum in types.rs)
// ---------------------------------------------------------------------------

export enum PaymentStatus {
  Completed = "Completed",
  PartiallyRefunded = "PartiallyRefunded",
  FullyRefunded = "FullyRefunded",
}

// ---------------------------------------------------------------------------
// Event payload interfaces
// ---------------------------------------------------------------------------

/**
 * `lumenflow/payment_processed`
 *
 * Emitted by:
 *   - `process_payment_with_signature`
 *   - `process_payment_with_nonce`
 *   - individual items in `batch_payment`
 */
export interface PaymentProcessedEvent {
  /** Unique order identifier. */
  order_id: string;
  /** Wallet address of the payer. */
  payer: StellarAddress;
  /** Registered merchant address. */
  merchant: StellarAddress;
  /** Token amount transferred (in the token's base unit). */
  amount: I128;
}

/**
 * `lumenflow/refund_initiated`
 *
 * Emitted by `initiate_refund`.
 */
export interface RefundInitiatedEvent {
  refund_id: string;
  order_id: string;
  /** Address that opened the refund request (payer or merchant). */
  initiator: StellarAddress;
  amount: I128;
}

/**
 * `lumenflow/refund_approved`
 *
 * Emitted by `approve_refund`.
 */
export interface RefundApprovedEvent {
  refund_id: string;
  order_id: string;
  /** Merchant address whose approval authorised the refund. */
  merchant: StellarAddress;
  amount: I128;
}

/**
 * `lumenflow/refund_rejected`
 *
 * Emitted by `reject_refund`.
 */
export interface RefundRejectedEvent {
  refund_id: string;
  order_id: string;
  merchant: StellarAddress;
  amount: I128;
}

/**
 * `lumenflow/refund_executed`
 *
 * Emitted by `execute_refund` after the token transfer completes.
 */
export interface RefundExecutedEvent {
  refund_id: string;
  order_id: string;
  payer: StellarAddress;
  merchant: StellarAddress;
  amount: I128;
  /** SAC/token contract address used for the refund transfer. */
  token: StellarAddress;
}

/**
 * `lumenflow/multisig_initiated`
 *
 * Emitted by `initiate_multisig_payment`.
 */
export interface MultisigInitiatedEvent {
  payment_id: string;
  merchant: StellarAddress;
  token: StellarAddress;
  amount: I128;
  required_signatures: number;
}

/**
 * `lumenflow/multisig_executed`
 *
 * Emitted by `execute_multisig_payment` after the threshold is met and
 * tokens are transferred.
 */
export interface MultisigExecutedEvent {
  payment_id: string;
  payer: StellarAddress;
  merchant: StellarAddress;
  token: StellarAddress;
  amount: I128;
}

/**
 * `lumenflow/payment_request_paid`
 *
 * Emitted by `pay_payment_request`.
 */
export interface PaymentRequestPaidEvent {
  request_id: string;
  payer: StellarAddress;
  merchant: StellarAddress;
  token: StellarAddress;
  amount: I128;
}

/**
 * `lumenflow/payment_status_updated`
 *
 * Emitted by `update_payment_status`.
 */
export interface PaymentStatusUpdatedEvent {
  order_id: string;
  status: PaymentStatus;
  refunded_amount: I128;
  original_amount: I128;
}

// ---------------------------------------------------------------------------
// Discriminated union for type-safe event handling
// ---------------------------------------------------------------------------

export type LumenFlowEvent =
  | { name: "payment_processed";       data: PaymentProcessedEvent }
  | { name: "refund_initiated";        data: RefundInitiatedEvent }
  | { name: "refund_approved";         data: RefundApprovedEvent }
  | { name: "refund_rejected";         data: RefundRejectedEvent }
  | { name: "refund_executed";         data: RefundExecutedEvent }
  | { name: "multisig_initiated";      data: MultisigInitiatedEvent }
  | { name: "multisig_executed";       data: MultisigExecutedEvent }
  | { name: "payment_request_paid";    data: PaymentRequestPaidEvent }
  | { name: "payment_status_updated";  data: PaymentStatusUpdatedEvent };

// ---------------------------------------------------------------------------
// Schema validation helpers
// ---------------------------------------------------------------------------

/**
 * Validates that a raw decoded event object has all required fields for the
 * given event name.  Throws a descriptive `Error` if the schema does not match.
 *
 * This is intended for use in indexers, webhook processors, and integration
 * tests where raw XDR-decoded data is deserialized before further processing.
 *
 * @param name  The second element of the event topic tuple, e.g. "refund_executed".
 * @param data  The decoded data object from the Soroban event stream.
 * @returns The validated (narrowed) event payload.
 */
export function validateEventPayload(name: string, data: unknown): LumenFlowEvent {
  switch (name) {
    case "payment_processed":
      assertFields(name, data, ["order_id", "payer", "merchant", "amount"]);
      return { name, data: data as PaymentProcessedEvent };

    case "refund_initiated":
      assertFields(name, data, ["refund_id", "order_id", "initiator", "amount"]);
      return { name, data: data as RefundInitiatedEvent };

    case "refund_approved":
      assertFields(name, data, ["refund_id", "order_id", "merchant", "amount"]);
      return { name, data: data as RefundApprovedEvent };

    case "refund_rejected":
      assertFields(name, data, ["refund_id", "order_id", "merchant", "amount"]);
      return { name, data: data as RefundRejectedEvent };

    case "refund_executed":
      assertFields(name, data, ["refund_id", "order_id", "payer", "merchant", "amount", "token"]);
      return { name, data: data as RefundExecutedEvent };

    case "multisig_initiated":
      assertFields(name, data, ["payment_id", "merchant", "token", "amount", "required_signatures"]);
      return { name, data: data as MultisigInitiatedEvent };

    case "multisig_executed":
      assertFields(name, data, ["payment_id", "payer", "merchant", "token", "amount"]);
      return { name, data: data as MultisigExecutedEvent };

    case "payment_request_paid":
      assertFields(name, data, ["request_id", "payer", "merchant", "token", "amount"]);
      return { name, data: data as PaymentRequestPaidEvent };

    case "payment_status_updated":
      assertFields(name, data, ["order_id", "status", "refunded_amount", "original_amount"]);
      return { name, data: data as PaymentStatusUpdatedEvent };

    default:
      throw new Error(`validateEventPayload: unknown event name "${name}"`);
  }
}

/** Asserts that every required field key is present and non-null in `obj`. */
function assertFields(eventName: string, obj: unknown, fields: string[]): void {
  if (typeof obj !== "object" || obj === null) {
    throw new Error(`Event "${eventName}": expected an object payload, got ${typeof obj}`);
  }
  const record = obj as Record<string, unknown>;
  for (const field of fields) {
    if (!(field in record) || record[field] === undefined || record[field] === null) {
      throw new Error(
        `Event "${eventName}": required field "${field}" is missing or null`
      );
    }
  }
}
