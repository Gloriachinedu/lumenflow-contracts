# LumenFlow API Rate Limits

This document describes the rate limiting applied to LumenFlow contract endpoints,
how to configure them, and how callers should handle rate-limit errors.

---

## Overview

LumenFlow enforces a **per-merchant, tumbling-window** rate limit on the payment
processing endpoint.  This protects the network from burst abuse, limits the
on-chain storage growth rate, and provides a fair-use guarantee for all
merchants on the contract.

The limit is intentionally separate from Soroban's own ledger-level resource
limits — it is a **business-logic control** enforced by the contract itself and
configurable by the admin.

---

## Rate-limited endpoints

| Endpoint | Limit type | Default |
|---|---|---|
| `process_payment_with_signature` | Per merchant, tumbling window | 100 payments / 3600 s |
| `batch_payment` | Counted per item; each item counts against the receiving merchant | Same window |
| `initiate_refund` | Per order (existing guard) | 5 pending refunds / order |

All other endpoints (queries, admin operations, multisig, subscriptions) are
**not** subject to the payment rate limit.

---

## Tumbling-window algorithm

```
window_start[merchant] ← 0
window_count[merchant] ← 0

on payment attempt for merchant M at time T:
  if T >= window_start[M] + window_secs:
    window_start[M] ← T      // new window starts now
    window_count[M] ← 0
  if window_count[M] >= limit:
    return RateLimitExceeded  // error code 54
  window_count[M] += 1
  proceed with payment
```

Key properties:
- Each merchant has an **independent** counter.
- A window resets the first time a payment is attempted **after** the window
  has expired.  There is no background timer.
- Counters are persisted in contract storage; they survive across transactions
  and ledger closes.

---

## Default limits

| Parameter | Default value | Meaning |
|---|---|---|
| `payment_rate_limit` | `100` | Maximum payments a merchant may receive per window |
| `payment_rate_window` | `3600` seconds | Duration of one rate-limit window (1 hour) |
| `max_refunds_per_order` | `5` | Maximum pending refunds per payment order |

The defaults are deliberately permissive.  For production deployments the admin
should tune them to match expected traffic patterns.

---

## Admin configuration

All rate-limit parameters are admin-only and can be changed at any time.
Changes take effect immediately for the **next** payment attempt; the current
window counter is not retroactively invalidated.

### Set maximum payments per window

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY --network $NETWORK \
  -- set_payment_rate_limit \
  --admin <admin-address> \
  --limit 50
```

### Set window duration

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY --network $NETWORK \
  -- set_payment_rate_window \
  --admin <admin-address> \
  --window_secs 1800
```

### Set maximum pending refunds per order

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY --network $NETWORK \
  -- set_max_refunds_per_order \
  --admin <admin-address> \
  --max 3
```

---

## Error handling

When a rate limit is exceeded the contract returns:

| Error | Code | Meaning |
|---|---|---|
| `RateLimitExceeded` | `54` | Merchant has exceeded the payment quota for the current window |
| `TooManyRefunds` | `36` | Order has reached the maximum number of pending refunds |

### SDK (TypeScript)

```typescript
try {
  await contract.process_payment_with_signature({ ... });
} catch (err) {
  if (err.code === 54) {
    // RateLimitExceeded — back off and retry after the window expires.
    console.error('Payment rate limit reached. Retry later.');
  }
}
```

### Rust (contract client)

```rust
match client.try_process_payment_with_signature(...) {
    Err(Ok(PaymentError::RateLimitExceeded)) => {
        // Handle rate limit — notify payer to retry after the window resets.
    }
    Err(Ok(e)) => { /* other contract errors */ }
    Err(Err(e)) => { /* host-level error */ }
    Ok(_) => { /* success */ }
}
```

---

## Recommended configuration by use case

| Scenario | `payment_rate_limit` | `payment_rate_window` |
|---|---|---|
| High-volume e-commerce | 500 | 3600 (1 h) |
| Standard retail | 100 | 3600 (1 h) |
| Testing / sandbox | 1 000 | 60 (1 min) |
| Abuse prevention lock-down | 10 | 3600 (1 h) |

---

## Security considerations

- Rate limits **cannot be bypassed** by splitting payments across multiple payers —
  the counter key is the **merchant address**, not the payer.
- Because the window resets on the first post-expiry payment there is a brief
  burst window at the boundary.  For stricter guarantees, consider reducing the
  window size or implementing a leaky-bucket variant in a future upgrade.
- Admin-only configuration means a compromised payer or merchant cannot raise
  their own limit.

---

## Related

- [Auth Model](auth-model.md) — which roles can call which functions
- [Testing Guide](testing-guide.md) — how to write tests for rate-limited paths
- [Events Reference](events-reference.md) — monitoring payment volume
