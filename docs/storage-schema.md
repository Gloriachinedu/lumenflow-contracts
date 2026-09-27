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
| `Dispute(String)`    | Persistent   | Dispute record keyed by `refund_id` |
| `Multisig(String)`   | Persistent   | Multisig payment keyed by `payment_id` |
| `PaymentRequest(String)` | Temporary | Payment request (auto-expires) |
| `Nonce(Address)`     | Persistent   | Per-payer replay-protection nonce |

---

## Full Key Layout

| Key Variant | Storage Type | Value Type | TTL Policy | Notes |
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
| `Merchant(Address)` | Persistent | `Merchant` | TTL extended to 2 years on write | One entry per registered merchant |
| `Payment(String)` | Persistent | `PaymentOrder` | TTL extended to 2 years on write | Keyed by `order_id` |
| `MP(Address)` | Persistent | `Vec<String>` | TTL extended to 2 years on write | List of `order_id` values for a merchant |
| `PP(Address)` | Persistent | `Vec<String>` | TTL extended to 2 years on write | List of `order_id` values for a payer |
| `Refund(String)` | Persistent | `RefundRecord` | TTL extended to 1 year on write | Keyed by `refund_id` |
| `OR(String)` | Persistent | `Vec<String>` | No explicit TTL | Keyed by `order_id` |
| `Dispute(String)` | Persistent | `DisputeRecord` | No explicit TTL | Keyed by `refund_id` |
| `Multisig(String)` | Persistent | `MultisigPayment` | TTL extended to 1 year on write | Keyed by `payment_id` |
| `PaymentRequest(String)` | Temporary | `PaymentRequest` | Expires with ledger TTL | Keyed by `request_id`; auto-expires |
| `Nonce(Address)` | Persistent | `u64` | TTL extended to 2 years on write | Per-payer sequential nonce |
| `SP(String)` | Persistent | `SubscriptionPlan` | TTL extended to 2 years on write | Keyed by `plan_id` |
| `Sub(String)` | Persistent | `Subscription` | TTL extended to 2 years on write | Keyed by `subscription_id` |
| `SR(Address, Address)` | Persistent | `i128` | TTL extended to 2 years on write | Keyed by `(subscriber, token)` |

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
| `REFUND_TTL_LEDGERS` | 6,307,200 | ~1 year | Persistent (`Refund`) |
| `MULTISIG_TTL_LEDGERS` | 6,307,200 | ~1 year | Persistent (`Multisig`) |
| `SUBSCRIPTION_TTL_LEDGERS` | 12,614,400 | ~2 years | Persistent (`SubscriptionPlan`, `Subscription`, `SubscriptionReserve`) |
| `ESCROW_TTL_LEDGERS` | 6,307,200 | ~1 year | Persistent (`Escrow`) |

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
