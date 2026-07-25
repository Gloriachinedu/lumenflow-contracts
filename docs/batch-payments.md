# Batch Payment Processing

LumenFlow supports processing up to **10 payments in a single contract invocation** via `process_batch_payment`. This document covers the batch format, atomicity guarantees, error handling, and idempotent re-submission.

---

## Overview

| Property | Value |
|----------|-------|
| Max batch size | **10 items** |
| Atomicity | **Non-atomic** — each item is processed independently |
| Idempotency | **Yes** — duplicate `order_id` values are skipped |
| Auth required | Payer must authorise the invocation |

---

## Request Format

Each item in the batch is a `BatchPaymentItem` object. The batch is submitted as a JSON array in the `items` parameter.

### `BatchPaymentItem` fields

| Field | Type | Description |
|-------|------|-------------|
| `order_id` | string | Unique order identifier. Duplicate IDs are skipped (idempotent). |
| `merchant_address` | string (Address) | Stellar address of the recipient merchant. |
| `token_address` | string (Address) | SAC token contract address. |
| `amount` | integer (i128) | Payment amount in token base units. |
| `memo` | string | Human-readable memo (max 128 chars). |
| `signature` | bytes (hex or base64) | Ed25519 signature over the payment payload. See [docs/signature-format.md](signature-format.md). |
| `merchant_public_key` | bytes (hex or base64) | 32-byte Ed25519 public key of the merchant, used to verify `signature`. |

---

## Complete 3-Item Batch Example

```json
{
  "payer": "GBPAYER1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "items": [
    {
      "order_id": "ORDER_2024_001",
      "merchant_address": "GMERCHANT_ALPHA_ADDR",
      "token_address": "GDAO_USDC_TOKEN_CONTRACT",
      "amount": 5000,
      "memo": "Invoice #001 - Web design",
      "signature": "a1b2c3d4e5f6...",
      "merchant_public_key": "ed25519pubkey01..."
    },
    {
      "order_id": "ORDER_2024_002",
      "merchant_address": "GMERCHANT_BETA_ADDR",
      "token_address": "GDAO_USDC_TOKEN_CONTRACT",
      "amount": 12000,
      "memo": "Invoice #002 - Hosting",
      "signature": "b2c3d4e5f6a1...",
      "merchant_public_key": "ed25519pubkey02..."
    },
    {
      "order_id": "ORDER_2024_003",
      "merchant_address": "GMERCHANT_GAMMA_ADDR",
      "token_address": "GDAO_USDC_TOKEN_CONTRACT",
      "amount": 800,
      "memo": "Invoice #003 - Domain renewal",
      "signature": "c3d4e5f6a1b2...",
      "merchant_public_key": "ed25519pubkey03..."
    }
  ]
}
```

### CLI invocation

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source-account $PAYER_KEY \
  --network $NETWORK \
  -- process_batch_payment \
  --payer $PAYER_ADDRESS \
  --items '[
    {"order_id":"ORDER_2024_001","merchant_address":"GMERCHANT_ALPHA_ADDR","token_address":"GDAO_USDC_TOKEN_CONTRACT","amount":5000,"memo":"Invoice #001","signature":"a1b2c3...","merchant_public_key":"ed25519key01..."},
    {"order_id":"ORDER_2024_002","merchant_address":"GMERCHANT_BETA_ADDR","token_address":"GDAO_USDC_TOKEN_CONTRACT","amount":12000,"memo":"Invoice #002","signature":"b2c3d4...","merchant_public_key":"ed25519key02..."},
    {"order_id":"ORDER_2024_003","merchant_address":"GMERCHANT_GAMMA_ADDR","token_address":"GDAO_USDC_TOKEN_CONTRACT","amount":800,"memo":"Invoice #003","signature":"c3d4e5...","merchant_public_key":"ed25519key03..."}
  ]'
