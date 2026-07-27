# Batch Payments

The `batch_payment` function lets a payer send up to **10** payments to different
merchants in a single, atomic transaction. If any item fails validation or
signature verification, the **entire batch is reverted** — no partial state is
written.

## Function signature

```rust
pub fn batch_payment(
    env: Env,
    payer: Address,
    payments: Vec<BatchPaymentItem>,
) -> Result<(), PaymentError>
```

## `BatchPaymentItem` fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `order_id` | `String` | ✅ | Unique order ID. Must not already exist on-chain. |
| `merchant_address` | `Address` | ✅ | Registered, active merchant. |
| `token_address` | `Address` | ✅ | SAC token to transfer. |
| `amount` | `i128` | ✅ | Transfer amount in the token's smallest unit. Must be > 0. |
| `memo` | `String` | ✅ | Human-readable description (may be empty). |
| `tags` | `Option<Vec<String>>` | ✅* | Optional tags for categorising this item (see below). |
| `signature` | `Bytes` | ✅ | ed25519 signature over `order_id_xdr \|\| amount_be_bytes`. |
| `merchant_public_key` | `Bytes` | ✅ | 32-byte ed25519 public key of the merchant. |

> *`tags` is optional — pass `None` / `null` / `undefined` if not needed.

## Tags field (added in v1.1)

The `tags` field mirrors the same field available on `process_payment_with_signature`.
It allows merchants to attach metadata labels to individual batch items for
reporting, reconciliation, and filtering.

### Rules

- **Maximum 5 tags** per batch item.
- Each tag must be between **1 and 32 characters**.
- Tags are validated using the shared `validate_tags` helper — the same rules
  apply as for single payments.
- An **invalid tag in any item causes the entire batch to be rejected**
  (`PaymentError::InvalidTags`).

### Example (Rust)

```rust
let mut tags = Vec::new(&env);
tags.push_back(String::from_str(&env, "invoice"));
tags.push_back(String::from_str(&env, "q3-2026"));

let item = BatchPaymentItem {
    order_id: String::from_str(&env, "ORDER_001"),
    merchant_address: merchant.clone(),
    token_address: token.clone(),
    amount: 1_000,
    memo: String::from_str(&env, "Monthly subscription"),
    tags: Some(tags),
    signature: sig,
    merchant_public_key: pub_key,
};
```

### Example (TypeScript SDK)

```typescript
import { BatchPaymentItem } from "@lumenflow/sdk";

const item: BatchPaymentItem = {
  order_id: "ORDER_001",
  merchant_address: "G...",
  token_address: "C...",
  amount: 1000n,
  memo: "Monthly subscription",
  tags: ["invoice", "q3-2026"],      // ← optional tags
  signature: new Uint8Array(64),
  merchant_public_key: new Uint8Array(32),
};
```

### Example (CLI)

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $PAYER_KEY --network $NETWORK \
  -- batch_payment \
  --payer <payer-address> \
  --payments '[{
    "order_id": "ORDER_001",
    "merchant_address": "<merchant>",
    "token_address": "<token>",
    "amount": 1000,
    "memo": "Monthly sub",
    "tags": ["invoice", "q3-2026"],
    "signature": "<sig-bytes>",
    "merchant_public_key": "<pub-key-bytes>"
  }]'
```

## Tags stored in `PaymentOrder`

Tags provided on a `BatchPaymentItem` are written to the resulting `PaymentOrder`
record. You can retrieve them via:

```bash
stellar contract invoke --id $CONTRACT_ID -- get_payment_by_id \
  --caller <address> --order_id "ORDER_001"
```

The response's `tags` field will contain the values you supplied.

## Error codes

| Error | Cause |
|-------|-------|
| `BatchSizeExceeded` | More than 10 items in the batch |
| `InvalidAmount` | Any item has `amount ≤ 0` |
| `InvalidTags` | Any item has > 5 tags, an empty tag, or a tag > 32 chars |
| `PaymentAlreadyExists` | Any `order_id` already exists on-chain |
| `MerchantNotFound` | Any `merchant_address` is not registered |
| `MerchantInactive` | Any merchant is deactivated |
| `InvalidSignature` | Signature verification fails for any item |

## Atomicity guarantee

All items are validated and signatures verified **before** any token transfer
occurs. If the contract returns an error, no funds move and no payment records
are written.

---

## Multi-token transfer grouping (introduced in #568)

In previous versions, `batch_payment` issued one `token.transfer` call per
batch item — 10 items always produced 10 cross-contract calls. Starting in this
release, transfers are **grouped by `(token_address, merchant_address)` pair**
before execution.

### How it works

1. **Phase 1 — Validation:** All items are validated and their ed25519 signatures
   verified. Any failure aborts the entire batch before any state changes.
2. **Phase 2 — Grouping:** The contract scans all items and accumulates amounts
   into a `(token, merchant, total)` table. Multiple items sharing the same token
   and merchant are summed into a single group.
3. **Phase 3 — Transfers:** One `token.transfer` call is made per unique group,
   not per item. A batch of 10 items using 3 distinct tokens results in at most
   3–10 transfers (depending on merchant diversity).
4. **Phase 4 — Records:** Payment records are written and statistics updated per
   item (individual `order_id` records are preserved).
5. **Phase 5 — Events:** One `payment_processed` event is emitted per item, so
   off-chain consumers still receive granular per-order events.

### Example: 10 items, 3 tokens

```
Item  token  merchant  amount
 1    USDC   M1        500
 2    USDC   M1        300   ← grouped with item 1 → 800 transferred
 3    USDC   M2        200
 4    XLM    M1        1000
 5    XLM    M1        500   ← grouped with item 4 → 1500 transferred
 6    XLM    M2        750
 7    EURC   M3        400
 8    EURC   M3        600   ← grouped with item 7 → 1000 transferred
 9    USDC   M3        100
10    XLM    M3        250

Groups → 6 token.transfer calls instead of 10
```

### Benefit

Reducing `token.transfer` calls lowers the number of cross-contract invocations
in a transaction, which directly reduces fee costs for batches that contain
repeated (token, merchant) combinations.
