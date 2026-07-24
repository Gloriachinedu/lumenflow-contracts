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