```

---

## Atomicity Guarantee

**Batch payments are non-atomic.** Each item is processed independently inside the contract:

- If item 1 succeeds and item 2 fails, item 1's payment is **finalised on-chain**.
- The contract does **not** roll back previously processed items when a later item fails.
- The caller receives a per-item result array indicating which items succeeded and which failed.

### Result structure

```json
{
  "results": [
    { "order_id": "ORDER_2024_001", "status": "success" },
    { "order_id": "ORDER_2024_002", "status": "error", "code": "InvalidSignature" },
    { "order_id": "ORDER_2024_003", "status": "success" }
  ]
}
```

---

## Partial Failure Scenarios

### Scenario: Item 2 of 3 fails signature validation

Suppose items 1 and 3 have valid signatures but item 2 has an incorrect `signature` field.

**What happens:**

1. Item 1 (`ORDER_2024_001`) — signature verified ✅ → payment processed, tokens transferred, event emitted.
2. Item 2 (`ORDER_2024_002`) — signature verification fails ❌ → error recorded, **no tokens transferred**, processing continues.
3. Item 3 (`ORDER_2024_003`) — signature verified ✅ → payment processed, tokens transferred, event emitted.

**Result:**

```json
{
  "results": [
    { "order_id": "ORDER_2024_001", "status": "success" },
    { "order_id": "ORDER_2024_002", "status": "error", "code": "InvalidSignature" },
    { "order_id": "ORDER_2024_003", "status": "success" }
  ]
}
```

The payer is only charged for items 1 and 3. Item 2 must be corrected and re-submitted.

---

## Error Codes

| Code | Meaning | Recovery |
|------|---------|----------|
| `InvalidSignature` | Ed25519 signature did not verify against the payload and merchant public key | Re-compute the signature; see [docs/signature-format.md](signature-format.md) |
| `DuplicateOrderId` | An order with this `order_id` already exists on-chain | This is the idempotency mechanism — already paid, no action needed |
| `MerchantNotFound` | The `merchant_address` is not registered | Verify the merchant address; check registration status |
| `MerchantInactive` | The merchant account has been deactivated | Contact the merchant or use a different merchant |
| `InsufficientBalance` | Payer does not hold enough tokens | Top up the payer account before retrying |
| `BatchTooLarge` | More than 10 items submitted | Split into multiple batches of ≤ 10 items |
| `InvalidAmount` | Amount is zero or negative | Provide a positive `amount` |

---

## Idempotent Re-submission

Because `order_id` is the idempotency key, re-submitting a batch that was partially processed is safe:

- Items that **already succeeded** (their `order_id` exists on-chain) will be returned with `status: "error", code: "DuplicateOrderId"` — **no double charge occurs**.
- Items that **failed** (no on-chain record) will be retried normally.

### Re-submission workflow

1. Receive partial batch result.
2. Identify failed items and fix the root cause (e.g. recompute signatures).
3. Re-submit the **full original batch** or just the failed items — both approaches are safe.
4. Items that were already paid will be silently skipped via the duplicate-order-id guard.

### Example: re-submitting after item 2 failure

```bash
# Fix the signature for ORDER_2024_002 and re-submit all three items.
# ORDER_2024_001 and ORDER_2024_003 will return DuplicateOrderId (safe).
# ORDER_2024_002 will be processed if the new signature is correct.

stellar contract invoke \
  --id $CONTRACT_ID \
  --source-account $PAYER_KEY \
  --network $NETWORK \
  -- process_batch_payment \
  --payer $PAYER_ADDRESS \
  --items '[
    {"order_id":"ORDER_2024_001","merchant_address":"GMERCHANT_ALPHA_ADDR","token_address":"GDAO_USDC_TOKEN_CONTRACT","amount":5000,"memo":"Invoice #001","signature":"a1b2c3...","merchant_public_key":"ed25519key01..."},
    {"order_id":"ORDER_2024_002","merchant_address":"GMERCHANT_BETA_ADDR","token_address":"GDAO_USDC_TOKEN_CONTRACT","amount":12000,"memo":"Invoice #002","signature":"FIXED_SIGNATURE...","merchant_public_key":"ed25519key02..."},
    {"order_id":"ORDER_2024_003","merchant_address":"GMERCHANT_GAMMA_ADDR","token_address":"GDAO_USDC_TOKEN_CONTRACT","amount":800,"memo":"Invoice #003","signature":"c3d4e5...","merchant_public_key":"ed25519key03..."}
  ]'
```

---

## Limits and Constraints

| Constraint | Value | Notes |
|-----------|-------|-------|
| Max items per batch | **10** | Enforced at contract entry; returns `BatchTooLarge` if exceeded |
| `order_id` uniqueness | Global, permanent | Once a payment is processed, that `order_id` can never be reused |
| Token approval | Payer must pre-approve the contract for the **total** amount | Single token approval covering sum of all items in the batch |
| Memo max length | 128 characters | Truncated in events if longer |

---

## Token Approval

Before calling `process_batch_payment`, the payer must approve the contract to spend the **sum of all item amounts**. For a 3-item batch totalling 17 800 units:

```bash
stellar contract invoke \
  --id $TOKEN_CONTRACT \
  --source-account $PAYER_KEY \
  --network $NETWORK \
  -- approve \
  --from $PAYER_ADDRESS \
  --spender $CONTRACT_ID \
  --amount 17800 \
  --expiration_ledger $EXPIRY_LEDGER
```

---

## See Also

- [docs/signature-format.md](signature-format.md) — How to build the ed25519 payment signature
- [docs/events-reference.md](events-reference.md) — Events emitted per processed item (`lumenflow/payment_processed`)
- [README.md Payment Processing section](../README.md#payment-processing) — Single payment CLI reference
