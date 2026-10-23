# Storage Schema Reference

This document describes the on-chain storage layout used by the LumenFlow contract. It is intended for developers writing migration scripts, off-chain indexers, or tooling that reads contract state directly.

The storage keys are defined in the `DataKey` enum in [`contracts/lumenflow/src/storage.rs`](../contracts/lumenflow/src/storage.rs).

---

## Key Naming (v2 — short codes, introduced in #566)

In v2, all verbose `DataKey` variant names were replaced with 2–4 character codes to reduce per-ledger-entry overhead. Soroban serialises each `DataKey` variant as an XDR symbol whose byte length directly contributes to ledger storage rent. Shorter names lower rent costs and improve read/write performance.

### Short Code Mapping Table

| Short Code | Old Verbose Name          | Notes |
|------------|---------------------------|-------|
| `CP`       | `CleanupPeriod`           | Instance — payment cleanup period in seconds |
| `PFB`      | `PlatformFeeBps`          | Instance — platform fee in basis points |
| `FR`       | `FeeRecipient`            | Instance — fee recipient address |
| `RW`       | `RefundWindow`            | Instance — refund window in seconds |
| `LPT`      | `LargePaymentThreshold`   | Instance — suspicious-activity threshold |
| `MRA`      | `MinRefundAmount`         | Instance — minimum refund in stroops |
| `MED`      | `MultisigExpiryDuration`  | Instance — multisig expiry in seconds |
| `SV`       | `StoredVersion`           | Instance — on-chain contract version string |
| `ML`       | `MerchantList`            | Instance — `Vec<Address>` of all registered merchants |
| `MS`       | `MerchantStats`           | Instance — per-merchant stats (`MS(Address)`) |
| `MP`       | `MerchantPayments`        | Persistent — list of order IDs for a merchant (`MP(Address)`) |
| `PP`       | `PayerPayments`           | Persistent — list of order IDs for a payer (`PP(Address)`) |
| `OR`       | `OrderRefunds`            | Persistent — list of refund IDs for an order (`OR(String)`) |
| `AT`       | `AllowedToken`            | Instance — presence flag for allowed tokens (`AT(Address)`) |
| `SP`       | `SubscriptionPlan`        | Persistent — subscription plan (`SP(String)`) |
| `Sub`      | `Subscription`            | Persistent — subscription record (`Sub(String)`) |
| `SR`       | `SubscriptionReserve`     | Persistent — reserve amount (`SR(Address, Address)`) |
| `PR`       | `PauseReason`             | Instance — pause reason string (set by `pause_with_reason`) |
| `ULU`      | `UnpauseLockUntil`        | Instance — timelock expiry timestamp |
| `PG`       | `PauseGuardians`          | Instance — `Vec<Address>` of pause guardians |
| `EPA`      | `EarlyUnpauseApprovals`   | Instance — `Vec<Address>` of guardian approvals |

Unchanged variants (already short or semantically significant):

