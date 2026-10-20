# ADR-006: Multisig Payment Expiry Design

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-05-17 |
| **Deciders** | LumenFlow core team |
| **Related issues** | #1071 |
| **Related functions** | `set_multisig_expiry_duration`, `initiate_multisig_payment`, `execute_multisig_payment` |

---

## Context

LumenFlow's multisig payment flow requires multiple authorised signers to reach a threshold before a payment can be executed. During the signature collection phase, funds are not yet transferred — the payment record exists only in contract storage.

Without an expiry mechanism, a multisig payment that never reaches its threshold remains in `Pending` state indefinitely. This has several consequences:

1. **Storage bloat** — stale pending records accumulate in contract storage, increasing ledger fees for every read/write.
2. **Participant confusion** — payers, merchants, and signers have no guaranteed deadline, making escrow-like arrangements impossible to reason about contractually.
3. **Denial-of-service surface** — a bad actor could flood the contract with pending multisig payments, degrading performance for legitimate users.
4. **Auditability** — operations teams need a deterministic window within which to audit and close open payments.

A decision was needed on:
- Whether to support expiry at all.
- How expiry duration should be stored and updated (on-chain vs. off-chain).
- What triggers expiry detection (on-chain clock vs. off-chain cron).
- What happens to an expired payment (auto-cancel vs. manual admin cancellation).

---

## Decision

**Configurable on-chain expiry duration, enforced at execution time, with admin cancellation.**

Specifically:

1. A global `multisig_expiry_duration` (in seconds) is stored in contract storage and is writable only by the admin via `set_multisig_expiry_duration`.
2. The expiry deadline for each payment is computed as `initiated_at + multisig_expiry_duration` and stored in the payment record at initiation time.
3. The `execute_multisig_payment` function rejects execution if `env.ledger().timestamp() > expiry_deadline`.
4. Expired payments are **not** automatically deleted. An admin must call an archival/cancellation function to reclaim storage. This preserves the full audit trail.
5. The default expiry duration is **7 days** (604 800 seconds), adjustable by the admin.

---

## Alternatives Considered

### A. No expiry (rejected)

Allow multisig payments to remain pending indefinitely.

**Rejected because:** Leads to storage bloat and makes it impossible to build reliable business workflows on top of the contract. Audit obligations for financial systems typically require a bounded settlement window.

### B. Hard-coded expiry duration (rejected)

Burn a fixed expiry (e.g., 7 days) into the contract at compile time.

**Rejected because:** Different deployment contexts have different needs. A corporate treasury running 3-of-5 multisig may need 30 days for approval workflows; a high-frequency DeFi integration may need 1 hour. A hard-coded value would require a contract redeployment to change, breaking backwards compatibility.

### C. Per-payment expiry set by the initiator (rejected)

Allow the initiator of each multisig payment to supply their own expiry at initiation time.

**Rejected because:** This shifts policy control away from the platform operator. A rogue or misconfigured initiator could set an expiry of 0 (immediate) or 100 years, undermining the operator's SLA guarantees. Platform-wide consistency is preferable for payment systems.

### D. Off-chain cron-triggered cancellation (rejected)

Store no expiry on-chain; instead rely on an off-chain job to monitor Horizon and call a cancellation function after a predetermined period.

**Rejected because:**
- Introduces an external dependency for correctness: if the cron job fails, expiry is silently missed.
- Off-chain time and on-chain ledger time can diverge (e.g., during network congestion).
- It makes the contract behaviour non-deterministic from the perspective of a block explorer or auditor reading only the contract state.

### E. Automatic on-chain deletion on expiry (rejected)

Have `execute_multisig_payment` (or a separate cleanup function) automatically delete the payment record when expiry is detected.

**Rejected because:** Silent deletion removes the audit trail. A merchant who disputes a payment must be able to retrieve the original record and see that it expired. Admin-controlled archival (with the record marked `Expired`) preserves this history.

---

## Tradeoffs

| Property | This Decision |
|----------|--------------|
| Operator flexibility | ✅ Admin can adjust duration per deployment without redeployment |
| Determinism | ✅ Expiry is stored on-chain; verifiable by anyone reading contract state |
| Audit trail | ✅ Expired records are retained until explicitly archived by admin |
| Storage efficiency | ⚠️ Stale records accumulate until admin runs archival — mitigated by existing `cleanup_expired_payments` tooling |
| Clock dependency | ⚠️ Relies on `env.ledger().timestamp()` (Stellar close time), which can drift slightly from wall-clock time but is canonical within the network |
| Initiator flexibility | ❌ Per-payment expiry is not supported — all payments share the same platform-wide duration |

---

## Consequences

- Operators **must** call `set_multisig_expiry_duration` after deployment if the default 7-day window does not suit their use case.
- Operations teams **should** run periodic archival jobs to clean up expired records and reclaim storage.
- Integrations that build escrow workflows on top of multisig payments can rely on `expiry_deadline` in the payment record to display deadlines in their UIs.
- Any future per-payment-expiry feature would be additive (e.g., an optional `expiry_override` field on initiation) and backward-compatible with this design.

---

## References

- [Multisig Payment Flow Guide](../multisig-guide.md)
- [Stellar Ledger Timestamp documentation](https://developers.stellar.org/docs/learn/fundamentals/stellar-consensus-protocol)
- [ADR-000 through ADR-005](.) — preceding architectural decisions
