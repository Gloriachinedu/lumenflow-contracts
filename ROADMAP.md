# LumenFlow Roadmap

This roadmap describes the versioned milestones and planned features for
LumenFlow. Dates are estimates based on current pace and priorities.

> **Maintainer note:** This roadmap is reviewed and updated at the start of
> each quarter (Q1: January, Q2: April, Q3: July, Q4: October). To propose a
> feature or influence priorities, open a discussion in
> [Feature Requests](https://github.com/PrincessnJoy/lumenflow-contracts/discussions/categories/feature-requests).

---

## Current Focus — v1.1 (Q3 2026)

The team is actively working on these items right now:

| # | Feature | Issue | Status |
|---|---------|-------|--------|
| 1 | Optional tags on batch payment items | [#660](https://github.com/Gloriachinedu/lumenflow-contracts/issues/660) | ✅ In review |
| 2 | WASM binary reproducible builds verification | [#659](https://github.com/Gloriachinedu/lumenflow-contracts/issues/659) | ✅ In review |
| 3 | GitHub Discussions category structure | [#661](https://github.com/Gloriachinedu/lumenflow-contracts/issues/661) | ✅ In review |
| 4 | Versioned ROADMAP with milestone targets | [#654](https://github.com/Gloriachinedu/lumenflow-contracts/issues/654) | ✅ In review |

---

## v1.1 — Developer Experience & Quality (Q3 2026, est. September 2026)

Focus: Improve tooling, reproducibility, and community infrastructure to make
LumenFlow easier to integrate and contribute to.

| Feature | Description | Issue |
|---------|-------------|-------|
| Reproducible WASM builds | Pin toolchain, commit Cargo.lock, add `verify-build.sh` and `release-hashes.md` | [#659](https://github.com/Gloriachinedu/lumenflow-contracts/issues/659) |
| Batch payment tags | Add `tags: Option<Vec<String>>` to `BatchPaymentItem` matching single-payment tags | [#660](https://github.com/Gloriachinedu/lumenflow-contracts/issues/660) |
| GitHub Discussions structure | Define Q&A, Developer Help, Feature Requests, Show and Tell, Announcements categories | [#661](https://github.com/Gloriachinedu/lumenflow-contracts/issues/661) |
| Versioned roadmap | Restructure ROADMAP.md with v1.1/v1.2/v2.0 targets linked to issues | [#654](https://github.com/Gloriachinedu/lumenflow-contracts/issues/654) |
| TypeScript SDK types | Full `types.ts` with all contract types for front-end integration | [#660](https://github.com/Gloriachinedu/lumenflow-contracts/issues/660) |

---

## v1.2 — Payments & Merchant Features (Q4 2026, est. December 2026)

Focus: Expand payment capabilities and merchant tools based on community
feedback gathered after v1.1.

| Feature | Description | Issue |
|---------|-------------|-------|
| Subscription / recurring payments | Allow merchants to define recurring billing schedules with configurable intervals | TBD |
| Payment expiry | Let merchants set per-payment TTL; expired orders are automatically voided | TBD |
| Merchant verified flag | Introduce an admin-grantable `verified` flag on merchant profiles | [#120](https://github.com/Gloriachinedu/lumenflow-contracts/issues/120) |
| Payment receipt page (front-end) | SDK helper to generate a shareable receipt URL from a payment record | [#104](https://github.com/Gloriachinedu/lumenflow-contracts/issues/104) |
| Node.js contract wrapper | Higher-level Node.js SDK wrapping the Stellar SDK for common contract operations | [#279](https://github.com/Gloriachinedu/lumenflow-contracts/issues/279) |

---

## v2.0 — Protocol Upgrade (Q2 2027, est. June 2027)

Focus: Breaking changes, multi-token support, governance, and protocol-level
improvements. A migration guide will be published before release.

| Feature | Description | Issue |
|---------|-------------|-------|
| Multi-token batch payments | Allow a single batch to include items across different SAC tokens | TBD |
| On-chain governance | Decentralised admin via time-locked proposal + voting mechanism | TBD |
| Programmable refund policies | Merchants configure per-category refund windows and approval rules on-chain | TBD |
| Multi-signature payment UI | Front-end component library for multisig payment initiation and signing | [#106](https://github.com/Gloriachinedu/lumenflow-contracts/issues/106) |
| Optimised pagination storage | Refactor storage layout to reduce XDR overhead on large payment histories | [#281](https://github.com/Gloriachinedu/lumenflow-contracts/issues/281) |

---

## Completed — v1.0.0 (2026-05-17)

| Feature | Description |
|---------|-------------|
| Merchant management | Registration, deactivation, and profile management |
| Signature-verified payments | ed25519 signature verification on every payment |
| Refund lifecycle | Initiate → approve/reject → execute with 30-day window |
| Multi-signature payments | Configurable threshold with per-signer ed25519 verification |
| Paginated payment history | Cursor-based pagination, filtering, and sorting for merchants and payers |
| Global payment statistics | Admin-only aggregate stats with date-range filtering |
| Payment archiving & cleanup | Admin tools for record archiving and age-based cleanup |
| Full test suite | Unit tests covering all contract functions using `soroban-sdk` testutils |
| CI/CD pipeline | Lint, test, WASM build, and tag-triggered release workflows |

---

## How to influence the roadmap

1. **Vote on existing proposals** in [Feature Requests discussions](https://github.com/PrincessnJoy/lumenflow-contracts/discussions/categories/feature-requests) — thumbs-up reactions signal priority.
2. **Open a new discussion** in Feature Requests for ideas not yet on the list.
3. **Contribute directly** — see [CONTRIBUTING.md](CONTRIBUTING.md) to pick up an issue or propose a PR.

Features move from discussion → issue → milestone as they gain community
support and maintainer bandwidth. The roadmap is updated each quarter.

---

*Last updated: Q3 2026 — next review: October 2026*
