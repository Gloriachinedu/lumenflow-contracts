# LumenFlow Architecture

This document describes the internal structure of the LumenFlow Soroban smart contract: module responsibilities, storage layout, auth model, and lifecycle diagrams.

---

## Module Responsibilities

```
contracts/lumenflow/src/
├── lib.rs        — All contract entry points (public API)
├── types.rs      — Shared data structures and enums
├── storage.rs    — Typed wrappers around Soroban persistent/instance storage
├── error.rs      — PaymentError enum (all typed error codes)
└── helper.rs     — Auth checks and input validation utilities
```

### `lib.rs`
The single contract struct `PaymentProcessingContract`. Every `#[contractimpl]` function is defined here. Functions delegate to `storage.rs` for reads/writes and `helper.rs` for auth/validation. No business logic lives outside this file.

### `types.rs`
Defines all `#[contracttype]` structs and enums used in storage and function signatures:
- `MerchantProfile`, `MerchantCategory`
- `PaymentRecord`, `PaymentStatus`, `PaymentFilter`, `SortField`, `SortOrder`, `StatusFilter`
- `RefundRecord`, `RefundStatus`
- `MultisigPayment`, `MultisigStatus`
- `GlobalStats`, `PaymentPage`, `BatchPaymentItem`

### `storage.rs`
Typed get/set helpers for every storage key. Centralises all `env.storage()` calls so `lib.rs` never touches raw storage keys directly. Key categories:

| Helper prefix | Storage type | Purpose |
|---|---|---|
| `get/set_admin` | Instance | Admin address |
| `get/set_merchant` | Persistent | Merchant profiles |
| `get/set_payment` | Persistent | Payment records |
| `get/set_refund` | Persistent | Refund records |
| `get/set_multisig` | Persistent | Multisig payment state |
| `get/set_global_stats` | Instance | Aggregate counters |
| `get/set_merchant_index` | Persistent | Per-merchant order ID list |
| `get/set_payer_index` | Persistent | Per-payer order ID list |
| `get/set_payer_nonce` | Persistent | Replay-protection counter |

### `error.rs`
`PaymentError` — a `#[contracterror]` enum. Every function returns `Result<T, PaymentError>`. No panics in contract code.

### `helper.rs`
- `require_admin` — reads admin from storage, calls `env.require_auth`
- `validate_string_len` — enforces max-length constraints on memo/reason fields
- `validate_amount` — rejects zero or negative amounts

---

## Storage Layout

LumenFlow uses two Soroban storage tiers:

**Instance storage** (shared contract lifetime, cheaper):
- `Admin` → `Address`
- `GlobalStats` → `GlobalStats`
- `MaxRefundsPerOrder` → `u32`
- `LargePaymentThreshold` → `i128`
- `PaymentCleanupPeriod` → `u64`

**Persistent storage** (per-key TTL, survives ledger archival):
- `Merchant(Address)` → `MerchantProfile`
- `Payment(String)` → `PaymentRecord`  *(keyed by order_id)*
- `Refund(String)` → `RefundRecord`  *(keyed by refund_id)*
- `Multisig(String)` → `MultisigPayment`  *(keyed by payment_id)*
- `MerchantIndex(Address)` → `Vec<String>`  *(order IDs for history)*
- `PayerIndex(Address)` → `Vec<String>`  *(order IDs for history)*
- `PayerNonce(Address)` → `u64`
- `AllowedToken(Address)` → `bool`

---

## Storage TTL Extension Strategy

Soroban persistent entries are archived once their TTL (time-to-live, measured in ledgers) expires. Archived entries must be restored before they can be read, which is expensive and disruptive. LumenFlow therefore extends the TTL of every persistent key it writes, and re-extends it on hot read/write paths.

TTL values are expressed in **ledgers** (≈5 seconds per ledger on Stellar mainnet). The canonical constants live in `docs/storage-schema.md` (TTL constants table) and are mirrored in `contracts/lumenflow/src/storage.rs`. `extend_ttl(threshold, extend_to)` semantics:

- **Initial TTL** — the `extend_to` value applied immediately after a key is first written (via `env.storage().persistent().extend_ttl(key, threshold, extend_to)` or the `set_*` helper).
- **Extension threshold** — the first argument to `extend_ttl`. When the remaining TTL drops below this value, the entry is eligible for extension.
- **Extension amount** — the second argument to `extend_ttl` (`extend_to`). The new TTL is set to this many ledgers from the current ledger.

### Persistent key categories

