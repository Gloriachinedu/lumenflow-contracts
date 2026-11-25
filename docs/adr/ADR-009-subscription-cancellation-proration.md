# ADR-009 — Subscription Cancellation Grace Period and Proration Logic

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-11-25 |
| **Deciders** | @Gloriachinedu, @edwarddavid929-png |
| **Tags** | smart-contract / subscriptions / product |

---

## Context

LumenFlow supports recurring billing via `create_subscription` / `charge_subscription`.
When a subscriber cancels mid-cycle they have already paid for the current period.
Three outcomes are possible:

1. **No refund** — the subscriber retains access until the cycle expires.
2. **Proration** — the unused fraction of the cycle is refunded immediately.
3. **Grace period** — no refund, but no further charges for a fixed window.

Different merchant verticals have different expectations (SaaS vs. e-commerce vs.
content platforms), so a single hard-coded policy is not appropriate. The design
must also remain gas-efficient and not introduce unbounded storage growth.

---

## Decision

We will add a per-merchant `ProrationPolicy` enum stored in persistent storage.
Merchants configure it once via `set_proration_policy`; it is applied every time
`cancel_subscription` is called.

### Policy variants

| Variant | Behaviour |
|---------|-----------|
| `NoRefund` (default) | No refund. Subscriber retains access for the remainder of the paid cycle. |
| `Prorate` | Refund = `plan_amount × (remaining_secs / interval_secs)`. Only issued when the subscriber passes `request_proration = true`. |
| `GracePeriod(secs)` | No refund. No further charges for `secs` seconds post-cancellation. The grace window is recorded in the cancellation event for off-chain enforcement. |

### Contract changes

- **`types.rs`** — new `ProrationPolicy` enum (`#[contracttype]`).
- **`storage.rs`** — new `DataKey::MerchantProrationPolicy(Address)` persistent entry;
  `get_proration_policy` / `set_proration_policy` helpers.
- **`lib.rs`** — `cancel_subscription` gains a `request_proration: bool` parameter.
  Under `Prorate` policy a token transfer from the contract to the subscriber is
  performed before the allowance is shrunk. New `set_proration_policy` and
  `get_proration_policy` entrypoints added.
- **`sdk/src/client.ts`** — `cancelSubscription` gains an optional
  `requestProration: boolean` parameter (defaults to `false`).

### Proration arithmetic

```
refund = plan_amount × remaining_secs / interval_secs
```

Integer arithmetic: multiply before divide to maximise precision. All values use
`i128` and `u64`; overflow is guarded with `saturating_mul`.
`remaining_secs = max(0, interval_secs − (now − last_charged_at))`.

---

## Consequences

### Positive
- Merchants can configure the cancellation experience that fits their product.
- Subscribers get transparent, predictable refund behaviour.
- The contract change is backwards-compatible: existing calls without
  `request_proration` default to `false` (no refund), matching prior behaviour.
- No new unbounded storage: one persistent entry per merchant.

### Negative / Trade-offs
- `cancel_subscription` gains a new required parameter — SDK callers must update.
- Proration accuracy is limited by ledger timestamp granularity (~5 seconds).
- `GracePeriod` enforcement (blocking charges during the grace window) is
  tracked via events and enforced off-chain; the contract does not store a
  per-subscription grace-expiry timestamp in this iteration to avoid state bloat.

### Neutral
- A `lumenflow/proration_policy_set` event is emitted when a merchant updates
  their policy, enabling off-chain audit.
- A `lumenflow/subscription_prorated` event carries the subscriber address and
  refund amount for receipts and analytics.

---

## Alternatives Considered

| Alternative | Reason not chosen |
|-------------|------------------|
| Single global policy (admin-set) | Does not accommodate different merchant verticals |
| Always-on proration | Forces a token transfer on every cancel; increases gas cost and complexity for merchants that do not want refunds |
| Store grace-expiry per subscription | Requires additional storage per record; deferred to a future issue if on-chain enforcement is needed |

---

## References

- Issue [#1610](https://github.com/Gloriachinedu/lumenflow-contracts/issues/1610) — Design subscription cancellation grace period and proration logic
- [Subscription backlog entry](../backlog.md)
- Soroban token interface: `transfer`, `approve`
