# ADR-007: Escrow Hold and Release Design

| Field | Value |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-09-24 |
| **Author(s)** | LumenFlow Contributors |
| **Reviewers** | TBD (requires approval from ≥ 2 maintainers before escrow implementation merges) |
| **Related** | #1111 (escrow hold and release functions), #1117 (this ADR) |
| **Linked from** | [docs/escrow-guide.md](../escrow-guide.md) |

---

## Context

Issue #1111 introduces escrow hold/release functionality to LumenFlow. Unlike a direct payment, an escrow hold locks funds on-chain pending the satisfaction of a condition (e.g. delivery confirmation, dispute resolution, time-lock expiry). The escrow can be released to the recipient, partially released, or clawed back to the payer depending on outcome.

Several design dimensions have significant tradeoffs and must be settled before implementation is finalised:

1. Where is condition evaluation performed — on-chain or off-chain?
2. How is the arbiter role modelled and selected?
3. How does the timeout mechanism work?
4. Should partial release be supported, and how is it accounted for?

This ADR records the decisions made, the alternatives considered, and the consequences.

---

## Problem Statement

A naïve escrow (hold funds, release on admin command) is too permissive — it concentrates trust in a single admin key. A fully on-chain condition evaluator is too restrictive — it cannot reason about real-world events (delivery, KYC, etc.) and would inflate contract size beyond the 128 KB Soroban limit.

We need a design that:
- Keeps the trust surface small and auditable.
- Supports real-world condition evaluation without putting complex logic on-chain.
- Handles disputes, timeouts, and partial releases in a predictable way.
- Fits within Soroban's instruction and storage limits.

---

## Decision

### 1. Condition evaluation: condition-hash mechanism (hybrid on/off-chain)

**Decision:** Conditions are represented on-chain as a SHA-256 hash of a structured condition document. Off-chain evaluators compute whether the condition is met and submit the pre-image of the hash to release the escrow. The contract verifies the hash on-chain but does not interpret the condition document.

**Rationale:** Pure on-chain evaluation is infeasible for real-world events. Pure off-chain evaluation with no on-chain binding allows the arbiter to substitute a different condition unilaterally. The hash mechanism binds the arbiter to the agreed condition at creation time while keeping evaluation logic off-chain.

**Consequences:**
- The condition document must be stored off-chain (e.g. IPFS, merchant backend) and shared with all parties at escrow creation.
- A malicious arbiter cannot change the condition after creation, but they can still refuse to evaluate or collude.
- The pre-image is revealed on-chain at release time and is permanently visible in ledger history.

---

### 2. Arbiter role model: named arbiter with optional admin fallback

**Decision:** Each escrow specifies exactly one arbiter address at creation time. The arbiter may be:
- The merchant (for simple delivery confirmation).
- A trusted third party (for complex disputes).
- The LumenFlow admin (as a fallback if no other arbiter is specified).

If the arbiter is unresponsive within the timeout window, the LumenFlow admin may act as fallback arbiter.

**Rationale:** A single named arbiter keeps the authorization logic simple and auditable. A multi-arbiter model would require threshold logic (similar to multisig) that adds significant complexity and gas cost. The admin-fallback ensures funds are never permanently frozen.

**Alternatives considered:**
- **Decentralized arbiter registry** — rejected; adds governance complexity and is out of scope for v1.
- **Multisig arbiter threshold** — deferred to a future ADR; reusable multisig logic from the existing `MultisigPayment` feature may be adapted in a later iteration.
- **No arbiter (payer/merchant bilateral)** — rejected; deadlock is possible if payer and merchant disagree, with no resolution path.

**Consequences:**
- Arbiter identity must be agreed upon and set at escrow creation; it cannot be changed afterwards.
- If the named arbiter's key is compromised, the admin fallback provides recovery.
- The arbiter's address must be a registered LumenFlow merchant or a Stellar account; contract addresses are disallowed.

---

### 3. Timeout mechanism: ledger-sequence-based expiry with configurable duration

**Decision:** Each escrow has an `expires_at_ledger` field set at creation time. The default expiry duration is configurable by the admin via `set_escrow_expiry_duration` (analogous to `set_multisig_expiry_duration`). When `env.ledger().sequence() >= expires_at_ledger`, the escrow can be claimed back by the payer without arbiter approval.

**Rationale:** Ledger sequence numbers are monotonically increasing and cannot be manipulated by validators, making them more reliable than wall-clock timestamps for expiry enforcement. The configurable default allows the admin to tune the window for different use cases.

**Alternatives considered:**
- **Timestamp-based expiry** — rejected for escrow specifically; ledger timestamps can drift and validators have limited ability to set them outside a narrow band, but ledger sequence is strictly deterministic.
- **Fixed hardcoded timeout** — rejected; different merchant categories have different reasonable escrow durations (e.g. digital goods vs. international shipping).

