# Storage Schema — LumenFlow Contract

This document describes every storage key used by the LumenFlow Soroban smart contract, including the storage tier (instance / persistent / temporary), the data type stored, retention policy, TTL behaviour, and approximate ledger rent cost.

> Cross-reference: [docs/ARCHITECTURE.md](ARCHITECTURE.md) — Architecture Overview

---

## Storage Tiers

Soroban offers three storage tiers. Each has different cost and lifetime semantics:

| Tier | Lifetime | Rent model | Use in LumenFlow |
|------|----------|------------|-----------------|
| **Instance** | Lives as long as the contract instance is live | Charged per ledger as part of instance rent | Small, global config values |
| **Persistent** | Survives across ledgers; evicted if rent runs out | Per-entry rent; must be extended or data is evicted | Per-entity records (merchants, payments, refunds) |
| **Temporary** | Automatically deleted after TTL expires | Cheap; no eviction penalty — entry simply disappears | Short-lived request state (payment requests) |

---

## Storage Key Reference

### Instance Storage Keys

All instance keys share a single rent ledger with the contract instance. Rent is paid as long as the contract is alive; no per-key extension is needed.

| Key | Value type | Retention | Default value | Max records | Notes |
|-----|-----------|-----------|---------------|-------------|-------|
| `Admin` | `Address` | **Permanent** | None (must be set once at init) | 1 | Single admin address; set via `set_admin`. Cannot be unset. |
| `CleanupPeriod` | `u64` (seconds) | **Permanent** (configurable) | `2_592_000` (30 days) | 1 | Admin can update via `set_payment_cleanup_period`. Applies to `cleanup_expired_payments`. |
| `GlobalStats` | `GlobalStats` struct | **Permanent** | Zero-initialised on first read | 1 | Counters use saturating arithmetic; never panics on overflow. |
| `MerchantList` | `Vec<Address>` | **Permanent** | Empty `Vec` | Unbounded¹ | Append-only list of registered merchant addresses. |
| `LargePaymentThreshold` | `i128` | **Permanent** (configurable) | `10_000_000` (10 M units) | 1 | Payments above this value emit a `lumenflow/suspicious_activity` event. Admin-configurable. |
| `MaxRefundsPerOrder` | `u32` | **Permanent** (configurable) | `5` | 1 | Hard cap on refund records per order. Admin-configurable. |

> ¹ `MerchantList` grows unboundedly as merchants register. If this list becomes very large, instance storage rent increases. A pagination-friendly index design is planned (see ADR-004 in `docs/adr/`).

---

### Persistent Storage Keys

Each persistent entry has its own rent ledger. Entries that are not refreshed will be **evicted** (data lost) once their rent runs out. The contract currently does not explicitly bump TTLs on reads — integrators running archive nodes should monitor entry lifetimes.

Default minimum lifetime for persistent entries in Soroban testnet/mainnet is controlled by network-level parameters (`ledgerSeqLedgerCloseTime`, `minPersistentTTL`). As of Stellar Protocol 21, `minPersistentTTL` is **518400 ledgers ≈ 30 days** and `maxPersistentTTL` is **3110400 ledgers ≈ 180 days**.

| Key | Value type | Retention | Cleanup-eligible | Max records | Notes |
|-----|-----------|-----------|-----------------|-------------|-------|
| `Merchant(Address)` | `Merchant` struct | **Permanent** (while rent paid) | No | One per merchant address | Removed only via explicit admin action. Deactivation sets `active = false` but keeps the record. |
| `Payment(String)` | `PaymentOrder` struct | **Cleanup-eligible** | **Yes** — deleted by `cleanup_expired_payments` | One per `order_id` | Eligible for cleanup after `CleanupPeriod` seconds from `paid_at`. Can also be explicitly archived by admin via `archive_payment_record`. |
| `MerchantPayments(Address)` | `Vec<String>` (order IDs) | **Cleanup-eligible** | **Yes** — index updated when payment is removed | One per merchant | Index of order IDs for a merchant. Updated in sync with `Payment` removals. |
| `PayerPayments(Address)` | `Vec<String>` (order IDs) | **Cleanup-eligible** | **Yes** — index updated when payment is removed | One per payer | Index of order IDs for a payer. Updated in sync with `Payment` removals. |
| `Refund(String)` | `RefundRecord` struct | **Permanent** (while rent paid) | No | One per `refund_id`; max `MaxRefundsPerOrder` per order | Refund records are never auto-deleted. |
| `Multisig(String)` | `MultisigPayment` struct | **Permanent** (while rent paid) | No | One per `payment_id` | Multisig records are retained after execution (`executed = true`). |
| `OrderRefundCount(String)` | `u32` | **Permanent** (while rent paid) | No | One per `order_id` | Tracks number of refunds per order to enforce `MaxRefundsPerOrder`. |

---

### Temporary Storage Keys

Temporary entries have a network-defined maximum TTL (Protocol 21: **`maxTempTTL` = 3110400 ledgers ≈ 180 days**; minimum useful TTL set by the contract at write time). When the TTL expires the entry is **silently deleted** — no eviction event is emitted.

