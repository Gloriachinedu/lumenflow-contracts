> Decision criteria and governance process for this backlog are documented in [ADR-008](adr/ADR-008-supported-asset-expansion.md).

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
| 1 | USDC (Stellar) — **shipped** ([#1576](https://github.com/Gloriachinedu/lumenflow-contracts/issues/1576)) | Highest merchant demand; deep liquidity; regulated issuer | None — first supported non-native token; see [USDC rollout notes](#usdc-stellar--first-supported-non-native-token) |
| 2 | EURC (Stellar) | EU merchant demand; same issuer profile as USDC | FX display in dashboard; rounding review |
| 3 | Regional stablecoin (e.g. NGNC/ARST class) | Local-currency settlement for target markets | Issuer due diligence; volatility monitoring |
| 4 | Yield-bearing stable (e.g. wrapped T-bill token) | Treasury interest for merchants holding balances | Legal review; accrual accounting in reporting |
| 5 | Additional major stablecoin (second issuer) | Issuer diversification / redundancy | Duplicate-symbol disambiguation in UI and SDK |

Ranks are reviewed monthly; new candidates enter the table scored, not appended.

---

## USDC (Stellar) — First Supported Non-Native Token

USDC on Stellar is the first non-native asset enabled on the allowlist
([#1576](https://github.com/Gloriachinedu/lumenflow-contracts/issues/1576)).
It completed the rollout checklist below; the remaining backlog entries follow
the same process.

### Verified SAC addresses

The Stellar Asset Contract (SAC) address for USDC is derived from the issuer
account and asset code. Verified per network:

| Network | Asset | Issuer | SAC address |
|---|---|---|---|
| Mainnet (Pubnet) | `USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` | `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` (Circle) | `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75` |
| Testnet | `USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` (Circle testnet) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |

Addresses are verified against the issuer's published asset metadata before
being committed to config; re-verify whenever the issuer rotates accounts.

### Decimals and display

USDC uses **7 decimal places** on Stellar (matching the native asset precision),
so amounts are stored and displayed with 7-decimal precision. The dashboard and
SDK display the symbol `USDC` and disambiguate by issuer if another asset later
reuses the code.

### Clawback handling

USDC is issued with clawback enabled and is flagged `clawback: true` in config.
The refund flow takes the clawback-aware branch: a refund to a clawback-frozen
address fails with the contract's clawback error rather than silently
succeeding, and the failure is surfaced to the operator. This is covered by the
clawback test in the suite.

### Allowlisting and tests

- `add_allowed_token(USDC_ADDRESS)` is called in the deploy script so the
  contract accepts USDC on deployment.
- An integration test exercises the full payment and refund cycle with USDC,
  including the clawback-frozen refund failure case.

---

## Rollout Checklist (per asset)

For the operator-facing steps and CLI commands behind items 3–4 below, see
[add-supported-token.md](add-supported-token.md).

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
  in the refund flow. For USDC this is verified by the clawback test: a refund to
  a clawback-frozen address returns the correct error.
- USDC integration test: full payment and refund cycle with USDC passes end to
  end ([#1576](https://github.com/Gloriachinedu/lumenflow-contracts/issues/1576)).
- Failure case: enabling an asset whose issuer config is incomplete is rejected at
  load time rather than accepting a payment that cannot settle.

---

## Governance

Additions and removals require product and security sign-off per
[GOVERNANCE.md](../GOVERNANCE.md), and an update to this document and
[ROADMAP.md](../ROADMAP.md).