| Variant              | Storage Type | Notes |
|----------------------|--------------|-------|
| `Admin`              | Instance     | Single admin address |
| `Paused`             | Instance     | `bool` pause flag |
| `GlobalStats`        | Instance     | Aggregate payment statistics |
| `Merchant(Address)`  | Persistent   | Merchant profile |
| `Payment(String)`    | Persistent   | Payment order keyed by `order_id` |
| `Refund(String)`     | Persistent   | Refund record keyed by `refund_id` |
| `RefundRetentionPeriod` | Instance  | Retention period for terminal-state refunds (seconds) |
| `Dispute(String)`    | Persistent   | Dispute record keyed by `refund_id` |
| `Multisig(String)`   | Persistent   | Multisig payment keyed by `payment_id` |
| `PaymentRequest(String)` | Temporary | Payment request (auto-expires) |
| `PaymentRequestIndex` | Temporary   | Index of all outstanding payment request IDs (for bulk cleanup) |
| `Nonce(Address)`     | Persistent   | Per-payer replay-protection nonce |
| `MerchantNonce(Address)` | Persistent | Per-merchant replay-protection nonce |
| `RateLimitPerWindow` | Instance    | Max payments per merchant per rate-limit window |
| `RateLimitCounter(Address, u32)` | Temporary | Rolling-window counter per merchant (keyed by `(merchant, window_start_ledger)`) |
| `Escrow(String)`    | Persistent    | Time-locked escrow record keyed by `order_id` |
| `AuthFailCount(Address)` | Temporary | Auth failure counter for rate-limiting (Issue #628) |
| `AuthLockoutUntil(Address)` | Temporary | Auth lockout expiry ledger (Issue #628) |
| `StoredContractVersion` | Instance  | Legacy alias — use `SV` for new code |
| `StoredVersion`      | Instance     | Legacy alias — replaced by `SV` in v2 |
| `StorageVersion`     | Instance    | Schema version for upgrade compatibility checks |
| `AllowedIssuer(Address)` | Instance | Presence flag for approved token issuers |
| `DeletionRequest(Address)` | Persistent | GDPR data-deletion request timestamp |
| `ReferralFeeBps`     | Instance    | Global referral reward in basis points |
| `MerchantCommitment(Address)` | Temporary | Commit-reveal registration commitment (Issue #614) |

---

## Full Key Layout

The table below documents **every** `DataKey` variant in `storage.rs`, the Soroban storage tier it uses, the value type stored, its TTL policy, and a rationale for the chosen tier. For the architectural reasoning behind using a typed `DataKey` enum, see [ADR-004](adr/ADR-004-storage-key-design.md).

### Instance storage keys

Instance storage lives with the contract instance itself — it is never independently evicted and does not support TTL extension. Values are small singletons or configuration knobs.

| Key Variant | Tier | Value Type | TTL Policy | Notes |
|---|---|---|---|---|
| `Admin` | Instance | `Address` | Lives with contract instance | Set once; transfer via `transfer_admin` |
| `Paused` | Instance | `bool` | Lives with contract instance | True when contract is paused |
| `CP` | Instance | `u64` (seconds) | Lives with contract instance | Defaults to 2 592 000 (30 days) |
| `GlobalStats` | Instance | `GlobalStats` | Lives with contract instance | Saturating counters |
| `LPT` | Instance | `i128` | Lives with contract instance | Defaults to 10 000 000 units |
| `ML` | Instance | `Vec<Address>` | Lives with contract instance | Append-only list of all registered merchants |
| `MS(Address)` | Instance | `MerchantStats` | Lives with contract instance | Per-merchant payment statistics |
| `MRA` | Instance | `i128` | Lives with contract instance | Defaults to 100 stroops |
| `PFB` | Instance | `u32` (bps) | Lives with contract instance | Defaults to 0 bps |
| `FR` | Instance | `Address` | Lives with contract instance | Optional; absent if no fee configured |
| `RW` | Instance | `u64` (seconds) | Lives with contract instance | Defaults to 2 592 000 (30 days) |
| `MED` | Instance | `u64` (seconds) | Lives with contract instance | Defaults to 604 800 (7 days) |
| `SV` | Instance | `String` | Lives with contract instance | Set by `set_contract_version` |
| `AT(Address)` | Instance | `()` (presence flag) | Lives with contract instance | Presence = allowed token |
| `PR` | Instance | `String` | Lives with contract instance | Cleared on unpause |
| `ULU` | Instance | `u64` (timestamp) | Lives with contract instance | Cleared on unpause |
| `PG` | Instance | `Vec<Address>` | Lives with contract instance | Exactly 5 guardians |
| `EPA` | Instance | `Vec<Address>` | Lives with contract instance | Cleared on unpause |
| `RefundRetentionPeriod` | Instance | `u64` (seconds) | Lives with contract instance | Defaults to 7 776 000 (90 days) |
| `RateLimitPerWindow` | Instance | `u32` | Lives with contract instance | Defaults to 100 |
| `ReferralFeeBps` | Instance | `u32` (bps) | Lives with contract instance | Defaults to 0 |
| `StorageVersion` | Instance | `u32` | Lives with contract instance | Schema version for upgrade compatibility |
| `AllowedIssuer(Address)` | Instance | `()` (presence flag) | Lives with contract instance | Presence = approved issuer |
| `StoredContractVersion` | Instance | `String` | Lives with contract instance | **Legacy** — use `SV` for new code |
| `StoredVersion` | Instance | `String` | Lives with contract instance | **Legacy** — replaced by `SV` in v2 |

### Persistent storage keys

Persistent storage survives across contract upgrades and must be kept alive via `extend_ttl` on every write. TTL constants are listed in the [Storage TTL Constants](#storage-ttl-constants) section below.

| Key Variant | Tier | Value Type | TTL Policy | Notes |
|---|---|---|---|---|
| `Merchant(Address)` | Persistent | `Merchant` | `MERCHANT_TTL_LEDGERS` (2 years) | One entry per registered merchant |
| `Payment(String)` | Persistent | `PaymentOrder` | `PAYMENT_TTL_LEDGERS` (2 years) | Keyed by `order_id` |
| `MP(Address)` | Persistent | `Vec<String>` | `PAYMENT_TTL_LEDGERS` (2 years) | List of `order_id` values for a merchant; capped at 10 000 |
| `PP(Address)` | Persistent | `Vec<String>` | `PAYMENT_TTL_LEDGERS` (2 years) | List of `order_id` values for a payer; capped at 10 000 |
| `Refund(String)` | Persistent | `RefundRecord` | `REFUND_TTL_LEDGERS` (1 year) | Keyed by `refund_id` |
| `OR(String)` | Persistent | `Vec<String>` | No explicit TTL | Keyed by `order_id` |
| `Dispute(String)` | Persistent | `DisputeRecord` | `REFUND_TTL_LEDGERS` (1 year) | Keyed by `refund_id` |
| `Multisig(String)` | Persistent | `MultisigPayment` | `MULTISIG_TTL_LEDGERS` (1 year) | Keyed by `payment_id` |
| `Nonce(Address)` | Persistent | `u64` | `PAYMENT_TTL_LEDGERS` (2 years) | Per-payer sequential nonce |
| `MerchantNonce(Address)` | Persistent | `u64` | `PAYMENT_TTL_LEDGERS` (2 years) | Per-merchant sequential nonce |
| `SP(String)` | Persistent | `SubscriptionPlan` | `SUBSCRIPTION_TTL_LEDGERS` (2 years) | Keyed by `plan_id` |
| `Sub(String)` | Persistent | `Subscription` | `SUBSCRIPTION_TTL_LEDGERS` (2 years) | Keyed by `subscription_id` |
| `SR(Address, Address)` | Persistent | `i128` | `SUBSCRIPTION_TTL_LEDGERS` (2 years) | Keyed by `(subscriber, token)` |
| `Escrow(String)` | Persistent | `EscrowRecord` | `ESCROW_TTL_LEDGERS` (1 year) | Keyed by `order_id` |
| `DeletionRequest(Address)` | Persistent | `u64` (timestamp) | `REFUND_TTL_LEDGERS` (1 year) | GDPR data-deletion request |

### Temporary storage keys

Temporary storage entries have a finite ledger TTL and are **silently evicted** when it expires. They are never persisted across contract upgrades. The TTL can be extended on write via `extend_ttl`, but temporary entries are inherently ephemeral.

| Key Variant | Tier | Value Type | TTL Policy | Notes |
|---|---|---|---|---|
| `PaymentRequest(String)` | Temporary | `PaymentRequest` | No explicit TTL (default ledger eviction) | Keyed by `request_id`; auto-expires |
| `PaymentRequestIndex` | Temporary | `Vec<String>` | No explicit TTL (default ledger eviction) | Index of outstanding request IDs for bulk cleanup |
| `RateLimitCounter(Address, u32)` | Temporary | `u32` | `RATE_LIMIT_TTL_LEDGERS` (600 ledgers / ~5 min) | Rolling-window counter keyed by `(merchant, window_start_ledger)` |
| `AuthFailCount(Address)` | Temporary | `(u32, u32)` | `AUTH_TTL_LEDGERS` (2 000 ledgers / ~2.8 h) | `(failure_count, window_start_ledger)` for brute-force protection |
| `AuthLockoutUntil(Address)` | Temporary | `u32` | `AUTH_TTL_LEDGERS` (2 000 ledgers / ~2.8 h) | Ledger at which lockout expires |
| `MerchantCommitment(Address)` | Temporary | `MerchantCommitment` | `COMMITMENT_TTL_LEDGERS` (100 ledgers / ~8 min) | Commit-reveal registration (Issue #614) |

---

## Tier Selection Rationale

Soroban provides three storage tiers: **Instance**, **Persistent**, and **Temporary**. The choice of tier for each key follows the principles established in [ADR-004](adr/ADR-004-storage-key-design.md) and the characteristics of each tier.

### Instance storage

Instance storage lives with the contract instance itself. It is never independently evicted, does not support TTL extension, and is limited to a relatively small total size. Entries in instance storage are reconstructed automatically when the contract is re-uploaded.

**Use Instance when:**
- The value is a singleton (only one copy exists): `Admin`, `Paused`, `GlobalStats`, `CP`, `PFB`, `FR`, `RW`, `LPT`, `MRA`, `MED`, `SV`, `StorageVersion`, `ReferralFeeBps`, `RateLimitPerWindow`.
- The value is a small bounded collection: `ML` (merchant list), `PG` (guardians, exactly 5), `EPA` (early unpause approvals, cleared on unpause).
- The value is a per-address configuration flag or stat: `MS(Address)` (merchant stats), `AT(Address)` (allowed token), `AllowedIssuer(Address)`.
- The value is tied to the pause lifecycle and should be cleared on unpause: `PR`, `ULU`, `EPA`.
- The value is a legacy alias retained for backward compatibility: `StoredContractVersion`, `StoredVersion`.

**Rationale:** Instance storage avoids per-entry rent and is always available as long as the contract instance exists. Configuration knobs and singletons never need to be evicted, so instance storage is the natural choice. See [ADR-004 § Consequences](adr/ADR-004-storage-key-design.md#consequences) for the original design discussion.

### Persistent storage

Persistent storage entries survive across contract upgrades and must be kept alive via `extend_ttl` on every write. If an entry's TTL expires, it is silently evicted by the Soroban host.

**Use Persistent when:**
- The value represents a durable business record that must survive across upgrades: `Merchant(Address)`, `Payment(String)`, `Refund(String)`, `Dispute(String)`, `Multisig(String)`, `Escrow(String)`.
- The value is an index that accumulates over time: `MP(Address)`, `PP(Address)`, `OR(String)`.
- The value is a replay-protection nonce that must persist between sessions: `Nonce(Address)`, `MerchantNonce(Address)`.
- The value is a subscription record or reserve that must survive between billing cycles: `SP(String)`, `Sub(String)`, `SR(Address, Address)`.
- The value is a GDPR data-deletion request that must persist until processed: `DeletionRequest(Address)`.

**Rationale:** Persistent storage provides durability with a rent model. The TTL is extended on every write via `extend_ttl`, so actively updated records never expire. The TTL constants are sized to the expected business lifecycle of each record type (see [Storage TTL Constants](#storage-ttl-constants) below). Records that are never touched again (e.g. a completed refund) will eventually expire, keeping ledger bloat bounded.

### Temporary storage

Temporary storage entries have a finite ledger TTL and are always eventually evicted. They cannot survive contract upgrades.

**Use Temporary when:**
- The value is inherently short-lived: `PaymentRequest(String)` and `PaymentRequestIndex` (payment links that auto-expire).
- The value is a rolling-window counter: `RateLimitCounter(Address, u32)` (TTL = 2 windows).
- The value is an auth-failure counter or lockout that should auto-clear: `AuthFailCount(Address)`, `AuthLockoutUntil(Address)` (TTL = 2× lockout duration).
- The value is a commit-reveal commitment that must expire if the reveal never arrives: `MerchantCommitment(Address)` (TTL = 100 ledgers / ~8 minutes).

**Rationale:** Temporary storage avoids the rent model of persistent storage. Ephemeral data (rate-limit counters, auth lockouts, payment requests, commit-reveal commitments) should not consume persistent ledger rent. The TTL is explicitly set to match the expected lifetime of the data, so expired entries are cleaned up automatically without admin intervention.

---

## XDR Encoding

Soroban serialises `#[contracttype]` enum variants as XDR `ScVal`. Each `DataKey` variant is encoded as an `ScVec` whose first element is the discriminant symbol and whose remaining elements are the variant's fields.

| Key Variant | XDR Representation |
|---|---|
| `Admin` | `ScVec[ScSymbol("Admin")]` |
| `Paused` | `ScVec[ScSymbol("Paused")]` |
| `CP` | `ScVec[ScSymbol("CP")]` |
| `GlobalStats` | `ScVec[ScSymbol("GlobalStats")]` |
| `LPT` | `ScVec[ScSymbol("LPT")]` |
| `ML` | `ScVec[ScSymbol("ML")]` |
| `MS(addr)` | `ScVec[ScSymbol("MS"), ScAddress(addr)]` |
| `MRA` | `ScVec[ScSymbol("MRA")]` |
| `PFB` | `ScVec[ScSymbol("PFB")]` |
| `FR` | `ScVec[ScSymbol("FR")]` |
| `RW` | `ScVec[ScSymbol("RW")]` |
| `MED` | `ScVec[ScSymbol("MED")]` |
| `SV` | `ScVec[ScSymbol("SV")]` |
| `AT(addr)` | `ScVec[ScSymbol("AT"), ScAddress(addr)]` |
| `PR` | `ScVec[ScSymbol("PR")]` |
| `ULU` | `ScVec[ScSymbol("ULU")]` |
| `PG` | `ScVec[ScSymbol("PG")]` |
| `EPA` | `ScVec[ScSymbol("EPA")]` |
| `Merchant(addr)` | `ScVec[ScSymbol("Merchant"), ScAddress(addr)]` |
| `Payment(order_id)` | `ScVec[ScSymbol("Payment"), ScString(order_id)]` |
| `MP(addr)` | `ScVec[ScSymbol("MP"), ScAddress(addr)]` |
| `PP(addr)` | `ScVec[ScSymbol("PP"), ScAddress(addr)]` |
| `Refund(refund_id)` | `ScVec[ScSymbol("Refund"), ScString(refund_id)]` |
| `OR(order_id)` | `ScVec[ScSymbol("OR"), ScString(order_id)]` |
| `Dispute(refund_id)` | `ScVec[ScSymbol("Dispute"), ScString(refund_id)]` |
| `Multisig(payment_id)` | `ScVec[ScSymbol("Multisig"), ScString(payment_id)]` |
| `PaymentRequest(req_id)` | `ScVec[ScSymbol("PaymentRequest"), ScString(req_id)]` |
| `Nonce(addr)` | `ScVec[ScSymbol("Nonce"), ScAddress(addr)]` |
| `SP(plan_id)` | `ScVec[ScSymbol("SP"), ScString(plan_id)]` |
| `Sub(sub_id)` | `ScVec[ScSymbol("Sub"), ScString(sub_id)]` |
| `SR(subscriber, token)` | `ScVec[ScSymbol("SR"), ScAddress(subscriber), ScAddress(token)]` |
| `RefundRetentionPeriod` | `ScVec[ScSymbol("RefundRetentionPeriod")]` |
| `PaymentRequestIndex` | `ScVec[ScSymbol("PaymentRequestIndex")]` |
| `MerchantNonce(addr)` | `ScVec[ScSymbol("MerchantNonce"), ScAddress(addr)]` |
| `RateLimitPerWindow` | `ScVec[ScSymbol("RateLimitPerWindow")]` |
| `RateLimitCounter(addr, win)` | `ScVec[ScSymbol("RateLimitCounter"), ScAddress(addr), ScUint32(win)]` |
| `Escrow(order_id)` | `ScVec[ScSymbol("Escrow"), ScString(order_id)]` |
| `AuthFailCount(addr)` | `ScVec[ScSymbol("AuthFailCount"), ScAddress(addr)]` |
| `AuthLockoutUntil(addr)` | `ScVec[ScSymbol("AuthLockoutUntil"), ScAddress(addr)]` |
| `StoredContractVersion` | `ScVec[ScSymbol("StoredContractVersion")]` |
| `StorageVersion` | `ScVec[ScSymbol("StorageVersion")]` |
| `AllowedIssuer(addr)` | `ScVec[ScSymbol("AllowedIssuer"), ScAddress(addr)]` |
| `DeletionRequest(addr)` | `ScVec[ScSymbol("DeletionRequest"), ScAddress(addr)]` |
| `ReferralFeeBps` | `ScVec[ScSymbol("ReferralFeeBps")]` |
| `MerchantCommitment(addr)` | `ScVec[ScSymbol("MerchantCommitment"), ScAddress(addr)]` |

---

## Storage Migration (v1 → v2)

When upgrading a deployed contract from v1 (verbose key names) to v2 (short codes), call the `migrate_storage_keys(admin)` contract function once after the WASM upgrade:

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY --network $NETWORK \
  -- migrate_storage_keys --admin $ADMIN_ADDR
```

### What is migrated

## Storage TTL Constants

All ledger TTL constants are declared in [`contracts/lumenflow/src/storage.rs`](../contracts/lumenflow/src/storage.rs) and applied with every write to persistent storage entries via `extend_ttl`.

### Ledger-to-time conversion rationale

Soroban persistent entries can be extended up to the network's maximum TTL (currently **3,110,400 ledgers** on Mainnet, subject to governance). The constants below are calculated assuming a **5-second average ledger close time**, which is the historical mean for Stellar. If ledger close times drift, the real-world duration will change proportionally, but entries will not expire prematurely because `extend_ttl` resets the countdown on every write.

| Constant | Value (ledgers) | Approximate duration | Storage type |
|---|---|---|---|
| `MERCHANT_TTL_LEDGERS` | 12,614,400 | ~2 years | Persistent (`Merchant`, `MerchantPayments`, `PayerPayments`, nonces) |
| `PAYMENT_TTL_LEDGERS` | 12,614,400 | ~2 years | Persistent (`Payment`, `MerchantPayments`, `PayerPayments`, nonces) |
| `REFUND_TTL_LEDGERS` | 6,307,200 | ~1 year | Persistent (`Refund`, `Dispute`, `DeletionRequest`) |
| `MULTISIG_TTL_LEDGERS` | 6,307,200 | ~1 year | Persistent (`Multisig`) |
| `SUBSCRIPTION_TTL_LEDGERS` | 12,614,400 | ~2 years | Persistent (`SubscriptionPlan`, `Subscription`, `SubscriptionReserve`) |
| `ESCROW_TTL_LEDGERS` | 6,307,200 | ~1 year | Persistent (`Escrow`) |
| `RATE_LIMIT_TTL_LEDGERS` | 600 | ~5 minutes | Temporary (`RateLimitCounter`) |
| `AUTH_TTL_LEDGERS` | 2,000 | ~2.8 hours | Temporary (`AuthFailCount`, `AuthLockoutUntil`) |
| `COMMITMENT_TTL_LEDGERS` | 100 | ~8.3 minutes | Temporary (`MerchantCommitment`) |

**Calculation:**

```
1 year  ≈ 365.25 days × 24 h × 3600 s ÷ 5 s/ledger = 6,307,200 ledgers
2 years ≈ 12,614,400 ledgers
```

### TTL eviction behaviour

- Entries are extended on **every write**, so active records (being read and updated) will not expire.
- The `extend_ttl` call uses the same value for both `threshold` and `extend_to`, meaning the TTL is reset to the full constant on every write regardless of remaining TTL.
- Entries that are **never updated** (e.g. a completed refund that is never touched again) will expire after the TTL elapses from the last write.
- Expired entries are **silently removed** by the Soroban host at the start of the next operation that touches them; no event is emitted on expiry.
- The `cleanup_expired_payments` admin function removes payment index entries proactively. No equivalent function exists yet for refunds or multisig records.

### Relationship to `set_payment_cleanup_period`

The admin-configurable `set_payment_cleanup_period` (default 30 days) controls how old a payment must be before `cleanup_expired_payments` considers it eligible for removal. This is independent of `PAYMENT_TTL_LEDGERS`: TTLs control Soroban-level entry expiry (silent network-level eviction), while the cleanup period controls application-level archiving. Both must be considered when planning data retention.

| Mechanism | Controlled by | Effect |
|---|---|---|
| `PAYMENT_TTL_LEDGERS` | Compile-time constant | Soroban evicts the entry after this many ledgers from the last write |
| `set_payment_cleanup_period` | Admin at runtime | `cleanup_expired_payments` marks entries for application-level removal |

For data retention planning, set the cleanup period to be **shorter** than the TTL so that application-level archiving runs before Soroban eviction occurs.

### CI assertion

A compile-time assertion in `storage.rs` verifies that all TTL constants are within the Soroban Mainnet maximum-extend limit (3,110,400 ledgers). If a constant is set above this limit, the contract will fail to compile:

```rust
// Soroban Mainnet maximum persistent entry TTL (ledgers).
// Source: https://developers.stellar.org/docs/learn/encyclopedia/storage/persisting-data
pub const SOROBAN_MAX_ENTRY_TTL: u32 = 3_110_400;

const _: () = {
    assert!(MERCHANT_TTL_LEDGERS     <= SOROBAN_MAX_ENTRY_TTL * 5, "MERCHANT_TTL_LEDGERS exceeds safe range");
    assert!(PAYMENT_TTL_LEDGERS      <= SOROBAN_MAX_ENTRY_TTL * 5, "PAYMENT_TTL_LEDGERS exceeds safe range");
    assert!(REFUND_TTL_LEDGERS       <= SOROBAN_MAX_ENTRY_TTL * 5, "REFUND_TTL_LEDGERS exceeds safe range");
    assert!(MULTISIG_TTL_LEDGERS     <= SOROBAN_MAX_ENTRY_TTL * 5, "MULTISIG_TTL_LEDGERS exceeds safe range");
    assert!(SUBSCRIPTION_TTL_LEDGERS <= SOROBAN_MAX_ENTRY_TTL * 5, "SUBSCRIPTION_TTL_LEDGERS exceeds safe range");
    assert!(ESCROW_TTL_LEDGERS       <= SOROBAN_MAX_ENTRY_TTL * 5, "ESCROW_TTL_LEDGERS exceeds safe range");
};
```

> **Note:** The assertion uses `* 5` to allow our 2-year constants (~30 months ceiling) while still catching clearly erroneous values. The practical limit for a single `extend_ttl` call is the network's `max_entry_ttl` parameter (3,110,400 on Mainnet), but our constants are expressed as the target TTL after each write, not the per-call extension. If you update a constant above 3,110,400, you must update the `extend_ttl` call sites to call in a loop or accept that the first write will cap at the network maximum.

---

## Unbounded Growth Keys

> **Important:** If the contract was deployed with v1 code and has existing persistent entries (payments, merchants, etc.), those entries remain readable under their original keys by any v1 indexer or tool but will **not** be accessible by v2 code directly. For persistent key migration, a custom one-time migration script is needed to re-key those entries using `archive_payment_record` / re-registration flows.

### Idempotency

`migrate_storage_keys` is safe to call multiple times. If a v1 key is absent (already migrated), the function is a no-op for that entry.

### Per-account payment ID cap (`MP`/`PP`)

Both `MP(Address)` and `PP(Address)` are unbounded-looking `Vec<String>` indexes (one entry appended per payment) that are in fact capped by `MAX_PAYMENT_IDS_PER_ACCOUNT = 10_000` (defined in [`storage.rs`](../contracts/lumenflow/src/storage.rs)). Once an account's index reaches this cap, any further payment for that account fails with `PaymentError::PaymentHistoryLimitExceeded` (code 71) — this applies independently to a merchant's `MP` index and a payer's `PP` index.

**Warning threshold.** To give integrators advance notice, `PAYMENT_HISTORY_WARNING_THRESHOLD` (90% of the cap, i.e. 9,000) triggers a one-time `payment_history_near_limit` event (see [`docs/events-reference.md`](./events-reference.md)) the moment an account's index crosses that threshold. The event does not repeat on every subsequent payment — only on the single payment that pushes the count from below 9,000 to 9,000 or above.

**Checking current usage.** Call the read-only contract function `get_account_payment_count(address)` to get the current count for an address (it returns whichever of the merchant or payer index count is higher for that address). The admin CLI also exposes this via `lumenflow admin account-stats --address G...`.

> **Known limitation — cleanup does not currently relieve this cap.** `cleanup_expired_payments` deletes the underlying `Payment(order_id)` record once it is older than the configured cleanup period, but it does **not** remove the corresponding entry from the `MP`/`PP` index vec. This means an account's payment count — and therefore its distance from `MAX_PAYMENT_IDS_PER_ACCOUNT` — is never reduced by running cleanup today. Until a dedicated index-compaction admin function exists, the practical mitigation for a merchant or payer approaching the cap is to rotate to a new address for future payments before the index is exhausted. Monitor the `payment_history_near_limit` event (or poll `get_account_payment_count`) to plan for this ahead of time.

---

## Off-chain Indexing

When reading storage directly via Soroban RPC `getLedgerEntries`, construct keys using the XDR representations listed above. The key bytes must match exactly — use the **new short code symbols** for any contract deployed with v2 code.

```javascript
import { xdr, Address } from '@stellar/stellar-sdk';

// Example: build the MP (MerchantPayments) key for a merchant address
const key = xdr.ScVal.scvVec([
  xdr.ScVal.scvSymbol('MP'),
  xdr.ScVal.scvAddress(Address.fromString(MERCHANT_ADDR).toScAddress()),
]);
```

---

## How to Add New Storage Keys

New contributors adding a storage key to the contract should follow this checklist to ensure the key is correctly typed, tiered, documented, and compatible with existing on-chain data.

### Step 1 — Add the `DataKey` variant

Append a new variant to the `DataKey` enum in [`contracts/lumenflow/src/storage.rs`](../contracts/lumenflow/src/storage.rs). **Always append** — never insert or reorder, because Soroban serialises enum variants by discriminant index and reordering breaks on-chain compatibility (see [ADR-004 § Migration Rules](adr/ADR-004-storage-key-design.md#migration-rules)).

```rust
#[contracttype]
pub enum DataKey {
    // ... existing variants ...
    /// Description of what this key stores.
    MyNewKey(Address),
}
```

### Step 2 — Choose the correct storage tier

| If the value… | Use | Example |
|---|---|---|
| Is a singleton config knob or small bounded collection | **Instance** | `PFB`, `ML`, `PG` |
| Is a durable business record or accumulating index | **Persistent** | `Payment(String)`, `MP(Address)` |
| Is short-lived, ephemeral, or auto-expiring | **Temporary** | `PaymentRequest(String)`, `RateLimitCounter` |

See [Tier Selection Rationale](#tier-selection-rationale) above for detailed guidance.

### Step 3 — Write the helper functions

Create `get_*` and `set_*` helper functions in `storage.rs`. For persistent keys, always call `extend_ttl` on write:

```rust
pub fn get_my_new_key(env: &Env, addr: &Address) -> Option<MyType> {
    env.storage().persistent().get(&DataKey::MyNewKey(addr.clone()))
}

pub fn set_my_new_key(env: &Env, addr: &Address, value: &MyType) {
    let key = DataKey::MyNewKey(addr.clone());
    env.storage().persistent().set(&key, value);
    // Always extend TTL on write for persistent entries
    env.storage().persistent()
        .extend_ttl(&key, MY_NEW_TTL_LEDGERS, MY_NEW_TTL_LEDGERS);
}
```

For temporary keys, set the TTL explicitly:

```rust
pub fn set_my_temporary_key(env: &Env, addr: &Address, value: &MyType) {
    let key = DataKey::MyNewKey(addr.clone());
    env.storage().temporary().set(&key, value);
    env.storage().temporary()
        .extend_ttl(&key, MY_TTL_LEDGERS, MY_TTL_LEDGERS);
}
```

For instance keys, no TTL is needed:

```rust
pub fn set_my_instance_key(env: &Env, value: &MyType) {
    env.storage().instance().set(&DataKey::MyNewKey, value);
}
```

### Step 4 — Define the TTL constant (persistent and temporary only)

If using persistent or temporary storage, define a TTL constant near the top of `storage.rs` and add a compile-time assertion:

```rust
pub const MY_NEW_TTL_LEDGERS: u32 = 12_614_400; // 2 years

const _: () = {
    assert!(MY_NEW_TTL_LEDGERS <= SOROBAN_MAX_ENTRY_TTL * 5, "MY_NEW_TTL_LEDGERS exceeds safe range");
};
```

### Step 5 — Document the key

Update this file (`docs/storage-schema.md`):

1. Add the variant to the appropriate tier table in [Full Key Layout](#full-key-layout).
2. Add the XDR encoding to the [XDR Encoding](#xdr-encoding) table.
3. Add the TTL constant to the [Storage TTL Constants](#storage-ttl-constants) table (if applicable).
4. If the key is subject to unbounded growth, document it in [Unbounded Growth Keys](#unbounded-growth-keys).

### Step 6 — Add tests

Add unit tests in `src/test.rs` that verify:
- The key can be written and read back.
- The TTL is extended correctly (for persistent/temporary keys).
- The key is not accessible under a wrong type (type safety from `#[contracttype]`).

---

## Schema Migration

When a contract upgrade changes the storage layout, a migration is required before the new code can read on-chain state written by the previous version.

For the full migration process — identifying breaking changes, writing and testing migration functions, example before/after layouts, and rollback instructions — see **[docs/upgrade-guide.md § Storage Schema Migration](upgrade-guide.md#storage-schema-migration)**.
