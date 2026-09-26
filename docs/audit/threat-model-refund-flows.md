# Threat Model: Refund and Chargeback Flows

**Issue:** [#357](https://github.com/Gloriachinedu/lumenflow-contracts/issues/357)  
**Status:** Draft  
**Date:** 2026-06-29  
**Scope:** LumenFlow Soroban smart contract — refund lifecycle and chargeback-equivalent flows

---

## Overview

This document applies a threat-modeling analysis to the refund and chargeback flows implemented in the LumenFlow contract. The goal is to identify attack vectors, assess their impact, and confirm or recommend mitigations so that reviewers and auditors have a single reference covering the security posture of these flows.

The refund lifecycle in LumenFlow follows the states below:

```
[*] --> Pending
Pending --> Approved   : merchant or admin approves
Pending --> Rejected   : merchant or admin rejects
Approved --> Completed : merchant executes refund
Rejected --> [*]
```

Relevant contract entry points covered by this analysis:

| Entry point | Actor |
|---|---|
| `initiate_refund` | Payer or merchant |
| `approve_refund` | Merchant or admin |
| `reject_refund` | Merchant or admin |
| `execute_refund` | Merchant |
| `get_refund` | Any authenticated caller |
| `get_refunds_for_order` | Payer, merchant, or admin |
| `set_refund_window` | Admin |
| `set_min_refund_amount` | Admin |
| `cleanup_expired_payments` | Admin |

---

## Threat Summary Table

| ID | Threat | Likelihood | Impact | Status |
|----|--------|-----------|--------|--------|
| T1 | Refund Window Bypass | Low | High | Mitigated |
| T2 | Refund Amount Overflow / Over-Refund | Medium | High | Mitigated |
| T3 | Unauthorized Refund Initiation | Medium | Medium | Mitigated |
| T4 | Double-Execution / Replay of Approved Refund | Low | High | Mitigated |
| T5 | Malicious Admin Approval of Fraudulent Refunds | Low | High | Partially Mitigated |
| T6 | Refund for Non-Existent or Archived Payment | Low | Medium | Mitigated |
| T7 | Minimum Refund Amount Griefing (Dust Attack) | Medium | Low | Mitigated |
| T8 | Race Condition in Concurrent Refund Approvals | Low | Medium | Mitigated |

---

## Detailed Threat Scenarios

---

### T1 — Refund Window Bypass

**Category:** Input manipulation / timestamp forgery  
**STRIDE:** Tampering  
**Likelihood:** Low  
**Impact:** High

#### Threat Description

An attacker attempts to initiate a refund after the 30-day window has expired. Possible techniques include:

- Submitting a transaction with a manipulated `paid_at` timestamp on a re-created payment record.
- Exploiting clock skew between nodes to slip a transaction through just after the window closes.
- Re-creating a payment entry under the same `order_id` after the original is cleaned up.

#### Mitigation

The contract evaluates the refund window using exclusively on-chain values:

```rust
if env.ledger().timestamp() > payment.paid_at + refund_window {
    return Err(ContractError::RefundWindowExpired);
}
```

- `env.ledger().timestamp()` is the canonical Stellar ledger close time, which callers cannot influence.
- `payment.paid_at` is written once at payment processing time and is immutable in storage.
- `refund_window` is configurable only by the admin via `set_refund_window`; ordinary callers cannot alter it.
- `order_id` uniqueness is enforced at payment creation time; re-creating a payment under the same ID returns `DuplicateOrderId`.

**Residual risk:** None for window bypass specifically. Admin key compromise (see T5) could allow the window to be extended retroactively.

---

### T2 — Refund Amount Overflow / Over-Refund

**Category:** Arithmetic manipulation  
**STRIDE:** Tampering, Elevation of Privilege  
**Likelihood:** Medium  
**Impact:** High

#### Threat Description

A malicious payer or merchant initiates multiple partial refunds whose cumulative total exceeds the original payment amount. If unchecked, this would allow the merchant's token balance to be drained beyond the agreed amount.

Example attack flow:
1. Payment of 1000 stroops is processed.
2. Attacker initiates refund A for 900 stroops — approved and executed.
3. Attacker immediately initiates refund B for 900 stroops before state is updated.

#### Mitigation

`initiate_refund` performs a cumulative check before accepting a new refund request:

```rust
if payment.refunded_amount + amount > payment.amount {
    return Err(ContractError::RefundExceedsOriginal);
}
```

`execute_refund` follows the checks-effects-interactions pattern — `payment.refunded_amount` is incremented and persisted **before** the token transfer is dispatched:

```rust
payment.refunded_amount += refund.amount;
storage::save_payment(&env, &payment);
token_client.transfer(...); // transfer happens last
```

This ensures that even under concurrent ledger submissions, the state update is atomic with respect to Soroban's single-transaction-per-close model.

**Residual risk:** Low. Standard integer overflow protections in Rust (`u128` with checked arithmetic) prevent wrapping.

---

### T3 — Unauthorized Refund Initiation

**Category:** Broken access control  
**STRIDE:** Spoofing, Elevation of Privilege  
**Likelihood:** Medium  
**Impact:** Medium

#### Threat Description

A third party — neither the original payer nor the merchant for a given payment — attempts to initiate a refund. Goals may include:

- Disrupting a merchant's payment records by injecting spurious refund entries.
- Leaking payment metadata by triggering errors that reveal existence of payments.
- Forcing a refund workflow that ties up a payment in a `Pending` state indefinitely.

#### Mitigation

`initiate_refund` enforces dual access control:

1. **On-chain authentication:** `env.current_contract_address().require_auth_for_args(...)` ensures the caller holds a valid Stellar keypair matching the supplied address. An unauthenticated caller is rejected at the Soroban host level before contract logic runs.

2. **Relationship check:** After authentication, the contract verifies the caller is either the payer or the merchant:

```rust
if caller != payment.payer && caller != payment.merchant_address {
    return Err(ContractError::Unauthorized);
}
```

**Residual risk:** Low. An admin can also initiate a refund by design; admin key security is covered under T5.

---

### T4 — Double-Execution / Replay of Approved Refund

**Category:** Replay attack  
**STRIDE:** Tampering  
**Likelihood:** Low  
**Impact:** High

#### Threat Description

After a refund is approved, an attacker — or a buggy client — calls `execute_refund` a second time for the same `refund_id`. If the status check is absent or evaluated after the transfer, the merchant's token balance could be drained for the same refund amount multiple times.

#### Mitigation

`execute_refund` enforces a strict status gate before any state mutation or token transfer:

```rust
if !matches!(refund.status, RefundStatus::Approved) {
    return Err(ContractError::RefundNotApproved);
}
```

Immediately upon passing this check, the refund status is updated to `Completed` and written to persistent storage **before** the token transfer:

```rust
refund.status = RefundStatus::Completed;
storage::save_refund(&env, &refund);
token_client.transfer(...); // transfer happens last
```

Because Soroban ledger state is committed atomically at ledger close, no concurrent transaction can observe the `Approved` status after the first execution has committed.

**Residual risk:** None under normal Soroban execution guarantees.

---

### T5 — Malicious Admin Approval of Fraudulent Refunds

**Category:** Insider threat / key compromise  
**STRIDE:** Elevation of Privilege, Repudiation  
**Likelihood:** Low  
**Impact:** High

#### Threat Description

A compromised or rogue admin key approves refunds that the merchant never agreed to. Because `approve_refund` permits admin approval alongside merchant approval, a single compromised admin key can force a token transfer out of the merchant's account.

Secondary scenario: An admin extends the refund window (`set_refund_window`) to retroactively re-open expired refunds for fraudulent claims.

#### Mitigation

Current mitigations (in-contract):

- The admin role is a single address; compromise of the private key is the primary risk vector.
- `transfer_admin` allows the current admin to rotate to a new address if a compromise is detected, limiting the blast radius to actions taken before rotation.
- All admin actions emit on-chain events (`lumenflow/refund_approved`) that can be monitored via Horizon SSE streams for anomaly detection.

Operational mitigations (recommended):

- Store the admin private key in a hardware security module (HSM) or use a Stellar multisig account with a threshold ≥ 2 as the admin address.
- Monitor `lumenflow/refund_approved` events in real time; alert on approvals exceeding a configurable threshold amount.

**Future improvement (open action):** Require merchant co-approval for any admin-initiated refund above a configurable amount threshold. This would limit admin-only approval to small or dispute-resolution amounts only.

**Residual risk:** Medium until the future improvement is implemented. Operational key security is the primary control.

---

### T6 — Refund for Non-Existent or Archived Payment

**Category:** Invalid reference / stale data  
**STRIDE:** Tampering  
**Likelihood:** Low  
**Impact:** Medium

#### Threat Description

An attacker constructs a `refund_id` referencing:

- A `order_id` that was never recorded (fabricated ID).
- A payment that was archived by `archive_payment_record` (admin action).
- A payment that was removed by `cleanup_expired_payments` after the configured cleanup period.

The goal may be to cause a storage panic, trigger unexpected error paths, or exploit leftover state.

#### Mitigation

`initiate_refund` calls `storage::get_payment` at the start and returns early if the payment cannot be found:

```rust
let payment = storage::get_payment(&env, &order_id)
    .ok_or(ContractError::PaymentNotFound)?;
```

The cleanup window (`set_payment_cleanup_period`, default 90 days) is deliberately longer than the refund window (default 30 days). This ensures that a payment eligible for refund will never be removed by cleanup before the refund window has expired.

`archive_payment_record` is an admin-only action. Archiving a payment while a refund is `Pending` or `Approved` is an operational risk mitigated by the admin monitoring guidance in T5.

**Residual risk:** Low. The cleanup period ordering guarantee should be enforced in admin documentation and configuration validation.

---

### T7 — Minimum Refund Amount Griefing (Dust Attack)

**Category:** Denial of service / storage spam  
**STRIDE:** Denial of Service  
**Likelihood:** Medium  
**Impact:** Low

#### Threat Description

An attacker with a legitimate payment relationship (payer or merchant) initiates thousands of refund requests each for 1 stroop. The goals are to:

- Inflate the per-order refund list in contract storage, increasing read and write costs for all future operations on that order.
- Make `get_refunds_for_order` prohibitively expensive or slow for legitimate users.
- Consume the merchant's XLM balance through ledger entry rent fees.

#### Mitigation

`initiate_refund` enforces a minimum refund amount configured by the admin:

```rust
if amount < storage::get_min_refund_amount(&env) {
    return Err(ContractError::RefundBelowMinimum);
}
```

The default minimum is **100 stroops**, configurable upward via `set_min_refund_amount`. Soroban storage fees are proportional to the number and size of ledger entries, so increasing the minimum raises the cost per spam attempt.

Additionally, the cumulative over-refund check (T2) bounds the total number of refunds that can be created for any given payment to `floor(payment.amount / min_refund_amount)`, providing a natural cap.

**Residual risk:** Low. If the minimum is set very low by an admin, dust attacks become cheaper. Monitoring of per-order refund counts is recommended.

---

### T8 — Race Condition in Concurrent Refund Approvals

**Category:** Concurrency / TOCTOU  
**STRIDE:** Tampering  
**Likelihood:** Low  
**Impact:** Medium

#### Threat Description

Two separate sessions (e.g., two admin browser tabs, or a merchant and an admin) both read a refund record in `Pending` state and both submit an `approve_refund` transaction to the network within the same ledger. A naive implementation might allow both to succeed, creating an inconsistent state or double-approving the refund.

#### Mitigation

Soroban's execution model provides a strong guarantee: **only one transaction per ledger entry can be committed per ledger close**. Transactions that conflict on the same storage key are subject to footprint conflict resolution — the second transaction in the same ledger that attempts to write the refund record will be rejected at the host level.

At the contract level, `approve_refund` additionally gates on the current status:

```rust
if !matches!(refund.status, RefundStatus::Pending) {
    return Err(ContractError::RefundAlreadyCompleted);
}
```

If the first transaction commits and changes the status to `Approved`, any subsequent `approve_refund` call for the same `refund_id` will fail with `RefundAlreadyCompleted`, regardless of when the second transaction was submitted.

**Residual risk:** None under Soroban's single-writer ledger model.

---

## Out of Scope

The following threats are noted but are outside the scope of the refund/chargeback flow specifically:

- **Front-running of payment transactions** — covered in the payment processing threat model.
- **Token contract vulnerabilities** — LumenFlow relies on the Stellar SAC (Stellar Asset Contract) for token transfers; vulnerabilities in the token contract are out of scope here.
- **Wallet/key compromise on the client side** — mitigated operationally, not by the contract.
- **Network-level Stellar node attacks** — outside the contract's trust boundary.

---

## Recommendations Summary

| Priority | Recommendation |
|----------|---------------|
| High | Store admin key in an HSM or use a multisig admin address with threshold ≥ 2 |
| High | Monitor `lumenflow/refund_approved` events and alert on high-value approvals |
| Medium | Implement merchant co-approval requirement for admin-approved refunds above a threshold (future feature) |
| Medium | Document and enforce the invariant that `payment_cleanup_period > refund_window` in configuration validation |
| Low | Set `min_refund_amount` to a value that makes dust attacks economically unattractive |
| Low | Monitor per-order refund counts and alert on unusually high volumes |

---

## References

- [Refund Lifecycle State Diagram](../refund-lifecycle.md)
- [Contract Error Codes](../errors.md)
- [Admin Configuration API](../../README.md#admin-configuration)
- [Monitoring Guide](../monitoring.md)
- [Secrets and Local Environment Setup](../secrets-and-local-env.md)
- OWASP Smart Contract Top 10
- Stellar Soroban Security Model: https://soroban.stellar.org/docs/fundamentals-and-concepts/authorization
