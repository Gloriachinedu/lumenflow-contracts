# Disputes, Refunds & Escalation — Story Map

This document describes the on-chain dispute initiation and resolution flow for
LumenFlow. It covers the state machine, contract functions, emitted events, and
how disputes relate to the existing refund lifecycle.

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

### States

| State | Description |
|-------|-------------|
| `Open` | Dispute has been filed; awaiting admin attention. |
| `UnderReview` | Admin is actively investigating. |
| `Escalated` | Dispute requires external arbitration; admin has escalated. |
| `Resolved` | Dispute is closed with a final outcome. |

### Outcomes (set when status → `Resolved`)

| Outcome | Effect |
|---------|--------|
| `MerchantFavor` | No forced refund. Merchant retains funds. |
| `PayerFavor` | Forced token transfer from merchant to payer for the disputed refund amount. |

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