| Key | Value type | TTL | Configurable TTL | Notes |
|-----|-----------|-----|-----------------|-------|
| `PaymentRequest(String)` | `PaymentRequest` struct | Set to `expires_at` field in the record | Yes — caller sets `expires_at` at creation | Deleted automatically once `expires_at` is reached. No explicit remove is needed after payment. `remove_payment_request` is called on successful payment for immediate cleanup. |

---

## TTL Values and Defaults

| Parameter | Default | Source | Configurable by |
|-----------|---------|--------|----------------|
| `CleanupPeriod` | `2_592_000` s (30 days) | `storage.rs: get_cleanup_period()` | Admin via `set_payment_cleanup_period` |
| Payment request TTL | Caller-supplied `expires_at` | `types.rs: PaymentRequest.expires_at` | Caller at creation time |
| Persistent entry min TTL | Network param `minPersistentTTL` (~30 days) | Stellar protocol | Network governance |
| Persistent entry max TTL | Network param `maxPersistentTTL` (~180 days) | Stellar protocol | Network governance |

---

## `cleanup_expired_payments` Behaviour

The `cleanup_expired_payments` admin function removes stale payment records from persistent storage.

### Which keys are deleted

For each `order_id` in the global payment index where `paid_at + CleanupPeriod < current_ledger_timestamp`:

1. `Payment(order_id)` — the payment record itself.
2. The `order_id` entry is removed from `MerchantPayments(merchant_address)`.
3. The `order_id` entry is removed from `PayerPayments(payer_address)`.

**Not deleted by this function:**
- `Refund(refund_id)` records associated with the payment.
- `OrderRefundCount(order_id)`.
- `GlobalStats` (counters are not decremented).
- `Merchant` records.

### Preconditions

| Condition | Error if violated |
|-----------|------------------|
| Caller must be the current admin | `ContractError::Unauthorized` |
| Contract must have been initialised (admin set) | `ContractError::NotInitialized` |

### Idempotency

`cleanup_expired_payments` is safe to call multiple times. Payments that have already been removed are silently skipped.

---

## Storage Cost Estimates

Soroban charges **ledger rent** for persistent and instance storage. Rent is denominated in XLM stroops per byte per ledger. The following estimates use **Stellar Protocol 21 mainnet parameters** (1 stroop = 0.0000001 XLM; rent fee ≈ 1000 stroops/byte/ledger at 100 ledgers/day write fee; subject to network fee market).

> These are order-of-magnitude estimates. Actual costs depend on network congestion and fee-market conditions. Use the [Stellar fee estimator](https://developers.stellar.org/docs/fundamentals-and-concepts/fees-resource-limits-metering) for current rates.

| Entry | Approx. serialised size | 30-day rent (XLM, est.) | Notes |
|-------|------------------------|------------------------|-------|
| `Admin` (instance) | ~56 bytes | Included in instance rent | Part of contract instance |
| `GlobalStats` (instance) | ~80 bytes | Included in instance rent | Part of contract instance |
| `MerchantList` (instance, 100 merchants) | ~3.2 KB | Included in instance rent | Grows with merchant count |
| `Merchant(Address)` | ~300–500 bytes | ~0.001–0.002 XLM | Per registered merchant |
| `Payment(String)` | ~400–700 bytes | ~0.001–0.003 XLM | Per payment order; deleted after cleanup |
| `MerchantPayments(Address)` (100 orders) | ~3.2 KB | ~0.010 XLM | Per active merchant; shrinks as payments are cleaned |
| `PayerPayments(Address)` (100 orders) | ~3.2 KB | ~0.010 XLM | Per payer |
| `Refund(String)` | ~250–400 bytes | ~0.001–0.002 XLM | Per refund record; permanent |
| `Multisig(String)` | ~600–900 bytes | ~0.002–0.004 XLM | Per multisig payment |
| `PaymentRequest(String)` (temporary) | ~200–300 bytes | Negligible (temporary) | Auto-expires; cheap |

**Rough total for an active merchant with 1 000 payments and 50 refunds:**  
~5–15 XLM/month in storage rent, dominated by `PayerPayments` and `MerchantPayments` index growth.

---

## Record Limits

| Storage key | Hard limit | Enforced by |
|------------|-----------|-------------|
| Refunds per order | `MaxRefundsPerOrder` (default: 5) | `increment_order_refund_count` + check in `initiate_refund` |
| Paginated query results | 100 items per page | `get_merchant_payment_history`, `get_payer_payment_history` |
| Batch payment items | 10 items per batch | `process_batch_payment` input validation |
| Multisig signers | No hard cap (practical: ≤ 20) | Gas / resource limits on invocation |
| Merchant list | No hard cap | Instance storage size limits (see note above) |

---

## See Also

- [docs/ARCHITECTURE.md](ARCHITECTURE.md) — High-level architecture, storage tier rationale
- `contracts/lumenflow/src/storage.rs` — Storage helper implementation
- `contracts/lumenflow/src/types.rs` — Data structure definitions
- [docs/auth-model.md](auth-model.md) — Who can read/write each key
- [docs/refund-lifecycle.md](refund-lifecycle.md) — Refund state machine and storage transitions
