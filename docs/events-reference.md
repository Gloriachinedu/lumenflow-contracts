# LumenFlow Events Reference

This document provides a detailed reference for all events emitted by the LumenFlow smart contract. These events are essential for off-chain indexers and user interfaces to track the state of payments, refunds, and merchant registrations.

## Event Structure

All events in LumenFlow follow the Soroban event standard.
- **Contract ID**: The address of the deployed LumenFlow contract.
- **Topics**: The first topic is always the symbol `lumenflow`. The second topic is the event name (e.g., `payment_processed`).
- **Data**: A single XDR-encoded value (can be a tuple, struct, or primitive).

---

## Events List

### `admin_set`
Emitted when the contract administrator is successfully initialized.

| Field | Description |
|---|---|
| **Trigger** | One-time initialization via `set_admin`. |
| **Topics** | `["lumenflow", "admin_set"]` |
| **Payload** | `admin: Address` |

**Payload Details:**
- `admin`: The `Address` of the newly set administrator.

---

### `merchant_registered`
Emitted when a new merchant profile is created.

| Field | Description |
|---|---|
| **Trigger** | Successful call to `register_merchant`. |
| **Topics** | `["lumenflow", "merchant_registered"]` |
| **Payload** | `merchant_address: Address` |

**Payload Details:**
- `merchant_address`: The `Address` of the registered merchant.

---

### `payment_processed`
Emitted when a payment is successfully completed (via signature or batch).

| Field | Description |
|---|---|
| **Trigger** | Successful call to `process_payment_with_signature` or `batch_payment`. |
| **Topics** | `["lumenflow", "payment_processed"]` |
| **Payload** | `(order_id: String, payer: Address, merchant: Address, amount: i128)` |

**Payload Details:**
- `order_id`: The unique identifier for the order.
- `payer`: The `Address` of the account that made the payment.
- `merchant`: The `Address` of the merchant who received the payment.
- `amount`: The amount paid (in the token's smallest unit).

---

### `suspicious_activity`
Emitted when a transaction exceeds defined safety thresholds (e.g., large payment).

| Field | Description |
|---|---|
| **Trigger** | Payment amount exceeds `LargePaymentThreshold`. |
| **Topics** | `["lumenflow", "suspicious_activity"]` |
| **Payload** | `(reason: SuspiciousActivityReason, actor: Address, value: i128)` |

**Payload Details:**
- `reason`: An enum indicating why the activity was flagged.
    - `LargePayment` (1)
    - `RapidRefunds` (2)
    - `ManyAuthFailures` (3)
- `actor`: The `Address` associated with the activity (usually the payer).
- `value`: The numerical value related to the trigger (e.g., the large amount).

---

### `payment_archived`
Emitted when a payment record is manually removed from contract storage by an admin.

| Field | Description |
|---|---|
| **Trigger** | Successful call to `archive_payment_record`. |
| **Topics** | `["lumenflow", "payment_archived"]` |
| **Payload** | `order_id: String` |

---

### `refund_initiated`
Emitted when a new refund request is opened.

| Field | Description |
|---|---|
| **Trigger** | Successful call to `initiate_refund`. |
| **Topics** | `["lumenflow", "refund_initiated"]` |
| **Payload** | `refund_id: String` |

---

### `refund_approved`
Emitted when a refund request is approved by a merchant or admin.

| Field | Description |
|---|---|
| **Trigger** | Successful call to `approve_refund`. |
| **Topics** | `["lumenflow", "refund_approved"]` |
| **Payload** | `refund_id: String` |

---

### `refund_rejected`
Emitted when a refund request is rejected.

| Field | Description |
|---|---|
| **Trigger** | Successful call to `reject_refund`. |
| **Topics** | `["lumenflow", "refund_rejected"]` |
| **Payload** | `refund_id: String` |

---

### `refund_executed`
Emitted when an approved refund transfer is completed.

| Field | Description |
|---|---|
| **Trigger** | Successful call to `execute_refund`. |
| **Topics** | `["lumenflow", "refund_executed"]` |
| **Payload** | `refund_id: String` |

---

### `multisig_initiated`
Emitted when a multi-signature payment is created.

| Field | Description |
|---|---|
| **Trigger** | Successful call to `initiate_multisig_payment`. |
| **Topics** | `["lumenflow", "multisig_initiated"]` |
| **Payload** | `payment_id: String` |

---

### `multisig_executed`
Emitted when a multi-signature payment is successfully executed.

| Field | Description |
|---|---|
| **Trigger** | Successful call to `execute_multisig_payment`. |
| **Topics** | `["lumenflow", "multisig_executed"]` |
| **Payload** | `payment_id: String` |

---

### `payment_request_paid`
Emitted when a pre-generated payment request is paid by a user.

| Field | Description |
|---|---|
| **Trigger** | Successful call to `pay_payment_request`. |
| **Topics** | `["lumenflow", "payment_request_paid"]` |
| **Payload** | `request_id: String` |

---

## Subscribing to Events

You can subscribe to LumenFlow events using any Stellar SDK or by querying Horizon/RPC directly.

### Via Stellar RPC (Recommended)
Soroban-RPC provides the `getEvents` method to query events within a ledger range.

**Example Request (JSON-RPC):**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getEvents",
  "params": {
    "startLedger": 123456,
    "filters": [
      {
        "type": "contract",
        "contractIds": ["C...CONTRACT_ID"],
        "topics": [["AAAABAAAABlsdW1lbmZsb3cAAAA="]] 
      }
    ],
    "pagination": { "limit": 10 }
  }
}
```
*Note: `AAAABAAAABlsdW1lbmZsb3cAAAA=` is the base64 XDR for the symbol `lumenflow`.*

### Via Horizon
While Soroban-RPC is preferred for real-time Soroban events, Horizon also exposes them via the `/events` endpoint if the ingestion is configured.

---

## Decoding XDR Payloads

Events data is returned as XDR. To decode it in JavaScript using `stellar-sdk`:

```javascript
import { xdr, scValToNative } from '@stellar/stellar-sdk';

// Example: Decoding payment_processed data
const rawData = "AAAAE... (base64 XDR)";
const scVal = xdr.ScVal.fromXDR(rawData, 'base64');
const nativeData = scValToNative(scVal);

console.log(nativeData); 
// Output: ["ORDER_123", "G...PAYER", "G...MERCHANT", 1000n]
```

For more information on Soroban events, visit the [Stellar Developers Documentation](https://developers.stellar.org/docs/build/smart-contracts/getting-started/events).

