# LumenFlow — Architecture Overview

This document provides a high-level description of the LumenFlow smart contract architecture, key design decisions, and pointers to detailed references.

---

## System Overview

LumenFlow is a Soroban smart contract deployed on the Stellar network. It provides a payment processing layer for merchants and payers, including:

- Merchant registration and profile management
- Signature-verified payment processing
- Partial and full refund lifecycle management
- Multi-signature payment approvals
- Payment request (invoice) creation with expiry
- Batch payment processing
- Admin controls: cleanup, archiving, global statistics

The contract is written in Rust and compiled to WebAssembly (WASM) for the Soroban runtime.

---

## High-Level Component Diagram

```
┌──────────────────────────────────────────────────────────┐
│                     LumenFlow Contract                   │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │ Merchant │  │ Payment  │  │  Refund  │  │Multisig │ │
│  │  Module  │  │  Module  │  │  Module  │  │ Module  │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬────┘ │
│       │              │              │              │      │
│  ┌────┴──────────────┴──────────────┴──────────────┴───┐ │
│  │                  Storage Layer (storage.rs)         │ │
│  │  Instance  │  Persistent  │  Temporary              │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │            Auth & Validation (helper.rs)            │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

---

## Storage Architecture

LumenFlow uses all three Soroban storage tiers. For full details on every storage key, retention policy, TTL behaviour, cleanup schedules, and cost estimates, see:

**[docs/storage-schema.md](storage-schema.md)**

### Summary

| Tier | Keys | Purpose |
|------|------|---------|
| Instance | `Admin`, `CleanupPeriod`, `GlobalStats`, `MerchantList`, `LargePaymentThreshold`, `MaxRefundsPerOrder` | Small, frequently-accessed global config |
| Persistent | `Merchant`, `Payment`, `MerchantPayments`, `PayerPayments`, `Refund`, `Multisig`, `OrderRefundCount` | Long-lived per-entity records |
| Temporary | `PaymentRequest` | Short-lived invoice state with caller-defined expiry |

---

## Authentication Model

See [docs/auth-model.md](auth-model.md) for full role definitions.

| Role | Capabilities |
|------|-------------|
| Admin | Set admin, configure thresholds, cleanup/archive payments, view global stats |
| Merchant | Register, receive payments, approve/reject/execute refunds |
| Payer | Process payments, initiate refunds |
| Public | Read merchant profiles, check payment status |

---

## Architecture Decision Records (ADRs)

Key architectural decisions are documented as ADRs in [`docs/adr/`](adr/). When making a significant architectural change, an ADR is required as part of the PR — see [CONTRIBUTING.md](../CONTRIBUTING.md).

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-000](adr/ADR-000-template.md) | ADR Template | Template |
| [ADR-001](adr/ADR-001-saturating-arithmetic.md) | Use Saturating Arithmetic for Global Volume Accumulators | Accepted |
| [ADR-002](adr/ADR-002-cursor-pagination.md) | Cursor-Based Pagination for Payment History Queries | Accepted |
| [ADR-003](adr/ADR-003-ed25519-signature-format.md) | Ed25519 Off-Chain Signature Verification for Payment Authorisation | Accepted |
| [ADR-004](adr/ADR-004-storage-key-design.md) | Storage Key Design Using Typed `DataKey` Enum | Accepted |
| [ADR-005](adr/ADR-005-contract-pause-mechanism.md) | Contract Pause / Circuit-Breaker Mechanism | Accepted |

---

## Contract Modules

| Module | File | Responsibility |
|--------|------|---------------|
| Entry points | `src/lib.rs` | All public contract functions |
| Data types | `src/types.rs` | Structs and enums for all domain objects |
| Storage helpers | `src/storage.rs` | Typed get/set/remove wrappers for each key |
| Error codes | `src/error.rs` | Typed error enum with numeric codes |
| Auth & validation | `src/helper.rs` | Signature verification, auth checks, input guards |
| Tests | `src/test.rs` | Unit tests using `soroban-sdk` testutils |

---

## Event Model

All significant state transitions emit Soroban contract events. See [docs/events-reference.md](events-reference.md) for the full event catalogue, payload schemas, and subscription examples.

---

## Off-Chain Integration

- **Webhooks / Horizon SSE**: [docs/webhook-integration.md](webhook-integration.md)
- **Monitoring & alerting**: [docs/monitoring.md](monitoring.md)
- **Signature format**: [docs/signature-format.md](signature-format.md)
- **Postman collection**: [docs/lumenflow.postman_collection.json](lumenflow.postman_collection.json)
- **Batch payments**: [docs/batch-payments.md](batch-payments.md)

---

## Contributing

When making a significant architectural change, an ADR is required as part of the PR. See [CONTRIBUTING.md](../CONTRIBUTING.md) and the [ADR template](adr/ADR-000-template.md).
