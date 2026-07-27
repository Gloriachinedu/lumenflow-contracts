# Merchant Payout and Settlement Reporting

**Issue:** [#371](https://github.com/Gloriachinedu/lumenflow-contracts/issues/371)  
**Status:** Backlog / Planning  
**Priority:** Low  
**Effort:** Medium  
**Labels:** product, feature, planning

---

## Overview

This document defines the product specification for merchant payout reports and
settlement summaries within LumenFlow. It describes the reporting requirements,
data sources, output formats, and the contract/statistics data needed to implement
the feature.

---

## Problem Statement

Merchants currently have no structured way to export or review their payout history
in a format suitable for accounting, tax reconciliation, or treasury management.
The on-chain payment history API provides raw transaction records, but there is no
aggregated settlement view, no payout scheduling model, and no export capability.

---

## Goals

1. Allow merchants to generate a settlement summary covering a given date range.
2. Provide itemised payout records with enough detail for accounting purposes.
3. Support export in standard formats (CSV, JSON) for integration with bookkeeping
   tools such as QuickBooks, Xero, or Wave.
4. Define a payout frequency model so merchants can understand when funds are
   considered "settled."

---

## Non-Goals (this spec)

- Automatic fund sweeping or off-chain bank transfers — not applicable; LumenFlow
  settles directly on-chain on each `process_payment_with_signature` call.
- Fiat currency conversion — out of scope for this phase.
- Multi-currency netting across different tokens in a single report line.

---

## Payout Model

Because LumenFlow processes payments directly on Stellar, there is no custodied
payout batch; funds reach the merchant's wallet on each completed payment. A
"settlement" in LumenFlow's context is the aggregate of all `Completed` payments
within a period, net of fully executed refunds.

### Settlement Calculation

```
Net Settlement = Σ(completed_payments.amount)
              − Σ(executed_refunds.amount)
              − Σ(platform_fees.amount)   [if fee module is active]
```

### Payout Frequency

Since each payment settles immediately on-chain, "payout frequency" in reporting
terms refers to the period over which the merchant chooses to aggregate their
report: daily, weekly, monthly, or custom date range.

---

## Report Fields

### Settlement Summary (header)

| Field | Type | Description |
|---|---|---|
| `merchant_address` | `Address` | Merchant Stellar account |
| `merchant_name` | `String` | Merchant display name |
| `period_start` | `Timestamp` | Start of the reporting period (Unix seconds) |
| `period_end` | `Timestamp` | End of the reporting period (Unix seconds) |
| `total_payments` | `u64` | Count of completed payments in the period |
| `gross_volume` | `i128` | Sum of all completed payment amounts (stroops) |
| `total_refunds` | `u64` | Count of executed refunds in the period |
| `refunded_amount` | `i128` | Sum of executed refund amounts (stroops) |
| `platform_fees` | `i128` | Sum of platform fees deducted (stroops; 0 if no fee module) |
| `net_settlement` | `i128` | `gross_volume − refunded_amount − platform_fees` |
| `token_address` | `Address` | Asset used for this settlement line |
| `generated_at` | `Timestamp` | Report generation timestamp |

> Note: If a merchant received payments in multiple tokens, a separate summary
> row is produced per token address.

### Itemised Payout Records (line items)

| Field | Type | Description |
|---|---|---|
| `order_id` | `String` | Payment order identifier |
| `paid_at` | `Timestamp` | Payment completion timestamp |
| `amount` | `i128` | Payment amount in stroops |
| `token_address` | `Address` | Asset used |
| `status` | `PaymentStatus` | `Completed` / `PartiallyRefunded` / `FullyRefunded` |
| `refunded_amount` | `i128` | Total refunded against this payment (stroops) |
| `net_amount` | `i128` | `amount − refunded_amount` |
| `memo` | `String` (optional) | Payment memo / invoice reference |

---

## Contract / Statistics Data Required

The following existing contract endpoints provide the data needed for this report:

| Data needed | Contract method | Auth |
|---|---|---|
| Paginated payment list with date filter | `get_merchant_payment_history` (with `date_start`/`date_end` filter) | Merchant |
| Per-payment refund details | `get_refunds_for_order` | Merchant |
| Merchant name and verification status | `get_merchant` | Public |
| Platform fee configuration | `set_platform_fee` / admin-controlled config | Admin read |
| Aggregate merchant stats | `get_merchant_stats` | Merchant |

### Gaps / New Contract Work Required

| Gap | Description | Priority |
|---|---|---|
| Fee ledger per payment | Currently `get_merchant_stats` does not return per-payment fee amounts. A `platform_fee` field on `PaymentRecord` or a fee ledger endpoint would be needed for exact fee reporting. | Medium |
| Per-token aggregation | `get_merchant_stats` returns a single volume figure. Multi-token merchants need per-token breakdown. | Medium |
| Report generation endpoint | An optional `get_settlement_report(merchant, period_start, period_end)` contract method could pre-aggregate data on-chain, reducing client-side pagination logic. | Low |

---

## Export Formats

### CSV

```
order_id,paid_at,amount,token_address,status,refunded_amount,net_amount,memo
ORDER_001,2026-06-01T10:00:00Z,50000000,CDLZFC3...,Completed,0,50000000,Invoice #001
ORDER_002,2026-06-02T14:30:00Z,25000000,CDLZFC3...,PartiallyRefunded,10000000,15000000,Invoice #002
```

### JSON

```json
{
  "summary": {
    "merchant_address": "GBXGQ...",
    "merchant_name": "Demo Store",
    "period_start": "2026-06-01T00:00:00Z",
    "period_end": "2026-06-30T23:59:59Z",
    "total_payments": 42,
    "gross_volume": 2100000000,
    "total_refunds": 3,
    "refunded_amount": 75000000,
    "platform_fees": 0,
    "net_settlement": 2025000000,
    "token_address": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    "generated_at": "2026-07-01T06:00:00Z"
  },
  "line_items": [ ... ]
}
```

---

## UI / Dashboard Integration

A "Settlement Report" section should be added to the merchant dashboard with:

1. **Date range picker** — select period start and end.
2. **Summary card** — shows gross volume, refunds, fees, and net settlement.
3. **Line-items table** — paginated, sortable by date or amount.
4. **Export buttons** — "Download CSV" and "Download JSON."

This can be built on top of the existing `get_merchant_payment_history` pagination
loop combined with `get_refunds_for_order` fetches. No new contract methods are
strictly required for a v1 implementation.

---

## Implementation Plan

### Phase 1 — Client-side report generation (no new contract methods)

1. Add a `generateSettlementReport(merchant, dateStart, dateEnd)` function to the
   JS SDK that paginates through `get_merchant_payment_history`, fetches refunds
   per payment, and aggregates the summary fields.
2. Add CSV and JSON export utilities.
3. Add a "Settlement Report" panel to `dashboard/merchant-dashboard/app.js`.

### Phase 2 — On-chain aggregation (optional optimisation)

1. Add a `platform_fee` field to `PaymentRecord` in `contracts/lumenflow/src/types.rs`.
2. Add `get_settlement_report` contract method that returns a pre-aggregated
   `SettlementSummary` struct.
3. Update the SDK and dashboard to use the new endpoint.

---

## Acceptance Criteria

- [x] Product spec includes payout frequency model, report fields, and export formats.
- [x] Spec identifies contract/statistics data required (and gaps).
- [x] Added to roadmap / backlog docs (see `ROADMAP.md`).

---

## References

- [`get_merchant_payment_history`](../README.md#payment-history-queries)
- [`get_merchant_stats`](../README.md#payment-history-queries)
- [`get_refunds_for_order`](../README.md#refunds)
- [Merchant Dashboard](../dashboard/merchant-dashboard/)
