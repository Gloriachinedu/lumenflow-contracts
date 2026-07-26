# Order ID Semantics and Idempotency

## What is an order ID?

Every payment submitted to LumenFlow is identified by a caller-supplied `order_id` string. The contract stores each order ID permanently and **rejects any attempt to process the same order ID twice** with error code `21` (`PaymentAlreadyExists`).

This is the contract's primary duplicate-prevention mechanism. It is enforced at the storage layer, so it holds even if two transactions race to the ledger.

## Uniqueness requirements

| Requirement | Detail |
|---|---|
| **Globally unique** | Order IDs are unique across all payers and merchants, not just per merchant. |
| **Immutable** | Once a payment is recorded the order ID can never be reused, even after a full refund. |
| **Case-sensitive** | `ORDER_001` and `order_001` are treated as different IDs. |
| **Max length** | 64 bytes (contract enforced). |

### Recommended format

Use a format that is naturally unique in your system, for example:

```
<your-system-prefix>-<uuid-v4>
# e.g. shop42-018f1c2d-4a3b-7c6d-8e9f-0a1b2c3d4e5f
```

UUIDs, nanoids, or database primary keys combined with a namespace prefix all work well.

## Idempotency in the SDK

The SDK exposes two ways to deal with duplicate submissions:

### Option 1 — `processPaymentIdempotent` (recommended)

Use this when you need safe retries (e.g. after a network timeout where you don't know if the first attempt landed):

```typescript
import { LumenFlowClient } from "@lumenflow/sdk";

const { result, duplicate } = await client.processPaymentIdempotent(
  payer,
  orderId,      // the same order ID you tried before
  merchant,
  token,
  amount,
  memo,
  null,
  signature,
  merchantPublicKey
);

if (duplicate) {
  console.log("Payment already processed — returning existing record:", result);
} else {
  console.log("Payment submitted:", result);
}
```

When `duplicate` is `true` the existing `PaymentOrder` record is returned, so your application can proceed identically to a fresh success.

### Option 2 — `withIdempotency` helper

For lower-level control or non-payment operations:

```typescript
import { withIdempotency } from "@lumenflow/sdk";

const { result, duplicate } = await withIdempotency(
  () => client.processPaymentWithSignature(/* ... */),
  () => client.getPaymentById(payer, orderId)   // fallback fetches the existing record
);
```

If you omit the fallback, `PaymentAlreadyExists` is re-thrown so you can handle it yourself.

## Idempotency in the CLI

Pass `--idempotent` to the `pay` command to enable safe retries:

```bash
lumenflow pay \
  --merchant G... \
  --amount 1000 \
  --order-id ORDER_001 \
  --token G... \
  --signature <hex> \
  --merchant-public-key <hex> \
  --idempotent
```

With `--idempotent` the CLI prints a note when a duplicate is detected and exits with code `0` instead of failing. Without the flag a duplicate order ID produces an error.

## Common pitfalls

**Generating the order ID after a timeout** — if your network call times out you may not know whether the transaction landed. Always use the *same* order ID when retrying; never generate a new one for the same logical payment.

**Using customer-visible invoice numbers** — these can collide if your system reuses them. Prefer opaque UUIDs and store the mapping in your own database.

**Batch payments** — each item in a `batch_payment` call has its own `order_id`. The same uniqueness rules apply to each item individually.

## See also

- [`docs/errors.md`](errors.md) — full error code reference, including `PaymentAlreadyExists` (code 21)
- [`docs/webhook-integration.md`](webhook-integration.md) — idempotency for off-chain event consumers
- [`sdk/README.md`](../sdk/README.md) — full SDK API reference