| Key category | Storage key | Initial TTL | Extension threshold | Extension amount (`extend_to`) | Extension trigger(s) in `lib.rs` |
|---|---|---|---|---|---|
| Merchant profiles | `Merchant(Address)` | `MERCHANT_TTL` | `MERCHANT_THRESHOLD` | `MERCHANT_TTL` | `register_merchant`, `update_merchant`, `process_payment_with_signature`, `process_payment_with_nonce` |
| Payment records | `Payment(String)` | `PAYMENT_TTL` | `PAYMENT_THRESHOLD` | `PAYMENT_TTL` | `process_payment_with_signature`, `process_payment_with_nonce`, `initiate_refund`, `execute_refund`, `archive_payment_record` |
| Refund records | `Refund(String)` | `REFUND_TTL` | `REFUND_THRESHOLD` | `REFUND_TTL` | `initiate_refund`, `approve_refund`, `reject_refund`, `execute_refund` |
| Multisig payments | `Multisig(String)` | `MULTISIG_TTL` | `MULTISIG_THRESHOLD` | `MULTISIG_TTL` | `initiate_multisig_payment`, `sign_multisig_payment`, `execute_multisig_payment` |
| Escrows | `Escrow(String)` | `ESCROW_TTL` | `ESCROW_THRESHOLD` | `ESCROW_TTL` | `create_escrow`, `release_escrow`, `refund_escrow` |
| Subscriptions | `Subscription(String)` | `SUBSCRIPTION_TTL` | `SUBSCRIPTION_THRESHOLD` | `SUBSCRIPTION_TTL` | `create_subscription`, `charge_subscription`, `cancel_subscription` |
| Subscription reserves | `SubscriptionReserve(String)` | `SUBSCRIPTION_TTL` | `SUBSCRIPTION_THRESHOLD` | `SUBSCRIPTION_TTL` | `charge_subscription`, `cancel_subscription` |
| Payment requests | `PaymentRequest(String)` | `PAYMENT_REQUEST_TTL` | `PAYMENT_REQUEST_THRESHOLD` | `PAYMENT_REQUEST_TTL` | `create_payment_request`, `fulfill_payment_request`, `cancel_payment_request` |
| Payer nonces | `PayerNonce(Address)` | `NONCE_TTL` | `NONCE_THRESHOLD` | `NONCE_TTL` | `process_payment_with_nonce` |
| Merchant index | `MerchantIndex(Address)` | `INDEX_TTL` | `INDEX_THRESHOLD` | `INDEX_TTL` | `process_payment_with_signature`, `process_payment_with_nonce`, `archive_payment_record` |
| Payer index | `PayerIndex(Address)` | `INDEX_TTL` | `INDEX_THRESHOLD` | `INDEX_TTL` | `process_payment_with_signature`, `process_payment_with_nonce`, `archive_payment_record` |
| Audit entries | `AuditEntry(u64)` | `AUDIT_TTL` | `AUDIT_THRESHOLD` | `AUDIT_TTL` | `record_audit_entry` (append-only; extended on write) |
| Disputes | `Dispute(String)` | `DISPUTE_TTL` | `DISPUTE_THRESHOLD` | `DISPUTE_TTL` | `open_dispute`, `resolve_dispute` |
| Commitments | `Commitment(String)` | `COMMITMENT_TTL` | `COMMITMENT_THRESHOLD` | `COMMITMENT_TTL` | `create_commitment`, `settle_commitment` |
| Allowed tokens | `AllowedToken(Address)` | `TOKEN_TTL` | `TOKEN_THRESHOLD` | `TOKEN_TTL` | `add_allowed_token`, `remove_allowed_token` |

### Instance storage

Instance storage shares the contract instance's TTL and is extended whenever the contract instance is bumped. Keys: `Admin`, `GlobalStats`, `MaxRefundsPerOrder`, `LargePaymentThreshold`, `PaymentCleanupPeriod`. These are extended implicitly by any state-changing entrypoint that writes instance storage; no per-key extension is required.

### Known gaps

The following persistent keys are written by `storage.rs` but currently have **no explicit `extend_ttl` call** in `lib.rs`. They must be fixed in the `storage.rs` step by adding extension inside the corresponding `set_*` helper:

- `AuditEntry(u64)` — written by `record_audit_entry`; no extension on write.
- `Commitment(String)` — written by `create_commitment`; extension only on `settle_commitment`.
- `SubscriptionReserve(String)` — written by `charge_subscription`; no extension on write.

Unit tests in `contracts/lumenflow/src/test.rs` assert that each category's TTL is extended after the triggering entrypoint runs (see `test_ttl_*` cases).

---

## Auth Model

See also [`docs/auth-model.md`](auth-model.md) for full details.

