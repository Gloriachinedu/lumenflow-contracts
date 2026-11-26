# Merchant Payout and Settlement Reporting

**Issues:** [#371](https://github.com/Gloriachinedu/lumenflow-contracts/issues/371), [#1572](https://github.com/Gloriachinedu/lumenflow-contracts/issues/1572), [#1573](https://github.com/Gloriachinedu/lumenflow-contracts/issues/1573)  
**Status:** Implemented (v1)  
**Priority:** Medium  
**Effort:** Large  
**Labels:** product, feature, dashboard, sdk

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

## Merchant Tier System

Merchants are assigned a tier based on their **30-day rolling payment volume**.
Higher tiers receive reduced platform fees. The tier is derived on-chain and is
read-only from the client's perspective.

### Tiers

| Tier | Default fee treatment | Notes |
|---|---|---|
| `Standard` | Full fee | Default for new / low-volume merchants |
| `Silver` | Configurable (default: full fee) | First volume threshold |
| `Gold` | 50% fee reduction (default) | Mid-volume merchants |
| `Platinum` | 0% fee (default) | Highest volume merchants |

The `MerchantTier` enum is exposed by the contract and the SDK:

```ts
enum MerchantTier {
  Standard = 'Standard',
  Silver = 'Silver',
  Gold = 'Gold',
  Platinum = 'Platinum',
}
```

### Tier Assignment

- Volume is computed over a **rolling 30-day window** ending at the current
  ledger timestamp.
- The volume thresholds for each tier are **configurable by the admin** via the
  fee module configuration (see `set_merchant_tier_config` / admin fee config).
- Fee reductions per tier are likewise admin-configurable; the defaults are
  `Standard = full fee`, `Silver = full fee`, `Gold = 50% reduction`,
  `Platinum = 0% fee`.

### Reading the Tier

```ts
const tier: MerchantTier = await client.getMerchantTier(merchantAddress);
```

`get_merchant_tier` is a **read-only** entrypoint (no auth required) that returns
the merchant's current tier. The dashboard uses it to display the current tier
and the volume threshold required to reach the next tier.

### Dashboard Display

The merchant dashboard shows:

1. **Current tier badge** (Standard / Silver / Gold / Platinum).
2. **Next tier threshold** — the 30-day volume needed to advance, plus the
   merchant's current rolling volume.
3. **Effective fee rate** — the fee percentage applied at the current tier.

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
| Merchant tier | `get_merchant_tier` | Public |

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

The merchant dashboard (`dashboard/merchant-dashboard/app.js`) includes a
**Settlement Report** panel with:

1. **Date range picker** — select period start and end.
2. **Summary card** — shows gross volume, refunds, fees, and net settlement.
3. **Line-items table** — itemised payments with amount, fee, net, and
   timestamp; paginated and sortable by date or amount.
4. **Export buttons** — "Download CSV" and "Download JSON."
5. **Tier badge** — current tier and next-tier threshold (see
   [Merchant Tier System](#merchant-tier-system)).

The layout is **mobile-responsive**: the summary card stacks above the
line-items table on narrow viewports, and the table scrolls horizontally.

### How Totals Are Derived

The summary card's totals are taken directly from the contract's
`get_merchant_stats` values so the dashboard and on-chain figures always agree:

| Summary field | Source |
|---|---|
| `total_payments` | `get_merchant_stats.total_payments` (period-scoped) |
| `gross_volume` | `get_merchant_stats.total_volume` |
| `refunded_amount` | `get_merchant_stats.total_refunded` |
| `platform_fees` | `get_merchant_stats.total_fees` |
| `net_settlement` | `gross_volume − refunded_amount − platform_fees` |

Line items are fetched via the `get_merchant_payment_history` pagination loop
combined with `get_refunds_for_order`; their summed `amount`, `fee`, and
`net_amount` must reconcile with the `get_merchant_stats` totals above (this is
asserted in the dashboard's export path).

### Export Formats

Both exports are generated client-side from the same in-memory report object, so
CSV and JSON always contain identical data.

**CSV** — one row per line item, with a header row:

```
order_id,paid_at,amount,fee,net_amount,token_address,status,refunded_amount,memo
ORDER_001,2026-06-01T10:00:00Z,50000000,250000,49750000,CDLZFC3...,Completed,0,Invoice #001
ORDER_002,2026-06-02T14:30:00Z,25000000,125000,24875000,CDLZFC3...,PartiallyRefunded,10000000,Invoice #002
```

**JSON** — a `summary` object (matching the `get_merchant_stats`-derived totals)
plus a `line_items` array:

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
    "platform_fees": 10500000,
    "net_settlement": 2014500000,
    "token_address": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    "generated_at": "2026-07-01T06:00:00Z"
  },
  "line_items": [ ... ]
}
```

### SDK Types Added

The v1 implementation adds the following TypeScript SDK types
(`@lumenflow/sdk`):

```ts
enum MerchantTier {
  Standard = 'Standard',
  Silver = 'Silver',
  Gold = 'Gold',
  Platinum = 'Platinum',
}

interface MerchantTierInfo {
  tier: MerchantTier;
  rollingVolume: bigint;      // 30-day rolling volume (stroops)
  nextTier: MerchantTier | null;
  nextTierThreshold: bigint;  // volume required for nextTier (stroops)
  feeBps: number;             // effective fee in basis points at this tier
}

interface SettlementSummary {
  merchantAddress: string;
  merchantName: string;
  periodStart: bigint;
  periodEnd: bigint;
  totalPayments: bigint;
  grossVolume: bigint;
  totalRefunds: bigint;
  refundedAmount: bigint;
  platformFees: bigint;
  netSettlement: bigint;
  tokenAddress: string;
  generatedAt: bigint;
}

interface SettlementLineItem {
  orderId: string;
  paidAt: bigint;
  amount: bigint;
  fee: bigint;
  netAmount: bigint;
  tokenAddress: string;
  status: PaymentStatus;
  refundedAmount: bigint;
  memo?: string;
}
```

New client methods:

```ts
client.getMerchantTier(merchant: string): Promise<MerchantTierInfo>;
client.getSettlementReport(merchant: string, periodStart: bigint, periodEnd: bigint): Promise<SettlementReport>;
```

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

### Payout reporting (#371)

- [x] Product spec includes payout frequency model, report fields, and export formats.
- [x] Spec identifies contract/statistics data required (and gaps).
- [x] Added to roadmap / backlog docs (see `ROADMAP.md`).

### Merchant tier system (#1572)

- [x] `MerchantTier` enum: `Standard`, `Silver`, `Gold`, `Platinum`.
- [x] Tier assigned based on 30-day rolling payment volume.
- [x] Fee reduction per tier configurable by admin (default: Standard=full fee, Gold=50%, Platinum=0%).
- [x] `get_merchant_tier` read-only entrypoint.
- [x] Dashboard shows current tier and next tier threshold.
- [x] SDK types and docs updated.

### Payout reporting dashboard (#1573)

- [x] Dashboard page shows settlement summary for a selected date range.
- [x] Itemised payment list with amount, fee, net, and timestamp.
- [x] CSV and JSON export buttons work correctly.
- [x] Totals match contract `get_merchant_stats` values.
- [x] Mobile-responsive layout.

---

## Accounting Integration (QuickBooks / Xero)

This section documents the specific SDK methods, data mappings, and sample
scripts that accounting integrations (QuickBooks, Xero, Wave) should use for
**automated reconciliation** of LumenFlow payouts. It builds on the settlement
reporting model above and the reconciliation statement described in
[`merchant-payment-reconciliation.md`](merchant-payment-reconciliation.md).

### Recommended SDK Methods

All reconciliation data is read-only and available through the TypeScript SDK
(`@lumenflow/sdk`). The table below lists the methods an accounting integration
should call, in the order a typical reconciliation workflow uses them.

| Step | SDK method | Returns | Auth | Purpose |
|---|---|---|---|---|
| 1 | `client.getMerchant(address)` | `Merchant` | Public | Resolve merchant display name + registered timestamp. |
| 2 | `client.getMerchantPaymentHistory(merchant, cursor, limit, filter, sortField, sortOrder)` | `PaymentPage` | Merchant | Paginated list of payments in the period (filter by `dateStart`/`dateEnd` and `status: StatusFilter.Completed`). |
| 3 | `client.getRefundsForOrder(caller, orderId)` | `RefundRecord[]` | Merchant / Payer / Admin | Per-payment refund details needed to compute `refunded_amount` and `net_amount`. |
| 4 | `client.getGlobalPaymentStats(admin, dateStart, dateEnd)` | `GlobalStats` | Admin | Platform-wide totals for cross-checking a merchant's figures. |

> **Note:** `getMerchantPaymentHistory` accepts a `PaymentFilter` with
> `dateStart`, `dateEnd`, `amountMin`, `amountMax`, `token`, `status`, and `tag`
> fields, so you can request only `Completed` payments for a given period and
> token in a single call. Sort with `SortField.Date` + `SortOrder.Ascending`
> for deterministic, cursor-stable pagination.

#### Method Signatures (TypeScript)

```ts
import {
  LumenFlowClient,
  SortField,
  SortOrder,
  StatusFilter,
  type PaymentFilter,
  type PaymentPage,
  type RefundRecord,
  type Merchant,
} from '@lumenflow/sdk';

// 1. Merchant profile
const merchant: Merchant = await client.getMerchant(merchantAddress);

// 2. Paginated payment history (filtered to the reconciliation period)
const filter: PaymentFilter = {
  dateStart: BigInt(periodStartSeconds),
  dateEnd: BigInt(periodEndSeconds),
  status: StatusFilter.Completed,
};
const page: PaymentPage = await client.getMerchantPaymentHistory(
  merchantAddress,
  null,           // cursor — null for first page
  200,            // limit (max recommended page size)
  filter,
  SortField.Date,
  SortOrder.Ascending,
);

// 3. Refunds for a single order
const refunds: RefundRecord[] = await client.getRefundsForOrder(
  callerAddress,
  orderId,
);
```

### Data Mapping to Standard Accounting Fields

Accounting packages expect a small, fixed set of fields. The table below maps
LumenFlow `PaymentOrder` and `RefundRecord` fields to the standard accounting
bookkeeping fields (QuickBooks / Xero invoice and payment concepts).

| Accounting field | LumenFlow source | Notes |
|---|---|---|
| Invoice ID | `PaymentOrder.orderId` | Use `order_id` as the invoice/document reference. |
| Amount | `PaymentOrder.amount` (stroops) | Convert stroops → display units: `amount / 10_000_000`. |
| Date | `PaymentOrder.paidAt` (Unix seconds) | ISO-8601: `new Date(Number(paidAt) * 1000).toISOString()`. |
| Status | `PaymentOrder.status` | `Completed`, `PartiallyRefunded`, or `FullyRefunded`. |
| Customer / Payer | `PaymentOrder.payer` | Stellar address; mask per [receipt-privacy-audit.md](receipt-privacy-audit.md). |
| Currency / Token | `PaymentOrder.token` | Stellar asset contract ID; map to an accounting currency code. |
| Refund amount | `Σ RefundRecord.amount` (stroops) | Sum of executed refunds for the order (`status === 'Completed'`). |
| Net amount | `amount − refundedAmount` | The settled value that should match the payout line. |
| Memo / Note | `PaymentOrder.memo` | Free-text reference; may carry an external invoice number. |

> **QuickBooks tip:** map `orderId` → `DocNumber`, `amount` (converted) →
> `TotalAmt`, and `paidAt` → `TxnDate` on a `Payment` object. **Xero tip:**
> map the same fields onto an `Invoice` with `Type: "ACCREC"` and set
> `Status: "AUTHORISED"` for `Completed` payments.

### Pagination Strategy for Large Transaction Sets

`getMerchantPaymentHistory` is **cursor-based**: each `PaymentPage` returns a
`nextCursor` string (an `order_id`) that, when passed as the `cursor` argument
on the next call, yields the following page. The strategy for reconciliation is:

1. **Start with `cursor = null`** and `limit` set to the largest page the contract
   allows (200 is a safe default; the contract caps single-page size).
2. **Loop until `nextCursor` is undefined / empty.** On each iteration, pass the
   previous `nextCursor` as the new `cursor`.
3. **Accumulate into the summary incrementally.** Add each page's payments to the
   running `gross_volume`, and fetch refunds per order (step 3 above) — cache refund
   results by `orderId` to avoid re-fetching across overlapping reconciliation runs.
4. **Sort once, ascending by date.** Using `SortField.Date` + `SortOrder.Ascending`
   guarantees stable, monotonic cursor progress so a late-arriving payment never
   appears in an earlier page.
5. **Bound the run.** For periods with more than ~50 000 payments, break the range
   into sub-periods (e.g. weekly) and reconcile each sub-period independently,
   then sum the sub-totals. This keeps any single pagination loop within the
   retention window and avoids ledger-range limits.

```ts
async function fetchAllPayments(
  client: LumenFlowClient,
  merchant: string,
  filter: PaymentFilter,
): Promise<PaymentOrder[]> {
  const all: PaymentOrder[] = [];
  let cursor: string | null = null;
  do {
    const page = await client.getMerchantPaymentHistory(
      merchant, cursor, 200, filter, SortField.Date, SortOrder.Ascending,
    );
    all.push(...page.payments);
    cursor = page.nextCursor ?? null;
  } while (cursor);
  return all;
}
```

### Sample Node.js Reconciliation Script

The script below fetches all completed payments for a merchant in a date range,
collects refunds, maps the data to accounting fields, and emits a JSON array
suitable for ingestion by QuickBooks/Xero importers. It is also a template for a
nightly cron reconciliation job.

```js
#!/usr/bin/env node
/**
 * reconcile.js — LumenFlow → accounting reconciliation export.
 *
 * Usage:
 *   LUMENFLOW_CONTRACT_ID=CA... \
 *   LUMENFLOW_RPC_URL=https://soroban-testnet.stellar.org \
 *   MERCHANT=G... \
 *   CALLER=G... \
 *   node reconcile.js 2026-01-01 2026-01-31 > january-settlement.json
 *
 * Requires: npm install @lumenflow/sdk
 */
const { LumenFlowClient, SortField, SortOrder, StatusFilter } = require('@lumenflow/sdk');

const STROOPS_PER_UNIT = 10_000_000; // 1 unit = 10^7 stroops

function toIso(seconds) {
  return new Date(Number(seconds) * 1000).toISOString();
}

function toDisplayAmount(stroops) {
  return Number(BigInt(stroops)) / STROOPS_PER_UNIT;
}

async function main() {
  const [startArg, endArg] = process.argv.slice(2);
  if (!startArg || !endArg) {
    console.error('Usage: node reconcile.js <YYYY-MM-DD> <YYYY-MM-DD>');
    process.exit(1);
  }

  const periodStart = BigInt(Date.parse(startArg + 'T00:00:00Z') / 1000);
  const periodEnd   = BigInt(Date.parse(endArg   + 'T23:59:59Z') / 1000);

  const merchant = process.env.MERCHANT;
  const caller   = process.env.CALLER;
  if (!merchant || !caller) {
    console.error('Set MERCHANT and CALLER environment variables.');
    process.exit(1);
  }

  const client = new LumenFlowClient({
    contractId: process.env.LUMENFLOW_CONTRACT_ID,
    rpcUrl: process.env.LUMENFLOW_RPC_URL,
    networkPassphrase: process.env.LUMENFLOW_NETWORK_PASSPHRASE,
  });

  // 1. Merchant profile (display name for the accounting reference)
  const merchantProfile = await client.getMerchant(merchant);

  // 2. Paginate through all completed payments in the period
  const filter = {
    dateStart: periodStart,
    dateEnd: periodEnd,
    status: StatusFilter.Completed,
  };
  const payments = [];
  let cursor = null;
  do {
    const page = await client.getMerchantPaymentHistory(
      merchant, cursor, 200, filter, SortField.Date, SortOrder.Ascending,
    );
    payments.push(...page.payments);
    cursor = page.nextCursor ?? null;
  } while (cursor);

  // 3. Fetch refunds per order (cached by orderId)
  const refundCache = new Map();
  const records = [];
  for (const p of payments) {
    let refunds = refundCache.get(p.orderId);
    if (!refunds) {
      refunds = await client.getRefundsForOrder(caller, p.orderId);
      refundCache.set(p.orderId, refunds);
    }
    const executedRefundAmount = refunds
      .filter((r) => r.status === 'Completed')
      .reduce((sum, r) => sum + BigInt(r.amount), 0n);

    records.push({
      // ── Accounting-standard fields ──
      invoice_id: p.orderId,
      amount: toDisplayAmount(p.amount),
      date: toIso(p.paidAt),
      status: p.status, // Completed | PartiallyRefunded | FullyRefunded
      // ── Supplementary accounting fields ──
      customer: p.payer,
      currency_token: p.token,
      memo: p.memo,
      refunded_amount: toDisplayAmount(executedRefundAmount),
      net_amount: toDisplayAmount(BigInt(p.amount) - executedRefundAmount),
    });
  }

  // 4. Emit a settlement summary + line items, ready for accounting import
  const grossVolume = records.reduce((s, r) => s + r.amount, 0);
  const refundedTotal = records.reduce((s, r) => s + r.refunded_amount, 0);
  const output = {
    summary: {
      merchant_address: merchant,
      merchant_name: merchantProfile.name,
      period_start: toIso(periodStart),
      period_end: toIso(periodEnd),
      total_payments: records.length,
      gross_volume: grossVolume,
      total_refunds: records.filter((r) => r.refunded_amount > 0).length,
      refunded_amount: refundedTotal,
      net_settlement: grossVolume - refundedTotal,
      generated_at: new Date().toISOString(),
    },
    line_items: records,
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error('Reconciliation failed:', err.message);
  process.exit(1);
});
```

### Scheduling and Idempotency

- Run the script on a cron schedule matching the merchant's reporting cadence
  (daily, weekly, or monthly). Because `getMerchantPaymentHistory` is
  **read-only and deterministic**, re-running for the same period is safe and
  idempotent — it will return the same records.
- De-duplicate on the accounting side using `invoice_id` (`orderId`) as the
  natural key. LumenFlow enforces order-ID uniqueness per merchant, so an
  `orderId` is a stable reconciliation key.
- When a payment's status changes (e.g. a refund is executed after a prior
  export), re-running the script for the affected period updates the
  `refunded_amount` and `net_amount`; the accounting system should reconcile the
  difference as an adjusting entry.

---

## References

- [`get_merchant_payment_history`](../README.md#payment-history-queries)
- [`get_merchant_stats`](../README.md#payment-history-queries)
- [`get_merchant_tier`](../README.md#merchant-tiers)
- [`get_refunds_for_order`](../README.md#refunds)
- [Merchant Dashboard](../dashboard/merchant-dashboard/)
- [Merchant-Facing Reconciliation Between Payouts and Payments](merchant-payment-reconciliation.md)
