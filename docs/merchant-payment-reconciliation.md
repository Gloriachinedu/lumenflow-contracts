# Merchant-Facing Reconciliation Between Payouts and Payments

**Issue:** [#905](https://github.com/Gloriachinedu/lumenflow-contracts/issues/905)
**Status:** Backlog / Planning
**Priority:** Medium
**Effort:** Medium
**Labels:** product, Stellar Wave

---

## Overview

Merchants need a single view that proves every payout they received can be traced
back to the individual payments that funded it, and that every settled payment has
either been paid out or is still pending. This document specifies a
merchant-facing reconciliation report that sits on top of the existing payment
history and payout data.

It builds on [merchant-payout-reporting.md](merchant-payout-reporting.md), which
covers aggregated settlement summaries and export, and
[merchant-payout-reporting.md](merchant-payout-reporting.md)'s data model.

---

## Problem Statement

Today a merchant can list payments and can list payouts, but nothing links the two
sets. When a payout amount does not match a merchant's own expectation there is no
supported way to answer "which payments are in this payout?" or "why is this
payment not yet settled?". Reconciliation is done manually against raw on-chain
records.

---

## Goals

- Produce a reconciliation statement for a merchant over a time range.
- For each payout, list the payment IDs and amounts that compose it.
- Classify every payment in the range as `paid_out`, `pending_payout`,
  `held` (dispute/refund hold), or `excluded` (fees, reversals).
- Surface a reconciliation difference (`expected - reconciled`) that must be zero
  for a clean statement.
- Export the statement as CSV and JSON, consistent with existing report exports.

## Non-Goals

- Changing how payouts are calculated or scheduled on-chain.
- General ledger / double-entry accounting.
- Multi-merchant or platform-wide reconciliation (admin tooling is separate).

---

## Data Model

| Field | Description |
|---|---|
| `statement_id` | Deterministic ID derived from merchant + range |
| `merchant` | Merchant account address |
| `period_start`, `period_end` | Inclusive UTC bounds |
| `payouts[]` | Each: `payout_id`, `settled_at`, `gross`, `fees`, `net`, `payment_ids[]` |
| `payments[]` | Each: `payment_id`, `received_at`, `amount`, `status`, `payout_id?` |
| `totals` | `payments_received`, `paid_out`, `pending_payout`, `held`, `excluded` |
| `difference` | `payments_received - (paid_out + pending_payout + held + excluded)` |

A statement is **balanced** when `difference == 0`.

---

## Behaviour

- The report is derived, read-only, and computed from existing payment and payout
  history; it introduces no new contract state.
- Payments are matched to payouts by the payout's recorded inclusion set; any
  payment with no payout and no active hold is `pending_payout`.
- Payments under an open dispute or partial refund are `held` and excluded from
  `pending_payout` until resolved.
- Rounding is carried explicitly: per-payout fee rounding remainders appear in the
  `excluded` bucket so the statement still balances.

### Failure, Permission, and Boundary Cases

| Case | Expected behaviour |
|---|---|
| Caller is not the merchant (or an authorized delegate/auditor) | `403` / unauthorized; no data returned |
| Range longer than the retention window | Truncated to the retention window with a warning field |
| `period_start > period_end` | `400` validation error |
| No payments in range | Empty statement, `difference == 0`, `balanced: true` |
| Payout spans the range boundary | Payout included if `settled_at` is in range; its payments listed even if received earlier |
| Statement does not balance | Returned with `balanced: false` and a `discrepancies[]` list; never silently adjusted |
| Refund issued after payout | Shown as negative `excluded` line referencing the original payment |

---

## Interfaces

- Dashboard: a "Reconciliation" tab under merchant reporting, with range picker,
  balanced/unbalanced badge, drill-down from payout to payments, and CSV/JSON
  download.
- SDK / API: `getReconciliationStatement({ merchant, periodStart, periodEnd, format })`
  returning the data model above, mirroring the existing payout-report endpoint's
  auth and pagination.

---

## Testing

- Normal path: a range with multiple payouts fully composed of known payments
  produces `balanced: true`.
- Edge case: a payment placed on hold mid-range is classified `held` and the
  statement still balances.
- Failure case: a non-merchant caller is rejected before any data is assembled.

---

## Security and Privacy

- Statements expose only the requesting merchant's own payments and payouts.
- Payer identifiers follow the same masking rules as the existing payment history
  API (see [receipt-privacy-audit.md](receipt-privacy-audit.md)).
- Exports are generated on demand and not retained server-side beyond the existing
  artifact-retention policy.