| Operation | Required auth |
|---|---|
| `set_admin` | None (one-time, first caller) |
| `register_merchant` | `merchant_address` |
| `deactivate_merchant` | admin |
| `process_payment_with_signature` | `payer` |
| `initiate_refund` | `payer` or `merchant` |
| `approve_refund` / `reject_refund` | `merchant` or admin |
| `execute_refund` | merchant of the original payment |
| `initiate_multisig_payment` | `initiator` |
| `sign_multisig_payment` | `signer` (must be in signers list) |
| `execute_multisig_payment` | `payer` (initiator) |
| `get_global_payment_stats` | admin |
| `archive_payment_record` | admin |
| `cleanup_expired_payments` | admin |

Auth is enforced via `env.require_auth(&address)` inside `helper::require_admin` or inline in `lib.rs`. `mock_all_auths()` is used in tests to bypass Soroban's auth engine.

---

## Refund State Machine

```mermaid
stateDiagram-v2
    [*] --> Pending : initiate_refund
    Pending --> Approved : approve_refund (merchant/admin)
    Pending --> Rejected : reject_refund (merchant/admin)
    Approved --> Completed : execute_refund (merchant)
    Rejected --> [*]
    Completed --> [*]
```

Rules:
- Window: 30 days from `paid_at` timestamp
- Partial refunds allowed; cumulative total ≤ original amount
- Max concurrent refunds per order enforced by `MaxRefundsPerOrder` (default 5)
- Payment status transitions: `Completed` → `PartiallyRefunded` → `FullyRefunded`

---

## Multisig Payment Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Pending : initiate_multisig_payment
    Pending --> Pending : sign_multisig_payment (threshold not yet met)
    Pending --> Executed : execute_multisig_payment (threshold met)
    Executed --> [*]
```

Rules:
- `signers` list and `required_signatures` threshold set at initiation
- Each signer calls `sign_multisig_payment` once; duplicate signing is rejected
- `execute_multisig_payment` fails with `InsufficientSignatures` if threshold not met
- On execution, a `PaymentRecord` is written and indexed in merchant/payer history

---

## Payment History Indexing

History queries are O(n) scans over in-contract index vectors:

1. `MerchantIndex(merchant)` and `PayerIndex(payer)` store ordered lists of `order_id` strings.
2. `get_merchant_payment_history` / `get_payer_payment_history` load the index, apply filters, sort, and paginate using cursor-based pagination (cursor = last seen `order_id`).
3. Max page size: 100 results.

---

## Replay Protection

`process_payment_with_nonce` uses a per-payer `PayerNonce` counter stored in persistent storage. The caller must supply the current nonce; the contract increments it on success. Mismatched nonces return `InvalidNonce`.

`process_payment_with_signature` uses `order_id` uniqueness (duplicate order IDs return `PaymentAlreadyExists`) combined with ed25519 signature verification over the payment payload.

---

## Event Emission

Every state-changing operation emits a Soroban event with topic `["lumenflow", "<event_name>"]`. See [`docs/events-reference.md`](events-reference.md) for full payload schemas.

---

## Data Flow Diagram

The diagram shows payment initiation and signature verification, followed by event monitoring and merchant webhook delivery.

```mermaid
flowchart TD
    FE[Frontend]
    SDK[LumenFlow SDK / Stellar SDK]
    WALLET[Wallet]
    RPC[Soroban RPC]
    CONTRACT[LumenFlow contract]
    STORAGE[(Soroban contract storage)]
    EVENTS[Soroban events]
    INDEXER[Horizon event stream]
    MONITOR[Monitoring and alerting]
    WEBHOOK[Merchant webhook service]
    MERCHANT[Merchant systems]

    FE -->|payment details and request| SDK
    SDK -->|canonical payment payload| WALLET
    WALLET -->|signature and signed transaction| SDK
    SDK -->|submit transaction| RPC
    RPC -->|invoke contract| CONTRACT
    CONTRACT -->|verify payer signature| CONTRACT
    CONTRACT -->|read and write payment record| STORAGE
    CONTRACT -->|payment result| RPC
    RPC -->|result or error| SDK
    SDK -->|receipt status| FE

    CONTRACT -->|emit payment and refund events| EVENTS
    EVENTS -->|ledger event data| INDEXER
    INDEXER -->|event stream| MONITOR
    INDEXER -->|matching merchant events| WEBHOOK
    WEBHOOK -->|HTTPS event notification| MERCHANT
```

Payment signatures cover the canonical payload described in [`signature-format.md`](signature-format.md). The contract verifies the signature before recording the payment. State-changing calls emit Soroban events; off-chain monitoring and merchant webhook consumers receive those events through the event stream. See [`events-reference.md`](events-reference.md), [`monitoring.md`](monitoring.md), and [`webhook-integration.md`](webhook-integration.md) for event schemas and integration details.
