# Disputes, Refunds & Escalation — Story Map

This document describes the on-chain dispute initiation and resolution flow for
LumenFlow. It covers the state machine, contract functions, emitted events, and
how disputes relate to the existing refund lifecycle.

It also documents **v1 decentralized dispute resolution**, in which an assigned
third-party arbiter can cast a binding vote that resolves a dispute — and
immediately releases or refunds funds — without admin involvement. See
[`docs/adr/ADR-arbiter-model.md`](./adr/ADR-arbiter-model.md) for the design
rationale behind the arbiter model.

---

## Dispute State Machine

```
                ┌─────────────┐
                │    Open     │◄── initiate_dispute / raise_dispute
                └──────┬──────┘
                       │ mark_dispute_under_review (admin)
                       ▼
                ┌─────────────┐
                │ UnderReview │
                └──────┬──────┘
          ┌────────────┴───────────────┐
          │ escalate_dispute (admin)   │ resolve_dispute (admin)
          ▼                            ▼
   ┌─────────────┐          ┌───────────────────────────────┐
   │  Escalated  │          │  Resolved                     │
   └──────┬──────┘          │  outcome: MerchantFavor       │
          │                 │       or: PayerFavor           │
          └────────────────►└───────────────────────────────┘
                resolve_dispute (admin, after escalation)
```

### Arbiter path (v1 decentralized resolution)

```
   ┌─────────────┐
   │  Escalated  │
   └──────┬──────┘
          │ assign_arbiter (admin)
          ▼
   ┌──────────────────────┐
   │ Escalated + Arbiter  │  arbiter recorded on the DisputeRecord
   └──────┬───────────────┘
          │ arbiter_vote (assigned arbiter only)
          ▼
   ┌───────────────────────────────┐
   │  Resolved                     │
   │  outcome: MerchantFavor       │
   │       or: PayerFavor          │
   │  funds released/refunded      │
   │  immediately on vote          │
   └───────────────────────────────┘
```

An assigned arbiter may vote on a dispute in `Escalated` state. The vote is
binding: it transitions the dispute directly to `Resolved` and triggers the
corresponding fund movement in the same call. No admin action is required after
the vote.

### States

| State | Description |
|-------|-------------|
| `Open` | Dispute has been filed; awaiting admin attention. |
| `UnderReview` | Admin is actively investigating. |
| `Escalated` | Dispute requires external arbitration; admin has escalated. May have an assigned arbiter. |
| `Resolved` | Dispute is closed with a final outcome. |

### Outcomes (set when status → `Resolved`)

| Outcome | Effect |
|---------|--------|
| `MerchantFavor` | No forced refund. Merchant retains funds. |
| `PayerFavor` | Forced token transfer from merchant to payer for the disputed refund amount. |

