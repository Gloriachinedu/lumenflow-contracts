# User Story Map: Disputes, Refunds, and Support Escalation

**Issue:** [#908](https://github.com/Gloriachinedu/lumenflow-contracts/issues/908)
**Status:** Backlog / Planning
**Priority:** Medium
**Effort:** Medium
**Labels:** product, Stellar Wave

---

## Overview

This document maps the end-to-end journey for a payer or merchant who needs to
raise a problem with a completed payment: requesting a refund, opening a dispute,
and escalating to human support. It maps each activity to the roles involved, the
UI surfaces, and the underlying contract calls, and is intended for product
planning and prioritization.

It builds on [user-journeys.md](user-journeys.md) and
[refund-lifecycle.md](refund-lifecycle.md).

### Roles

| Role | Description |
|---|---|
| **Payer** | The person or system that sent the payment |
| **Merchant** | The business that received the payment |
| **Support Agent** | LumenFlow operator handling escalations |
| **Admin** | Privileged operator who can act on stuck cases |

---

## Story Map

Backbone activities run left to right; stories under each are ordered top
(release 1 / walking skeleton) to bottom (later refinement).

### 1. Notice a problem

- Payer sees payment in receipt/history and flags "something's wrong".
- Merchant sees an incoming complaint or a mismatched order.
- Both can open a case from the payment detail view.

### 2. Request a refund (no dispute)

- Payer requests a full or partial refund with a reason code.
- Merchant reviews and approves → `refund` contract call executes.
- Merchant rejects with a note → payer may escalate to a dispute.
- Auto-approval rule for refunds under a merchant-configured threshold.

### 3. Open a dispute

- Payer opens a dispute when a refund is refused or ignored past an SLA timer.
- Funds for that payment are placed on `held` status (see reconciliation doc).
- Both parties submit evidence (text, links, attachments).
- Dispute has states: `open → under_review → resolved_payer | resolved_merchant | withdrawn`.

### 4. Support escalation

- Either party escalates a stalled dispute to a Support Agent.
- Agent triages by priority (amount, age, repeat offender, fraud signal).
- Agent requests more info, or recommends a resolution.
- Admin executes the final on-chain action (`refund` or release of hold).

### 5. Resolution and close

- Outcome recorded with reason code and agent ID.
- Funds released from hold: refunded to payer or paid out to merchant.
- Both parties notified; case becomes read-only.
- Post-resolution: 7-day reopen window for new evidence.

### 6. Learn and prevent

- Dispute rate surfaced in merchant dashboard and reconciliation totals.
- Repeat patterns feed merchant risk scoring and payer fraud signals.

---

## Activity-to-System Map

| Activity | UI surface | Contract / API |
|---|---|---|
| Open case | Payment detail → "Report a problem" | `create_case` (off-chain) |
| Request refund | Case → refund form | `request_refund` |
| Approve refund | Merchant case queue | `refund` |
| Open dispute | Case → escalate | `open_dispute`, sets payment `held` |
| Submit evidence | Dispute thread | `add_evidence` (off-chain, hash anchored) |
| Escalate to support | Dispute → "Contact support" | `escalate_case` |
| Agent resolution | Support console | `recommend_resolution` |
| Final action | Admin console | `refund` or `release_hold` |
| Close | Automatic on final action | `close_case` |

---

## Failure, Permission, and Boundary Cases

| Case | Expected behaviour |
|---|---|
| Refund amount exceeds original payment | Rejected at validation; case stays open |
| Payer opens dispute on an already-refunded payment | Blocked with a clear message; no hold placed |
| Merchant never responds to a refund request | SLA timer expires; payer may open a dispute automatically |
| Both parties go silent during `under_review` | Case auto-escalates to Support Agent after the review SLA |
| Non-party tries to view a case | Unauthorized; cases visible only to payer, merchant, and assigned agents/admin |
| Hold placed but asset issuer clawed back funds | Case flagged `funds_unavailable`; resolved manually by Admin |
| Reopen requested after the 7-day window | Denied; a new case must be opened |
| Duplicate cases for one payment | Second attempt links to the existing open case rather than creating a new one |

---

## Testing

- Normal path: payer requests a refund, merchant approves, funds return to payer,
  case closes.
- Edge case: merchant ignores the request past the SLA, payer opens a dispute,
  the payment moves to `held`, and an agent resolves it in the payer's favour.
- Failure case: a non-party request to read a case is rejected before any case
  data is returned.

---

## Security and Privacy

- Evidence attachments are stored per [artifact-retention.md](artifact-retention.md)
  and referenced by hash on-chain, not by content.
- Case visibility is strictly limited to the parties and assigned staff.
- Reason codes and outcomes are retained for audit; free-text evidence is purged
  after the retention window once the case is closed.
