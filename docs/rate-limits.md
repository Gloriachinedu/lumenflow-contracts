# Rate Limits

LumenFlow enforces on-chain rate limits to protect shared storage and prevent
individual actors from bloating the contract's ledger footprint.

---

## Payment Request Creation

| Parameter | Default | Configurable |
|-----------|---------|--------------|
| Max active requests per merchant | **100** | Yes – admin only |

### Policy

A merchant may hold at most **N** non-expired payment requests at any given
time, where N defaults to 100 and can be changed by the contract admin via
`set_max_active_payment_requests`.

**Expired requests do not count toward the limit.** A request is considered
expired once its `expires_at` timestamp (set at creation via the `ttl`
argument) has passed. The counter is decremented automatically when:

- A payer calls `pay_payment_request` and the request is fulfilled.
- A payer calls `pay_payment_request` on an already-expired request (the
  request is cleaned up and `PaymentError::PaymentExpired` is returned).

### Error

When the limit is reached, `create_payment_request` returns:

```
ContractError::RateLimitExceeded  (code 72)
```

Remediation: wait for existing requests to expire or be paid before creating
new ones, or ask the contract admin to raise the limit.

### Admin configuration

```bash
# Raise the limit to 200 active requests per merchant
stellar contract invoke \
  --id $CONTRACT_ID \
  --source-account $ADMIN_KEY \
  --network $NETWORK \
  -- set_max_active_payment_requests \
  --admin $ADMIN_ADDR \
  --limit 200
```

---

## Future rate-limit surfaces

The following surfaces are candidates for future rate limiting but are not yet
enforced on-chain:

| Surface | Planned limit |
|---------|--------------|
| `process_payment_with_signature` per payer per ledger | TBD |
| `initiate_refund` per order | Already capped by original payment amount |
| `register_merchant` | Handled by admin-gated flow |