When the outcome is set by `arbiter_vote`, the effect is applied immediately as
part of the vote transaction (see [`arbiter_vote`](#arbiter_vote)).

---

## Contract Functions

### `initiate_dispute`

**Who can call:** Payer or merchant of the payment.

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $CALLER_KEY --network $NETWORK \
  -- initiate_dispute \
  --caller  $CALLER_ADDR \
  --dispute_id "DISPUTE_001" \
  --order_id   "ORDER_001" \
  --reason  "Item not received"
```

- Creates a `DisputeRecord` in `Open` state.
- Does **not** require a pre-existing refund — the dispute can be filed directly against a payment.
- Emits `lumenflow/dispute_initiated`.
- Only payer or merchant of the referenced order may call this.

### `raise_dispute` *(legacy — refund-based)*

**Who can call:** Payer of the original payment.

Requires the associated refund to already be in `Rejected` state. Use
`initiate_dispute` for the primary dispute flow.

### `mark_dispute_under_review`

**Who can call:** Admin only.

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY --network $NETWORK \
  -- mark_dispute_under_review \
  --admin $ADMIN_ADDR \
  --dispute_id "DISPUTE_001"
```

Transitions `Open → UnderReview`. Emits `lumenflow/dispute_under_review`.

### `escalate_dispute`

**Who can call:** Admin only.

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY --network $NETWORK \
  -- escalate_dispute \
  --admin $ADMIN_ADDR \
  --dispute_id "DISPUTE_001" \
  --notes "Referred to external arbitration panel"
```

Transitions `Open | UnderReview → Escalated`. Emits `lumenflow/dispute_escalated`.

### `resolve_dispute`

**Who can call:** Admin only.

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY --network $NETWORK \
  -- resolve_dispute \
  --admin $ADMIN_ADDR \
  --dispute_id "DISPUTE_001" \
  --resolution "Evidence reviewed; refund approved" \
  --force_refund true
```

- `force_refund = true` → outcome: `PayerFavor`, forced token transfer executed.
- `force_refund = false` → outcome: `MerchantFavor`, no transfer.
- Emits `lumenflow/dispute_resolved`.

### `assign_arbiter`

**Who can call:** Admin only.

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY --network $NETWORK \
  -- assign_arbiter \
  --admin $ADMIN_ADDR \
  --dispute_id "DISPUTE_001" \
  --arbiter $ARBITER_ADDR
```

- Assigns `$ARBITER_ADDR` as the binding arbiter for an `Escalated` dispute.
- Stores the arbiter address on the `DisputeRecord`.
- Re-assigning replaces the previous arbiter (the previous arbiter can no longer
  vote).
- Emits `lumenflow/arbiter_assigned`.
- Writes an `ArbiterAssigned` entry to the admin audit log (see
  [Admin Audit Log](#admin-audit-log)).

### `arbiter_vote`

**Who can call:** The arbiter currently assigned to the dispute (via
`assign_arbiter`). Admins, payers, and merchants cannot call this.

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $ARBITER_KEY --network $NETWORK \
  -- arbiter_vote \
  --arbiter $ARBITER_ADDR \
  --dispute_id "DISPUTE_001" \
  --payer_favor true \
  --notes "Evidence supports payer"
```

- Requires the dispute to be `Escalated` and to have an assigned arbiter.
- Requires `caller == assigned arbiter`; otherwise `Unauthorized` (code 3).
- `payer_favor = true` → outcome: `PayerFavor`; the forced token transfer from
  merchant to payer is executed **immediately** in the same call.
- `payer_favor = false` → outcome: `MerchantFavor`; no transfer, merchant funds
  are released to the merchant immediately.
- Transitions the dispute to `Resolved` and clears the pending arbiter vote.
- Emits `lumenflow/arbiter_voted` and `lumenflow/dispute_resolved`.
- A dispute can be voted on at most once; subsequent votes fail with
  `DisputeAlreadyResolved` (code 113).

### `remove_arbiter`

**Who can call:** Admin only.

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY --network $NETWORK \
  -- remove_arbiter \
  --admin $ADMIN_ADDR \
  --dispute_id "DISPUTE_001"
```

- Clears the assigned arbiter from an `Escalated` dispute. The dispute remains
  `Escalated` and can be re-assigned or resolved by an admin.
- Emits `lumenflow/arbiter_removed`.
- Writes an `ArbiterRemoved` entry to the admin audit log.

### `get_dispute`

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $CALLER_KEY --network $NETWORK \
  -- get_dispute \
  --dispute_id "DISPUTE_001"
```

Returns the full `DisputeRecord` including current status, outcome, and resolution notes.

---

## Events

| Event | Trigger | Data |
|-------|---------|------|
| `lumenflow/dispute_initiated` | `initiate_dispute` called | `(dispute_id, order_id, caller, reason)` |
| `lumenflow/dispute_raised` | `raise_dispute` called (legacy) | `(dispute_id, refund_id, order_id)` |
| `lumenflow/dispute_under_review` | `mark_dispute_under_review` | `(dispute_id,)` |
| `lumenflow/dispute_escalated` | `escalate_dispute` | `(dispute_id, notes)` |
| `lumenflow/dispute_resolved` | `resolve_dispute` | `(dispute_id, resolution, force_refund)` |
| `lumenflow/arbiter_assigned` | `assign_arbiter` | `(dispute_id, arbiter)` |
| `lumenflow/arbiter_removed` | `remove_arbiter` | `(dispute_id, arbiter)` |
| `lumenflow/arbiter_voted` | `arbiter_vote` | `(dispute_id, arbiter, payer_favor)` |

---

## Admin Audit Log

Arbiter selection and removal are recorded in the admin audit log so that
arbiter assignments are traceable on-chain.

| Action | Trigger | Recorded fields |
|--------|---------|-----------------|
| `ArbiterAssigned` | `assign_arbiter` | `admin`, `dispute_id`, `arbiter`, `timestamp` |
| `ArbiterRemoved` | `remove_arbiter` | `admin`, `dispute_id`, `arbiter`, `timestamp` |

Re-assigning an arbiter records an `ArbiterRemoved` entry for the previous
arbiter followed by an `ArbiterAssigned` entry for the new one.

---

## Relationship to Refund Lifecycle

```
Payment → initiate_refund → Pending
                          ↓
                       Rejected ──► raise_dispute (legacy) ──► DisputeRecord
                          │
                          └──► initiate_dispute (new, direct) ──► DisputeRecord
                                      ↓
                              Open → UnderReview → Resolved | Escalated
```

`initiate_dispute` can be called independently of the refund flow. It addresses
the case where a payer wants to raise a dispute without first going through the
refund approval cycle — for example, if a merchant is unresponsive.

---

## Access Control Summary

| Function | Payer | Merchant | Admin |
|----------|-------|----------|-------|
| `initiate_dispute` | ✓ | ✓ | — |
| `raise_dispute` | ✓ | — | — |
| `mark_dispute_under_review` | — | — | ✓ |
| `escalate_dispute` | — | — | ✓ |
| `resolve_dispute` | — | — | ✓ |
| `assign_arbiter` | — | — | ✓ |
| `remove_arbiter` | — | — | ✓ |
| `arbiter_vote` | — | — | — (assigned arbiter only) |
| `get_dispute` | ✓ | ✓ | ✓ |

---

## Error Codes

| Code | Constant | Description |
|------|----------|-------------|
| 110 | `DisputeNotFound` | No dispute exists with the given ID. |
| 111 | `DisputeAlreadyExists` | A dispute with this ID already exists. |
| 112 | `DisputeRefundNotRejected` | `raise_dispute` requires the refund to be `Rejected`. |
| 113 | `DisputeAlreadyResolved` | Cannot modify a resolved dispute. |
| 114 | `DisputeNotOpen` | `mark_dispute_under_review` requires `Open` state. |
| 115 | `DisputeAlreadyEscalated` | Cannot escalate an already-escalated dispute. |
| 116 | `ArbiterNotAssigned` | `arbiter_vote` requires an assigned arbiter. |
| 117 | `ArbiterAlreadyAssigned` | An arbiter is already assigned to this dispute. |
| 118 | `NotAssignedArbiter` | Caller is not the arbiter assigned to this dispute. |
