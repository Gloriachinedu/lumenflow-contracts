# LumenFlow Events Reference

This document provides a detailed reference for all events emitted by the LumenFlow smart contract. These events are essential for off-chain indexers and user interfaces to track the state of payments, refunds, and merchant registrations.

## Event Structure

All events in LumenFlow follow the Soroban event standard.
- **Contract ID**: The address of the deployed LumenFlow contract.
- **Topics**: The first topic is always the symbol `lumenflow`. The second topic is the event name (e.g., `payment_processed`). Payment and refund events also include the **merchant address as a third topic** so Horizon can filter by merchant without client-side scanning.
- **Data**: A single XDR-encoded value (can be a tuple, struct, or primitive).

---

## Filtering by Merchant Address

Payment and refund events expose the merchant address as **`topic[2]`** (zero-indexed). This allows you to subscribe to events for a specific merchant directly on the Horizon SSE stream or via Soroban RPC without downloading all platform events.

### Soroban RPC — filter by merchant

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
        "topics": [
          ["<base64-xdr-of-symbol-lumenflow>"],
          ["<base64-xdr-of-symbol-payment_processed>"],
          ["<base64-xdr-of-merchant-address>"]
        ]
      }
    ],
    "pagination": { "limit": 20 }
  }
}
```

To compute the XDR of a merchant address in JavaScript:

```javascript
import { xdr, Address } from '@stellar/stellar-sdk';

const merchantXdr = Address.fromString('G...MERCHANT_ADDR')
  .toScVal()
  .toXDR('base64');
```

### Horizon SSE — filter by merchant

```
GET https://horizon-testnet.stellar.org/contracts/{CONTRACT_ID}/events
    ?cursor=now
    &topic1=lumenflow
    &topic2=payment_processed
    &topic3=<merchant-address-xdr>
