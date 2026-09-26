# Batch Payments

Complete reference for the `batch_payment` contract function: limits, atomicity
guarantees, partial-failure semantics, signature format, error catalogue, rate
limiting, and boundary cases.

> **See also:** [`docs/signature-format.md`](signature-format.md) for the
> single-payment signature specification, [`docs/errors.md`](errors.md) for the
> full error code reference, and [`docs/api-rate-limits.md`](api-rate-limits.md)
> for the per-merchant rate limit reference.

---

## Table of Contents

1. [Function Signature](#1-function-signature)
2. [BatchPaymentItem Fields](#2-batchpaymentitem-fields)
3. [Hard Limits](#3-hard-limits)
4. [Execution Phases](#4-execution-phases)
5. [Atomicity Guarantee](#5-atomicity-guarantee)
6. [Partial Failure Semantics](#6-partial-failure-semantics)
7. [Signature Format (batch vs. single payment)](#7-signature-format-batch-vs-single-payment)
8. [Platform Fee Behaviour](#8-platform-fee-behaviour)
9. [Rate Limiting in Batch Context](#9-rate-limiting-in-batch-context)
10. [Transfer Grouping](#10-transfer-grouping)
11. [Payment History Limit](#11-payment-history-limit)
12. [Error Catalogue](#12-error-catalogue)
13. [Boundary and Edge Cases](#13-boundary-and-edge-cases)
14. [Idempotent Re-submission](#14-idempotent-re-submission)
15. [CLI Usage](#15-cli-usage)

---

## 1. Function Signature

```rust
pub fn batch_payment(
    env: Env,
    payer: Address,
    payments: Vec<BatchPaymentItem>,
) -> Result<(), PaymentError>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `payer` | `Address` | Address that funds all payments. Must sign the transaction. |
| `payments` | `Vec<BatchPaymentItem>` | 1–10 payment items. See section 2 for fields. |

Returns `Ok(())` on success. Any error reverts the **entire** batch.

---

## 2. BatchPaymentItem Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `order_id` | `String` | ✅ | Globally unique payment identifier. Non-empty, max 64 chars. Must not already exist on-chain. Must be unique within the batch. |
| `merchant_address` | `Address` | ✅ | Registered, active merchant receiving the funds. |
| `token_address` | `Address` | ✅ | SAC token contract address. Must be on the admin-configured allow-list. |
| `amount` | `i128` | ✅ | Transfer amount in the token's smallest unit. Must be > 0. |
| `memo` | `String` | ✅ | Human-readable description. May be empty; max 256 chars. |
| `tags` | `Option<Vec<String>>` | ✅* | Optional classification tags. Pass `null` if not needed. |
| `signature` | `Bytes` | ✅ | 64-byte ed25519 signature. See section 7 for payload format. |
| `merchant_public_key` | `Bytes` | ✅ | 32-byte ed25519 public key of the merchant. |

> *`tags` is optional. When provided: max 5 tags per item, each 1–32 characters.
> See [`Tags validation`](#tags-field) below.

### Tags field

Tags mirror the same field on `process_payment_with_signature` and are written
to the resulting `PaymentOrder` record.

**Rules (enforced by `validate_tags`):**

- Maximum **5 tags** per batch item.
- Each tag must be **1–32 characters** (non-empty, not exceeding 32).
- An invalid tag in **any** item causes the **entire batch to fail** with
  `InvalidTags` (53).

Tags provided on each `BatchPaymentItem` are stored in the corresponding
`PaymentOrder.tags` field and can be queried via `get_payment_by_id` or
filtered using `get_merchant_payment_history`.

---

## 3. Hard Limits

| Limit | Value | Configurable |
|-------|-------|-------------|
| Maximum items per `batch_payment` call | **10** | No (compile-time constant) |
| Maximum `order_id` length | 64 chars | No |
| Maximum `memo` length | 256 chars | No |
| Maximum tags per item | 5 | No |
| Maximum tag length | 32 chars | No |

Submitting more than 10 items returns `BatchSizeExceeded` (52) **before any
validation of individual items** — the check is the first operation in
`batch_payment`.

The **minimum** is 1 item. An empty `payments` vector is accepted by the
contract but produces no transfers and no events (it returns `Ok(())`).

---

## 4. Execution Phases

`batch_payment` executes in five strictly-ordered phases:

```
Phase 1 ─ Validate ALL items
           │  (any failure → entire batch reverted, no state written)
           │  - batch size ≤ 10
           │  - per item: amount > 0, valid order_id, valid tags
           │  - intra-batch duplicate order_id detection
           │  - token_address on allow-list
           │  - order_id not already on-chain
           │  - merchant registered and active
           │  - rate-limit counter checked AND incremented per merchant
           │  - ed25519 signature verified against batch payload
           ▼
Phase 2 ─ Group amounts by (token_address, merchant_address)
           │  Multiple items with the same token+merchant are summed
           │  into a single transfer group
           ▼
Phase 3 ─ Execute token.transfer calls (one per unique group)
           │  Payer → merchant for grouped_total
           │  (if any transfer fails, the whole tx reverts)
           ▼
Phase 4 ─ Store PaymentOrder records and update stats (one per item)
           │  - PaymentOrder written with status=Completed, platform_fee=0
           │  - merchant and payer payment indexes updated
           │  - per-merchant and global stats incremented
           ▼
Phase 5 ─ Emit payment_processed events (one per item)
```

This ordering is the core of the atomicity guarantee: **no state is mutated
until all validation has passed** (Phase 1 → Phase 2). If Phase 3 fails (e.g.,
insufficient payer balance), the Soroban transaction reverts entirely.

---

## 5. Atomicity Guarantee

`batch_payment` is **fully atomic at the contract level**:

- Either **all** items succeed and are recorded, or **none** are.
- There is no partial-success mode within a single `batch_payment` invocation.
- If validation fails for item N, items 1 through N-1 are also rolled back — no
  payment records are written, no token transfers occur, and no events are emitted.
- The rate-limit counters incremented during Phase 1 are **also** reverted if the
  transaction fails, because Soroban reverts all storage writes on error.

### What "atomic" means concretely

| Scenario | Result |
|----------|--------|
| All 10 items valid | All 10 `PaymentOrder` records written; all 10 `payment_processed` events emitted |
| Item 7 of 10 has invalid signature | Zero records written; zero transfers; zero events |
| Item 10 of 10 has a duplicate `order_id` | Same as above — nothing committed |
| Token transfer in Phase 3 fails (insufficient balance) | Soroban reverts all Phase 3–4 writes; net state unchanged |

### Tested atomicity

The atomicity guarantee is covered by `test_batch_payment_atomic_failure` in
`contracts/lumenflow/src/test.rs`: a 2-item batch where item 1 is valid and
item 2 has `amount = -1` returns `InvalidAmount` and leaves zero payment records.

---

## 6. Partial Failure Semantics

`batch_payment` has **no partial failure mode** at the contract level. The
function either succeeds completely or fails completely.

This is by design: Soroban's execution model applies the
checks-effects-interactions pattern across the entire batch, and all state
changes are staged in a single transaction. There is no way to commit some
items and revert others within one invocation.

### Why not partial success?

- **Consistency:** A payer submitting 10 orders expects either all or none to be
  recorded. Partial commits would require the payer to determine which items
  succeeded and resubmit the rest — introducing reconciliation complexity.
- **Atomicity vs. fee cost:** The 10-item limit is sized to keep the transaction
  within Soroban's instruction budget. A full-batch failure is cheaper to retry
  than partial-state recovery.
- **Duplicate protection:** `order_id` uniqueness is enforced across all
  invocations. If any item in a failed batch is re-submitted, the previously
  committed items would need different `order_id` values — which the retry
  guidance in section 14 explains.

### CLI `batch-pay` command — different semantics

The CLI `lumenflow batch-pay` command does **not** use the `batch_payment`
contract function. It iterates the CSV rows and calls
`process_payment_with_signature` **once per row** as separate transactions.

This means:
- Each row succeeds or fails independently.
- A failure on row 3 does not roll back rows 1–2.
- The CLI prints a results table and reports `N/M payment(s) succeeded`.

Use `lumenflow batch-pay` when you need per-row partial success. Use the
contract's `batch_payment` directly when you need all-or-nothing atomicity.

---

## 7. Signature Format (batch vs. single payment)

### Differences from `process_payment_with_signature`

| Field | `batch_payment` | `process_payment_with_signature` |
|-------|----------------|----------------------------------|
| Nonce in payload | ❌ No nonce | ✅ `nonce_u64_be (8 bytes)` |
| Replay protection | `order_id` uniqueness only | nonce + `order_id` uniqueness |
| Merchant nonce incremented | ❌ Not incremented | ✅ Incremented on success |

### Batch signature payload

Each item's `signature` must cover:

```
network_id (32 bytes)
|| contract_address XDR (variable)
|| order_id XDR (variable)
|| amount i128 big-endian (16 bytes)
```

There is **no nonce** in the batch payload. Replay protection relies entirely
on `order_id` uniqueness — the contract rejects any `order_id` that already
exists on-chain, including intra-batch duplicates.

### Generating a batch item signature (Node.js)

```javascript
import { hash } from "@stellar/stellar-sdk";
import { sign } from "@noble/ed25519";

function buildBatchPayload(networkId, contractAddress, orderId, amount) {
  // network_id: 32 bytes
  const netIdBytes = Buffer.from(networkId, "hex");

  // contract_address: XDR-encoded
  const contractXdr = contractAddress.toXDR();

  // order_id: XDR-encoded Soroban String
  const orderIdXdr = xdrString(orderId);

  // amount: i128 big-endian 16 bytes
  const amountBuf = Buffer.allocUnsafe(16);
  writeBigInt128BE(amountBuf, BigInt(amount));

  return Buffer.concat([netIdBytes, contractXdr, orderIdXdr, amountBuf]);
}

const payload = buildBatchPayload(networkId, contractAddress, "ORDER_001", 1000);
const signature = await sign(payload, merchantPrivateKey); // 64 bytes
```

See [`docs/signature-format.md`](signature-format.md) for the full payload
specification and multi-language examples.

---

## 8. Platform Fee Behaviour

`batch_payment` **does not apply a platform fee**. All items are stored with
`platform_fee = 0` regardless of the admin-configured fee rate.

The full payment amount is transferred to the merchant without deduction:

```rust
// Phase 3 transfer — no fee deduction
token_client.transfer(&payer, &merch, &grouped_total);
```

To apply a platform fee to each payment, use `process_payment_with_signature`
instead. If your integration requires fee collection on batch payments, route
each item through `process_payment_with_signature` (which the CLI `batch-pay`
command does via separate invocations).

---

## 9. Rate Limiting in Batch Context

The per-merchant payment rate limit is enforced **per item** during Phase 1
validation.

### How it works

- The rate limit is a rolling-window counter: max payments per merchant per
  300-ledger window (~25 minutes at 5 s/ledger). Default: 100 payments/window.
- For each item in the batch, the contract reads the merchant's current counter
  and rejects the item with `RateLimitExceeded` (90) if the limit is reached.
- The counter is **incremented** for each item that passes the check, within
  Phase 1 itself.
- Because Phase 1 processes items in order, a batch can be partially blocked:
  the first N items for a merchant may pass and the (N+1)th item for that
  merchant will fail — rejecting the **entire batch** atomically.

### Example

```
rate_limit = 100 (default)
merchant M1 has used 99 payments in the current window

batch: [item 1: M1, item 2: M1, item 3: M2]

Phase 1:
  item 1 (M1): counter = 99 < 100 → pass; counter incremented to 100
  item 2 (M1): counter = 100 >= 100 → RateLimitExceeded → entire batch fails
```

Neither item 1, item 2, nor item 3 are committed. The counter increment for
item 1 is also reverted (storage writes roll back on transaction failure).

### Checking remaining capacity

Before submitting a large batch, query the merchant's current window usage:

```bash
# No direct "remaining capacity" query exists — monitor via events or off-chain
# tracking of successful payment counts per window (~300 ledgers, ~25 minutes)
```

Admin can adjust the rate limit:

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY \
  --network $NETWORK \
  -- set_rate_limit --admin $ADMIN_ADDR --limit 200
```

---

## 10. Transfer Grouping

When multiple items share the same `(token_address, merchant_address)` pair,
their amounts are summed and only **one `token.transfer` call** is made for
that group. This reduces cross-contract call overhead.

### Phase 2 grouping logic

```
items: [
  {token: USDC, merchant: M1, amount: 500},
  {token: USDC, merchant: M1, amount: 300},  ← same pair
  {token: USDC, merchant: M2, amount: 200},
  {token: XLM,  merchant: M1, amount: 1000},
]

groups: [
  (USDC, M1, 800),   ← 500 + 300
  (USDC, M2, 200),
  (XLM,  M1, 1000),
]

Phase 3: 3 token.transfer calls instead of 4
```

### Individual records are preserved

Despite grouped transfers, **each item produces its own `PaymentOrder` record**
with its original `order_id` and `amount`. The grouping only affects the number
of token transfer calls; it does not change how payments are stored, indexed, or
visible in history queries.

---

## 11. Payment History Limit

Each account (as a merchant or payer) can hold at most **10,000** payment ID
references in its index. When this limit is reached:

- `add_merchant_payment_id` or `add_payer_payment_id` returns
  `PaymentHistoryLimitExceeded` (71).
- The **entire batch** fails atomically because this error is returned from
  Phase 4.

### Warning threshold

At 90% of the limit (9,000 entries), the contract emits a
`lumenflow/payment_history_near_limit` event. Monitor this event to act before
the hard cap is reached.

### Checking current usage

```bash
lumenflow account-status --address <address>
# or:
stellar contract invoke --id $CONTRACT_ID --source-account $CALLER_KEY \
  --network $NETWORK \
  -- get_account_payment_count --address <address>
```

### Remediation

Use `cleanup_expired_payments` (admin) or `archive_payment_record` (admin) to
remove old records from the index, freeing space for new payments.

---

## 12. Error Catalogue

All errors are variants of `PaymentError`. A single error from any item causes
the **entire batch to fail** with no partial state written.

### Errors checked before any state change (Phase 1)

| Code | Name | Trigger condition | Remediation |
|------|------|-------------------|-------------|
| 52 | `BatchSizeExceeded` | `payments.len() > 10` | Split the batch into groups of ≤ 10 items. |
| 22 | `InvalidAmount` | Any item has `amount ≤ 0` | Ensure all amounts are positive integers. |
| 50 | `InvalidInput` | Any `order_id` is empty or > 64 chars | Use non-empty IDs within the length limit. |
| 53 | `InvalidTags` | Any item has > 5 tags, an empty tag, or a tag > 32 chars | Fix tags on the offending item. |
| 21 | `PaymentAlreadyExists` | Intra-batch duplicate `order_id`, or `order_id` already on-chain | Use unique `order_id` values across items and across prior calls. |
| 26 | `TokenNotAllowed` | Any item's `token_address` not on the allow-list | Use only admin-whitelisted tokens. |
| 10 | `MerchantNotFound` | Any item's `merchant_address` not registered | Verify merchant addresses. |
| 12 | `MerchantInactive` | Any merchant has been deactivated | Contact admin to reactivate the merchant. |
| 90 | `RateLimitExceeded` | Any merchant has exceeded the per-window payment limit | Wait ~25 min for the window to reset, or ask admin to increase the limit. |
| 23 | `InvalidSignature` | ed25519 signature verification fails for any item | Rebuild the payload and re-sign. See section 7 for the exact payload format. |

### Errors that can occur in Phase 4 (after transfers)

| Code | Name | Trigger condition | Remediation |
|------|------|-------------------|-------------|
| 71 | `PaymentHistoryLimitExceeded` | Merchant or payer index has reached 10,000 entries | Archive old payments. See section 11. |

### Contract-level errors

| Code | Name | When | Remediation |
|------|------|------|-------------|
| 70 | `ContractPaused` | `batch_payment` called while contract is paused | Wait for admin to unpause. |
| 1 | `Unauthorized` | `payer.require_auth()` fails | Ensure the payer signs the transaction. |

### Transfer-level failures

If any `token.transfer` call in Phase 3 fails (e.g., insufficient payer balance,
token contract error), the Soroban transaction reverts atomically. No error code
is returned by `batch_payment` itself in this case — the failure comes from the
token contract and is propagated as a host-level trap.

---

## 13. Boundary and Edge Cases

### 13.1 Exactly 10 items

A batch of exactly 10 items is accepted. The `BatchSizeExceeded` check is
`payments.len() > 10` (strictly greater than), so 10 is the maximum valid size.

### 13.2 Exactly 11 items

Returns `BatchSizeExceeded` (52) immediately, before any per-item validation.
No items are inspected.

### 13.3 Empty batch (0 items)

An empty `payments` vector passes all checks (the size check `> 10` is false
for 0). The function returns `Ok(())` with no transfers, no records written,
and no events emitted.

### 13.4 Intra-batch duplicate `order_id`

Two items within the same batch sharing an `order_id` are caught in Phase 1
via a linear scan over `seen_ids`. The batch fails with `PaymentAlreadyExists`
(21). Neither item is recorded.

### 13.5 Cross-call duplicate `order_id`

An `order_id` that was successfully processed in a previous transaction (via
`batch_payment` or `process_payment_with_signature`) cannot be reused. Phase 1
checks `storage::get_payment` and returns `PaymentAlreadyExists` (21) if found.

### 13.6 Same merchant and token in multiple items

Allowed. Amounts are summed in Phase 2 and transferred as a single call in
Phase 3. Individual `PaymentOrder` records are still created per item in Phase 4.
The cumulative amount transferred to the merchant equals the sum of all item
amounts for that `(token, merchant)` pair.

### 13.7 Rate limit hit by the Nth item for a merchant

Phase 1 processes items in declaration order. If item N exceeds the rate limit
for a merchant, the batch fails at item N even though items 1 through N-1 for
that merchant already had their counters incremented. Those increments are
reverted by the transaction rollback.

### 13.8 One item's token not on allow-list

The batch fails with `TokenNotAllowed` (26) at that item. No state is written
for any item.

### 13.9 Mixed tokens and merchants

Items may use different tokens and different merchants freely. The only
constraints are: each token must be allow-listed, each merchant must be
registered and active, and each `order_id` must be unique.

### 13.10 Platform fee of 0

Unlike `process_payment_with_signature`, `batch_payment` always sets
`platform_fee = 0` for every item. This is true regardless of the
admin-configured fee rate. The full `amount` is transferred to the merchant.

---

## 14. Idempotent Re-submission

Because `batch_payment` is atomic, a failed batch leaves no partial state. To
re-submit after a failure:

1. **Identify the error** from the transaction result.
2. **Fix the offending item(s)** (correct amount, signature, merchant address,
   etc.).
3. **Re-submit all items** with the **same `order_id` values** — since no items
   were written on the failed attempt, all `order_id` values are still available.

> ⚠️ **Important:** If the batch partially succeeded due to a Soroban host-level
> revert (e.g., token transfer failure in Phase 3), **some `PaymentOrder` records
> may have been written before the revert** in edge cases involving storage
> caching. In practice, Soroban reverts all storage writes on any unhandled host
> error. Verify the state of each `order_id` with `get_payment_summary` before
> resubmitting to avoid `PaymentAlreadyExists` errors.

### Re-submission checklist

```
[ ] Call get_payment_summary for each order_id to confirm none were committed
[ ] Fix the validation error (wrong amount, bad signature, inactive merchant, etc.)
[ ] Re-sign items if any signature was corrected
[ ] Resubmit the full batch (all original order_ids are still available)
```

### Idempotency with the CLI `batch-pay` command

The CLI `batch-pay` command calls `process_payment_with_signature` per row. For
rows that already succeeded, resubmitting with the same `order_id` returns
`PaymentAlreadyExists`. Only failed rows need to be retried. Use a filtered CSV
containing only the failed rows from the previous run's results table.

---

## 15. CLI Usage

### Contract `batch_payment` — Stellar CLI

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $PAYER_KEY \
  --network $NETWORK \
  -- batch_payment \
  --payer <payer-address> \
  --payments '[
    {
      "order_id": "ORDER_001",
      "merchant_address": "<merchant-1-address>",
      "token_address": "<token-address>",
      "amount": 1000,
      "memo": "Invoice #001",
      "tags": ["invoice", "q3-2026"],
      "signature": "<64-byte-hex-signature>",
      "merchant_public_key": "<32-byte-hex-public-key>"
    },
    {
      "order_id": "ORDER_002",
      "merchant_address": "<merchant-2-address>",
      "token_address": "<token-address>",
      "amount": 500,
      "memo": "Subscription",
      "tags": null,
      "signature": "<64-byte-hex-signature>",
      "merchant_public_key": "<32-byte-hex-public-key>"
    }
  ]'
```

### CLI `batch-pay` command — CSV-based per-row payments

The CLI `batch-pay` command reads a CSV file and calls
`process_payment_with_signature` once per row (not `batch_payment`). It
allows **partial success** — each row is an independent transaction.

#### CSV format

```csv
order_id,merchant_address,token_address,amount,memo
ORDER_001,G...,C...,1000,Invoice #001
ORDER_002,G...,C...,500,Subscription fee
ORDER_003,G...,C...,2500,Q1 invoice
```

#### Running the command

```bash
lumenflow batch-pay \
  --file payments.csv \
  --signature <64-byte-hex-signature> \
  --merchant-public-key <32-byte-hex-public-key>
```

The command prints a results table:

```
order_id    status     tx_hash
ORDER_001   success    a1b2c3…
ORDER_002   success    d4e5f6…
ORDER_003   FAILED: …  -

2/3 payment(s) succeeded.
```

#### Retrying failed rows

Filter the CSV to only failed rows and rerun:

```bash
grep "FAILED" results.txt  # identify failed order_ids
# create retry.csv with only failed rows
lumenflow batch-pay --file retry.csv --signature ... --merchant-public-key ...
```

### TypeScript SDK

```typescript
import { LumenFlowClient } from "@lumenflow/sdk";
import { signBatchItem } from "@lumenflow/sdk/signatures";

const client = new LumenFlowClient({ contractId, network, rpcUrl });

const items = await Promise.all([
  {
    order_id: "ORDER_001",
    merchant_address: merchant1,
    token_address: tokenAddress,
    amount: 1000n,
    memo: "Invoice #001",
    tags: ["invoice"],
    ...(await signBatchItem({ orderId: "ORDER_001", amount: 1000n, merchantPrivKey })),
  },
  {
    order_id: "ORDER_002",
    merchant_address: merchant2,
    token_address: tokenAddress,
    amount: 500n,
    memo: "Subscription",
    tags: null,
    ...(await signBatchItem({ orderId: "ORDER_002", amount: 500n, merchantPrivKey })),
  },
]);

await client.batchPayment({ payer: payerAddress, payments: items });
```

---

## Summary: `batch_payment` vs `process_payment_with_signature`

| Property | `batch_payment` | `process_payment_with_signature` |
|----------|----------------|----------------------------------|
| Max items per call | 10 | 1 |
| Atomicity | All-or-nothing | Single item |
| Platform fee | **Always 0** | Configurable (admin) |
| Nonce in signature | ❌ No | ✅ Yes (merchant nonce) |
| Replay protection | `order_id` uniqueness | `order_id` + nonce |
| Merchant nonce incremented | ❌ No | ✅ Yes |
| Transfer grouping | ✅ By (token, merchant) | N/A |
| Rate limit check | Per item in Phase 1 | Per call |
