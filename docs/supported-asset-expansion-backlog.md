# Prioritized Backlog for Supported Asset Expansion

**Issue:** [#907](https://github.com/Gloriachinedu/lumenflow-contracts/issues/907)
**Status:** Backlog / Planning
**Priority:** Medium
**Effort:** Medium
**Labels:** product, Stellar Wave

---

## Overview

LumenFlow's payment and escrow contracts operate on an allowlist of accepted
assets. This document defines a prioritized backlog for expanding that allowlist,
the criteria used to rank candidates, and the rollout steps required for each
addition. It feeds the "Near-term" section of [ROADMAP.md](../ROADMAP.md).

---

## Prioritization Criteria

Each candidate asset is scored 1–5 on the following, then ranked by weighted
total:

| Criterion | Weight | Notes |
|---|---|---|
| Merchant demand | 0.30 | Requests, waitlist signups, lost deals |
| Liquidity / stability | 0.25 | On-chain liquidity, price volatility, issuer reserves |
| Issuer trust & compliance | 0.20 | Regulated issuer, audits, freeze/clawback policy |
| Integration cost | 0.15 | Decimals, trustline setup, oracle needs |
| Operational risk | 0.10 | Clawback exposure, depeg history, support load |

An asset must pass hard gates regardless of score: verified issuer, documented
redemption path, and no unresolved security findings.

---

## Prioritized Backlog

| Rank | Asset | Rationale | Blocking work |
|---|---|---|---|
| 1 | USDC (Stellar) | Highest merchant demand; deep liquidity; regulated issuer | Confirm clawback handling in refund flow |
| 2 | EURC (Stellar) | EU merchant demand; same issuer profile as USDC | FX display in dashboard; rounding review |
| 3 | Regional stablecoin (e.g. NGNC/ARST class) | Local-currency settlement for target markets | Issuer due diligence; volatility monitoring |
| 4 | Yield-bearing stable (e.g. wrapped T-bill token) | Treasury interest for merchants holding balances | Legal review; accrual accounting in reporting |
| 5 | Additional major stablecoin (second issuer) | Issuer diversification / redundancy | Duplicate-symbol disambiguation in UI and SDK |

Ranks are reviewed monthly; new candidates enter the table scored, not appended.

---

## Rollout Checklist (per asset)

1. Score against criteria; record in this table with a dated entry.
2. Issuer due diligence: reserves, audits, freeze/clawback terms, redemption.
3. Add asset config (contract, decimals, issuer, display symbol) behind a flag.
4. Update SDK constants and generated types.
5. Extend test suite: payment, refund, escrow, payout, and reconciliation paths.
6. Update [webhook-integration.md](webhook-integration.md) and API docs with the
   new asset code.
7. Enable in staging, run the standard payment/refund/payout scenarios.
8. Enable in production for a pilot merchant cohort, then general availability.
9. Announce in [CHANGELOG.md](../CHANGELOG.md).

---

## Failure, Permission, and Boundary Cases

| Case | Expected behaviour |
|---|---|
| Asset addition attempted without passing hard gates | Rejected in review; not added to config |
| Issuer freezes an account holding an in-flight payment | Payment fails cleanly; funds not lost from merchant's perspective; documented in troubleshooting |
| Asset with clawback enabled | Refund and dispute flows must account for possible issuer clawback; asset flagged `clawback: true` in config |
| Two assets share a display symbol | UI and SDK disambiguate by issuer; never collapse to one code |
| Asset delisting | Removal follows a deprecation window: disable new payments, allow settlement of existing, then remove config |
| Config change without allowlist update | Contract continues to reject the asset; no partial enablement |

---

## Testing

- Normal path: adding a scored, gated asset enables payments and payouts in that
  asset with existing scenarios passing.
- Edge case: an asset flagged `clawback: true` triggers the clawback-aware branch
  in the refund flow.
- Failure case: enabling an asset whose issuer config is incomplete is rejected at
  load time rather than accepting a payment that cannot settle.

---

## Governance

Additions and removals require product and security sign-off per
[GOVERNANCE.md](../GOVERNANCE.md), and an update to this document and
[ROADMAP.md](../ROADMAP.md).
