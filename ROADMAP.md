# Roadmap

This document outlines planned features and milestones for LumenFlow. It is updated with each release.

---

## Near-term (next 1–2 releases)

- [ ] **Webhook notifications** — off-chain event delivery for payment and refund state changes
- [ ] **Batch payments** — process multiple payments in a single contract invocation
- [ ] **Configurable refund window** — allow merchants to set their own refund period
- [ ] **Expanded test coverage** — property-based and fuzz tests for core payment flows

---

## Medium-term

- [ ] **Fee module** — optional protocol fee with configurable recipient and basis points
- [ ] **Merchant tiers** — volume-based rate adjustments and feature gating
- [ ] **Subscription payments** — recurring payment schedules with on-chain scheduling
- [ ] **Cross-asset payments** — accept any Stellar asset, auto-convert to merchant's preferred token
- [ ] **Merchant payout & settlement reporting** — aggregated settlement summaries with CSV/JSON export for accounting and tax reconciliation; see [docs/merchant-payout-reporting.md](docs/merchant-payout-reporting.md) for full spec ([#371](https://github.com/Gloriachinedu/lumenflow-contracts/issues/371))

---

## Long-term

- [ ] **Decentralised dispute resolution** — on-chain arbitration for contested refunds
- [ ] **DAO governance** — community voting on protocol parameters
- [ ] **Layer-2 settlement** — off-chain payment channels with on-chain settlement
- [ ] **SDK & client libraries** — TypeScript and Python SDKs for easy integration

---

## Unresolved item tracking

Every unresolved (`- [ ]`) roadmap item above is tracked here with an **owner**
and a **target milestone** so that nothing stalls silently. The process for
maintaining this table — who assigns owners, what the milestones mean, and how
overdue items are escalated — is documented in
[docs/roadmap-tracking.md](docs/roadmap-tracking.md).

The table is machine-checked by `scripts/check-roadmap-tracking.mjs`
(`npm run check:roadmap`): the check fails if an unresolved roadmap item is
missing from the table, or if a row has an empty owner, an empty target
milestone, or a milestone that is not defined in the legend below.

### Milestone legend

| Milestone | Meaning |
|---|---|
| `v0.4` | Next tagged release |
| `v0.5` | Release after `v0.4` |
| `v0.6` | Release after `v0.5` |
| `Backlog` | Accepted direction, not yet scheduled to a release |

### Owners and target milestones

| Item | Owner | Target milestone | Tracking issue | Status |
|---|---|---|---|---|
| Webhook notifications | maintainers | `v0.4` | — | Not started |
| Batch payments | maintainers | `v0.4` | — | In progress |
| Configurable refund window | maintainers | `v0.4` | — | Not started |
| Expanded test coverage | maintainers | `v0.4` | — | In progress |
| Fee module | maintainers | `v0.5` | — | Not started |
| Merchant tiers | maintainers | `v0.5` | — | Not started |
| Subscription payments | maintainers | `v0.5` | — | In progress |
| Cross-asset payments | maintainers | `v0.6` | — | Not started |
| Merchant payout & settlement reporting | maintainers | `v0.5` | [#371](https://github.com/Gloriachinedu/lumenflow-contracts/issues/371) | Not started |
| Decentralised dispute resolution | maintainers | `Backlog` | — | Not started |
| DAO governance | maintainers | `Backlog` | — | Not started |
| Layer-2 settlement | maintainers | `Backlog` | — | Not started |
| SDK & client libraries | maintainers | `v0.6` | — | In progress |

> **Owner assignment:** `maintainers` is the default holding owner. When work on
> an item is scheduled, a maintainer replaces it with a specific GitHub handle
> (see [docs/roadmap-tracking.md](docs/roadmap-tracking.md)).

---

> Want to contribute to a roadmap item? See [CONTRIBUTING.md](CONTRIBUTING.md) and open an issue or PR.
