# Focused Threat Model: Payment and Refund Flows

**Issue:** [#889](https://github.com/Gloriachinedu/lumenflow-contracts/issues/889)
**Status:** Draft
**Date:** 2026-08-31
**Scope:** LumenFlow Soroban contract — the end-to-end money-movement path:
payment acceptance, payment status, and the refund lifecycle.

This model complements
[threat-model-refund-flows.md](./threat-model-refund-flows.md) (which covers
the refund state machine in depth) by adding the **payment-side** entry points
and the trust boundaries that connect them to refunds.

---

## 1. Assets and actors

| Asset | Why it matters |
| --- | --- |
| Payer funds (SAC token balance) | Direct financial loss on theft or double-spend |
| Merchant receivable | Loss if a payment is reversed or under-paid |
| Platform fee | Revenue integrity |
| Payment / refund records | Drive off-chain accounting, disputes, payouts |
| Admin address & config | Fee %, allowed tokens, refund window, pause state |

| Actor | Trust |
| --- | --- |
| Payer | Untrusted; authenticated via `require_auth` |
| Merchant | Semi-trusted; authenticated; signs payment authorizations |
| Admin | Trusted; single key or multisig |
| Pause guardians | Trusted subset for emergency unpause |
| External SAC token contract | Trusted for transfer semantics only |

---

## 2. Entry points in scope

| Function | Actor | Notes |
| --- | --- | --- |
| `process_payment_with_signature` | Payer + merchant sig | nonce + Ed25519 payload signature |
| `process_payment_with_nonce` | Payer | per-payer nonce replay guard |
| `batch_payment` | Payer | N transfers in one call; `BatchSizeExceeded` cap |
| `create_payment_request` / `pay_payment_request` | Merchant / Payer | merchant-initiated invoice |
| `initiate_multisig_payment` / `sign_` / `execute_` / `cancel_` | Payer + co-signers | threshold, expiry |
| `initiate_refund` / `approve_refund` / `reject_refund` / `execute_refund` | Payer, merchant, admin | see companion doc |
| `raise_dispute` / `resolve_dispute` | Payer / admin | gates refund on rejected dispute |
| `update_payment_status` / `cleanup_expired_payments` | Merchant / admin | lifecycle + retention |

---

## 3. Threats (STRIDE), impact, and mitigations

### T1 — Payment replay / double submission
*Spoofing / Tampering.* An observer resubmits a captured payment call.
**Mitigation (present):** `process_payment_with_signature` requires
`nonce == merchant_nonce + 1`; `process_payment_with_nonce` enforces a
per-payer monotonic nonce; `order_id` uniqueness rejects
`PaymentAlreadyExists`. Signature payload binds `network_id`,
`contract_address`, `nonce`, `order_id`, and `amount`, so it cannot be replayed
cross-contract, cross-network, or with a mutated amount.
**Residual risk:** none under Soroban's single-writer ledger.

### T2 — Amount / token manipulation
*Tampering.* Caller submits a disallowed token or a zero/negative amount.
**Mitigation (present):** `require_positive(amount)`, `is_token_allowed`
(→ `TokenNotAllowed`), allowed-issuer list. Amount is inside the signed payload.
**Recommendation:** keep the duplicate `is_token_allowed` check in
`process_payment_with_signature` — it is cheap and defends against future
refactors that reorder validation.

### T3 — Merchant impersonation / inactive-merchant payment
*Spoofing.* Payment routed to an unregistered or deactivated merchant.
**Mitigation (present):** `get_merchant` → `MerchantNotFound`;
`merchant.active` → `MerchantInactive`; merchant signature verified against
`merchant_public_key` bound to the record.

### T4 — Refund abuse (over-refund, re-refund, out-of-window)
*Elevation / Tampering.* Covered fully in the companion refund threat model.
Key guards: `RefundExceedsOriginal`, `RefundAlreadyCompleted`,
`RefundWindowExpired`, `RefundBelowMinimum`, `RefundLimitExceeded`,
two-step approve→execute, and `DisputeRefundNotRejected` linking disputes to
refunds. **Cross-flow risk:** a payment record cleaned up
(`cleanup_expired_payments`) before its refund window closes would strand a
legitimate refund. **Recommendation (also in companion doc):** enforce
`payment_cleanup_period > refund_window` in config validation.

### T5 — Authorization bypass on admin / lifecycle functions
*Elevation of privilege.* Non-admin calls `set_platform_fee`,
`add_allowed_token`, `cleanup_*`, `update_payment_status`.
**Mitigation (present):** `require_auth` on the admin/merchant address plus an
identity check against stored `admin` / payment's `merchant`. Auth-failure
lockout (`AuthLockedOut`) throttles brute force; `reset_auth_lockout` is
admin-gated.

### T6 — Denial of service
*DoS.* Griefer floods `process_payment_*` or submits huge batches / tag lists.
**Mitigation (present):** payment rate limit (`RateLimitExceeded`,
`set_payment_rate_limit` / `_window`), `BatchSizeExceeded`, `InvalidTags`,
`SerializedPayloadTooLarge`, `PaymentHistoryLimitExceeded`,
`PaginationLimitExceeded`. Soroban resource metering bounds per-call cost.

### T7 — Fee / rounding manipulation
*Tampering.* Attacker picks amounts that round the platform fee to zero.
**Mitigation (present):** `large_payment_threshold` + integer fee math.
**Recommendation:** add a property test asserting
`fee(amount) + merchant_credit(amount) == amount` for the full `i128` range
sampled, and that `fee >= 0`.

### T8 — Reentrancy via the token contract
*Tampering.* Malicious SAC calls back into LumenFlow mid-payment.
**Mitigation (present):** state is written before the external `transfer`
(checks-effects-interactions); Soroban has no synchronous fallback execution.
Allowed-token list keeps an attacker-controlled token out of the path.

### T9 — Pause-state race
*Tampering.* A payment lands in the same ledger as `pause_contract`.
**Mitigation (present):** `require_not_paused` is the first check in every
money-moving function; pause takes effect atomically at ledger close.
Timelock + guardian threshold (`InsufficientUnpauseSignatures`,
`TimelockActive`) prevents a single compromised admin key from unpausing to
drain funds.

### T10 — Multisig payment threshold / expiry bypass
*Elevation.* Execute with too few signatures or after expiry.
**Mitigation (present):** `InsufficientSignatures`, `MultisigExpired`,
`MultisigAlreadyExecuted`, `MultisigAlreadyCancelled`, `MultisigAlreadySigned`
(no double-count). Expiry configurable via `set_multisig_expiry_duration`.

---

## 4. Trust boundaries

```
 Payer wallet ──auth+sig──▶ ┌───────────────────────────┐ ──transfer──▶ SAC token
 Merchant key ──sig───────▶ │  LumenFlow contract       │
 Admin / guardians ───auth▶ │  (pause, rate-limit,      │ ──events───▶ off-chain
                            │   nonce, fee, refund SM)  │              indexer / payouts
                            └───────────────────────────┘
```

Every inbound arrow is authenticated; the outbound `transfer` trusts only
allow-listed tokens; the event stream is the integrity source for off-chain
accounting and must be treated as append-only.

---

## 5. Out of scope

- Client-side wallet / key compromise (operational).
- SAC token contract internals (trusted dependency).
- Stellar network / consensus attacks.
- Off-chain payout and reconciliation services (own review).

---

## 6. Recommendations summary

| Priority | Recommendation | Owner |
| --- | --- | --- |
| High | Enforce `payment_cleanup_period > refund_window` in config validation | contract |
| High | Admin key in HSM or multisig (threshold ≥ 2) | ops |
| Medium | Property test: `fee + merchant_credit == amount`, `fee >= 0` over sampled `i128` | contract tests |
| Medium | Alert on high-value `payment_processed` / `refund_approved` events | monitoring |
| Low | Keep the redundant `is_token_allowed` check in the signature path | contract |
| Low | Monitor per-payer / per-order payment and refund rates | monitoring |

---

## 7. References

- [Threat Model: Refund and Chargeback Flows](./threat-model-refund-flows.md)
- [Security Controls](../security/security-controls.md)
- [Contract Error Codes](../errors.md)
- [Refund Lifecycle](../refund-lifecycle.md)
- [Monitoring Guide](../monitoring.md)
- Stellar Soroban authorization model:
  <https://soroban.stellar.org/docs/fundamentals-and-concepts/authorization>