```

---

## Events List

### `admin_set`
Emitted when the contract administrator is successfully initialized.

| Field | Description |
|---|---|
| **Trigger** | One-time initialization via `set_admin`. |
| **Topics** | `["lumenflow", "admin_set"]` |
| **Data** | `admin: Address` |

**Data Details:**
- `admin`: The `Address` of the newly set administrator.

---

### `merchant_registered`
Emitted when a new merchant profile is created.

| Field | Description |
|---|---|
| **Trigger** | Successful call to `register_merchant`. |
| **Topics** | `["lumenflow", "merchant_registered"]` |
| **Data** | `merchant_address: Address` |

**Data Details:**
- `merchant_address`: The `Address` of the registered merchant.

---

### `payment_processed`
Emitted when a payment is successfully completed (via signature or batch).

The merchant address is emitted as **`topic[2]`** (filterable) so subscribers can efficiently receive only their own payment events.

| Field | Description |
|---|---|
| **Trigger** | Successful call to `process_payment_with_signature` or `batch_payment`. |
| **Topics** | `["lumenflow", "payment_processed", merchant_address: Address]` |
| **Data** | `(order_id: String, payer: Address, amount: i128)` |

**Topic Details:**
- `topic[0]`: `"lumenflow"` — contract namespace.
- `topic[1]`: `"payment_processed"` — event name.
- `topic[2]`: `merchant_address` — the merchant who received payment. **Filterable.**

**Data Details:**
- `order_id`: The unique identifier for the order.
- `payer`: The `Address` of the account that made the payment.
- `amount`: The amount paid (in the token's smallest unit).

---

### `suspicious_activity`
Emitted when a transaction exceeds defined safety thresholds (e.g., large payment).

| Field | Description |
|---|---|
| **Trigger** | Payment amount exceeds `LargePaymentThreshold`. |
| **Topics** | `["lumenflow", "suspicious_activity"]` |
| **Data** | `(reason: SuspiciousActivityReason, actor: Address, value: i128)` |

**Data Details:**
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
| **Data** | `order_id: String` |

---

### `payment_history_near_limit`
Emitted once when an account's payment-ID index (as a merchant or a payer) crosses 90% of `MAX_PAYMENT_IDS_PER_ACCOUNT` (9,000 of 10,000). Further payments continue to succeed until the hard cap (10,000) is reached, at which point they fail with `PaymentError::PaymentHistoryLimitExceeded` (code 71). This event fires only on the single payment that crosses the threshold — it does not repeat on subsequent payments. See [`docs/storage-schema.md`](./storage-schema.md#per-account-payment-id-cap-mppp) for the recommended mitigation.

The affected account's address is emitted as **`topic[2]`** so integrators can subscribe only to warnings relevant to their own merchant or payer address.

| Field | Description |
|---|---|
| **Trigger** | A call to `process_payment_with_signature`, `process_payment_with_nonce`, `batch_pay`, `execute_multisig_payment`, or `pay_payment_request` that pushes an account's `MP` or `PP` index count to 9,000 or above for the first time. |
| **Topics** | `["lumenflow", "payment_history_near_limit", account: Address]` |
| **Data** | `(current_count: u32, max_allowed: u32)` |

**Data Details:**
- `current_count`: The account's payment-ID count immediately after the triggering payment.
- `max_allowed`: `MAX_PAYMENT_IDS_PER_ACCOUNT` (10,000), included so subscribers don't need to hardcode the cap.

---

### `refund_initiated`
Emitted when a new refund request is opened.

The merchant address is emitted as **`topic[2]`** so merchants can subscribe only to refund events relevant to them.

| Field | Description |
|---|---|
| **Trigger** | Successful call to `initiate_refund`. |
| **Topics** | `["lumenflow", "refund_initiated", merchant_address: Address]` |
| **Data** | `(refund_id: String, order_id: String)` |

**Topic Details:**
- `topic[2]`: `merchant_address` — merchant associated with the payment. **Filterable.**

**Data Details:**
- `refund_id`: The unique refund identifier.
- `order_id`: The associated payment order identifier.

---

### `refund_approved`
Emitted when a refund request is approved by a merchant or admin.

| Field | Description |
|---|---|
| **Trigger** | Successful call to `approve_refund`. |
| **Topics** | `["lumenflow", "refund_approved", merchant_address: Address]` |
| **Data** | `(refund_id: String, order_id: String)` |

**Topic Details:**
- `topic[2]`: `merchant_address` — merchant associated with the payment. **Filterable.**

---

### `refund_rejected`
Emitted when a refund request is rejected.

| Field | Description |
|---|---|
| **Trigger** | Successful call to `reject_refund`. |
| **Topics** | `["lumenflow", "refund_rejected", merchant_address: Address]` |
| **Data** | `(refund_id: String, order_id: String)` |

**Topic Details:**
- `topic[2]`: `merchant_address` — merchant associated with the payment. **Filterable.**

---

### `refund_executed`
Emitted when an approved refund transfer is completed.

| Field | Description |
|---|---|
| **Trigger** | Successful call to `execute_refund`. |
| **Topics** | `["lumenflow", "refund_executed", merchant_address: Address]` |
| **Data** | `(refund_id: String, order_id: String)` |

**Topic Details:**
- `topic[2]`: `merchant_address` — merchant associated with the payment. **Filterable.**

---

### `contract_paused`
Emitted when the contract is paused.

When paused via `pause_with_reason`, the data includes the reason and timelock expiry timestamp.

| Field | Description |
|---|---|
| **Trigger** | Successful call to `pause_contract` or `pause_with_reason`. |
| **Topics** | `["lumenflow", "contract_paused"]` |
| **Data** | `()` (from `pause_contract`) or `(reason: String, lock_until: u64)` (from `pause_with_reason`) |

---

### `contract_unpaused`
Emitted when the contract is unpaused.

| Field | Description |
|---|---|
| **Trigger** | Successful call to `unpause_contract` or threshold reached in `approve_early_unpause`. |
| **Topics** | `["lumenflow", "contract_unpaused"]` |
| **Data** | `()` (admin unpause) or `("multisig_override",)` (guardian threshold reached) |

---

### `multisig_initiated`
Emitted when a multi-signature payment is created.

| Field | Description |
|---|---|
| **Trigger** | Successful call to `initiate_multisig_payment`. |
| **Topics** | `["lumenflow", "multisig_initiated"]` |
| **Data** | `payment_id: String` |

---

### `multisig_executed`
Emitted when a multi-signature payment is successfully executed.

| Field | Description |
|---|---|
| **Trigger** | Successful call to `execute_multisig_payment`. |
| **Topics** | `["lumenflow", "multisig_executed"]` |
| **Data** | `payment_id: String` |

---

### `payment_request_paid`
Emitted when a pre-generated payment request is paid by a user.

| Field | Description |
|---|---|
| **Trigger** | Successful call to `pay_payment_request`. |
| **Topics** | `["lumenflow", "payment_request_paid"]` |
| **Data** | `request_id: String` |

---

## Subscribing to Events

You can subscribe to LumenFlow events using any Stellar SDK or by querying Horizon/RPC directly.

### Via Stellar RPC (Recommended)
Soroban-RPC provides the `getEvents` method to query events within a ledger range.

**Example Request (JSON-RPC) — all `payment_processed` events:**
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
While Soroban-RPC is preferred for real-time Soroban events, Horizon also exposes them via the `/events` endpoint:

```
https://horizon-testnet.stellar.org/contracts/{CONTRACT_ID}/events?cursor=now&topic1=lumenflow
```

---

## Decoding XDR Payloads

Events data is returned as XDR. To decode it in JavaScript using `stellar-sdk`:

```javascript
import { xdr, scValToNative } from '@stellar/stellar-sdk';

// Example: Decoding payment_processed data
const rawData = "AAAAE... (base64 XDR)";
const scVal = xdr.ScVal.fromXDR(rawData, 'base64');
const nativeData = scValToNative(scVal);

// payment_processed data is now (order_id, payer, amount)
// The merchant address is in topic[2], not in the data
console.log(nativeData);
// Output: ["ORDER_123", "G...PAYER", 1000n]
```

For more information on Soroban events, visit the [Stellar Developers Documentation](https://developers.stellar.org/docs/build/smart-contracts/getting-started/events).

---

## SDK event catalog

The TypeScript SDK ships a machine-readable version of the table above as
`EVENT_CATALOG` (`@lumenflow/sdk`), together with `parseLumenFlowEvent(raw)`
which decodes a raw Horizon / RPC event into a named, keyed shape:

```ts
import { parseLumenFlowEvent } from '@lumenflow/sdk';

const parsed = parseLumenFlowEvent({
  topic: ['lumenflow', 'payment_processed', merchantXdr],
  value: ['ORDER_123', payerAddr, 1000n],
});
// { name: 'payment_processed', merchant: <merchantXdr>,
//   data: { order_id: 'ORDER_123', payer: <payerAddr>, amount: 1000n } }
```

`parseLumenFlowEvent` throws `EventCompatError` for events that aren't in the
catalog, have a malformed topic, or whose data tuple arity doesn't match — so an
unrecognised or changed contract event surfaces loudly instead of being
silently mis-decoded.

The catalog is kept in lock-step with the contract by
`sdk/src/tests/contractEventCompat.test.ts`, which diffs it against the actual
`env.events().publish(...)` calls in `contracts/lumenflow/src` on every run.
**If you add or change a contract event, update `EVENT_CATALOG` and this table.**