**Consequences:**
- Clients must be aware that "100 ledgers" ≈ 8 minutes at 5-second ledger times but this can vary on the network.
- The contract must check expiry on every `release_escrow`, `dispute_escrow`, and `reclaim_escrow` call.
- Expired escrows can be reclaimed by the payer without arbiter action; this should be clearly communicated to merchants.

---

### 4. Partial release: supported, with cumulative accounting

**Decision:** Partial releases are supported. Each `release_escrow` call may specify an `amount` ≤ the remaining held amount. The contract tracks `released_amount` and `held_amount` analogously to `refunded_amount` on `PaymentOrder`. The escrow status transitions through `Active → PartiallyReleased → FullyReleased`.

**Rationale:** Many real-world escrow scenarios (e.g. milestone-based project payments, staged goods delivery) require partial releases. The accounting model is a direct analogue of the existing partial-refund pattern, which is already well-tested and understood.

**Alternatives considered:**
- **All-or-nothing release** — simpler, but excludes milestone payment use cases. Deferred as an optional `atomic` flag per escrow.
- **Multiple independent sub-escrows** — each milestone could be a separate escrow record. Rejected for v1 as it multiplies storage cost and UX complexity; can be composed by the caller.

**Consequences:**
- `EscrowRecord` must carry `held_amount`, `released_amount`, and a `status` enum similar to `PaymentStatus`.
- The arbiter must specify the release amount on each call; releasing 0 is an error.
- Cumulative released amount cannot exceed the original held amount (checked on every partial release, analogous to `RefundExceedsOriginal`).
- `reclaim_escrow` (timeout path) always reclaims the full remaining held amount; partial reclaim is not supported.

---

## Data Structures (proposed)

```rust
#[contracttype]
pub enum EscrowStatus {
    Active,
    PartiallyReleased,
    FullyReleased,
    Reclaimed,
    Disputed,
}

#[contracttype]
pub struct EscrowRecord {
    pub escrow_id: String,
    pub payer: Address,
    pub recipient: Address,
    pub arbiter: Address,
    pub token: Address,
    pub held_amount: i128,
    pub released_amount: i128,
    pub condition_hash: Bytes,       // SHA-256 of condition document
    pub status: EscrowStatus,
    pub created_at: u64,
    pub expires_at_ledger: u32,
}
```

---

## New Error Codes (proposed)

| Code | Name | Description |
|---|---|---|
| 80 | `EscrowNotFound` | No escrow exists with the given ID |
| 81 | `EscrowAlreadyExists` | An escrow with this ID already exists |
| 82 | `EscrowExpired` | The escrow window has elapsed |
| 83 | `EscrowNotActive` | Escrow is not in Active/PartiallyReleased state |
| 84 | `EscrowConditionMismatch` | Pre-image does not match the condition hash |
| 85 | `EscrowReleaseExceedsHeld` | Release amount would exceed remaining held amount |

---

## New Contract Entry Points (proposed)

| Function | Caller | Description |
|---|---|---|
| `hold_escrow` | payer | Lock funds; set arbiter and condition hash |
| `release_escrow` | arbiter | Release `amount` to recipient after verifying condition pre-image |
| `reclaim_escrow` | payer | Reclaim remaining funds after expiry |
| `dispute_escrow` | payer or recipient | Flag for admin/arbiter review |
| `get_escrow` | any party or admin | Read escrow record |

---

## Alternatives Considered (summary)

| Alternative | Reason Rejected |
|---|---|
| Fully on-chain condition evaluation | Exceeds WASM size limit; cannot reason about real-world events |
| Decentralised arbiter registry | Out of scope for v1; governance complexity |
| Multisig arbiter threshold | Deferred; can reuse MultisigPayment logic in v2 |
| Timestamp-based expiry | Less reliable than ledger sequence for strict enforcement |
| All-or-nothing release only | Excludes milestone payment use cases |
| Multiple sub-escrows per milestone | Higher storage cost; composable by caller |

---

## Consequences

**Positive:**
- Condition binding via hash prevents arbiter from changing agreed terms after creation.
- Ledger-sequence expiry is tamper-proof and deterministic.
- Partial release supports milestone payments without additional contract complexity.
- Admin fallback prevents funds being permanently frozen.

**Negative / Risks:**
- Condition documents must be stored and preserved off-chain; loss of the document prevents verification.
- A single named arbiter is a trust bottleneck; key compromise requires admin intervention.
- Pre-image is revealed on-chain at release — condition data becomes permanently public.
- Partial release tracking adds ~40 bytes per escrow to on-chain storage.

---

## Review Requirements

This ADR must be reviewed and approved by **at least two maintainers** (see [GOVERNANCE.md](../../GOVERNANCE.md)) before the escrow implementation in #1111 is merged. Approval should be recorded by adding reviewer names and dates to the table at the top of this document.
