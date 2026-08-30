# LumenFlow Data Classification and Retention

This document defines how each data element processed by LumenFlow is classified, where it is stored, how long it is retained, and what controls govern access and deletion. It is the authoritative reference for privacy impact assessments, compliance reviews, and operational runbooks.

For the full GDPR policy and data subject rights, see [PRIVACY.md](../PRIVACY.md).  
For artifact and CI retention, see [docs/artifact-retention.md](artifact-retention.md).

---

## Classification Tiers

| Tier | Label | Definition | Examples |
|------|-------|------------|---------|
| 1 | **Personal** | Directly identifies a natural person | Name, email address |
| 2 | **Pseudonymous** | Cannot directly identify a person without additional information, but is linkable | Stellar public key (wallet address) |
| 3 | **Potentially Personal** | May identify a person depending on context (e.g., sole trader using personal details) | Free-text description, memo |
| 4 | **Non-Personal** | No reasonable likelihood of identifying a person | Amounts, timestamps, business categories |
| 5 | **System / Operational** | Internal infrastructure data with no direct business-data PII | Prometheus metrics, cursor files |

---

## On-Chain Contract Storage

Data stored in Soroban contract storage is replicated across all Stellar network validators and is **blockchain-immutable** except where an explicit anonymisation mechanism exists (see [Anonymisable fields](#anonymisable-fields)).

### Merchant Profile (`Merchant` struct)

| Field | Type | Classification | Anonymisable | Notes |
|-------|------|----------------|-------------|-------|
| `address` | `Address` | Tier 2 — Pseudonymous | No | Retained as reference integrity anchor after deletion |
| `name` | `String` | Tier 1/3 — Personal / Potentially Personal | **Yes** | Replaced with `[deleted]` on confirmed deletion request |
| `description` | `String` | Tier 3 — Potentially Personal | **Yes** | Replaced with `[deleted]` on confirmed deletion request |
| `contact_info` | `String` | Tier 1 — Personal | **Yes** | Replaced with `[deleted]` on confirmed deletion request |
| `category` | `MerchantCategory` | Tier 4 — Non-Personal | No | Business category enum |
| `active` | `bool` | Tier 4 — Non-Personal | No | Account status flag |
| `verified` | `bool` | Tier 4 — Non-Personal | No | Admin-assigned verification status |
| `registered_at` | `u64` | Tier 4 — Non-Personal | No | Unix timestamp |
| `total_received` | `i128` | Tier 4 — Non-Personal | No | Cumulative payment volume in stroops |

### Payment Record (`PaymentOrder` struct)

| Field | Type | Classification | Anonymisable | Notes |
|-------|------|----------------|-------------|-------|
| `order_id` | `String` | Tier 4 — Non-Personal | No | Merchant-assigned unique identifier |
| `payer` | `Address` | Tier 2 — Pseudonymous | No | Blockchain-immutable |
| `merchant_address` | `Address` | Tier 2 — Pseudonymous | No | Blockchain-immutable |
| `token_address` | `Address` | Tier 4 — Non-Personal | No | SAC token contract address |
| `amount` | `i128` | Tier 4 — Non-Personal | No | Amount in stroops |
| `memo` | `Option<String>` | Tier 3 — Potentially Personal | No | User-provided note; avoid storing PII here |
| `tags` | `Option<Vec<String>>` | Tier 4 — Non-Personal | No | Merchant-defined categorisation tags |
| `paid_at` | `u64` | Tier 4 — Non-Personal | No | Unix timestamp |
| `status` | `PaymentStatus` | Tier 4 — Non-Personal | No | `Completed` / `PartiallyRefunded` / `FullyRefunded` |
| `refunded_amount` | `i128` | Tier 4 — Non-Personal | No | Cumulative refunded stroops |

### Refund Record (`RefundRecord` struct)

| Field | Type | Classification | Anonymisable | Notes |
|-------|------|----------------|-------------|-------|
| `refund_id` | `String` | Tier 4 — Non-Personal | No | Unique refund identifier |
| `order_id` | `String` | Tier 4 — Non-Personal | No | Links to the originating payment |
| `amount` | `i128` | Tier 4 — Non-Personal | No | Requested refund amount in stroops |
| `reason` | `Option<String>` | Tier 3 — Potentially Personal | No | User-provided reason; avoid PII |
| `initiated_at` | `u64` | Tier 4 — Non-Personal | No | Unix timestamp |
| `status` | `RefundStatus` | Tier 4 — Non-Personal | No | `Pending` / `Approved` / `Rejected` / `Executed` |

### Multi-Signature Payment (`MultisigPayment` struct)

| Field | Type | Classification | Anonymisable | Notes |
|-------|------|----------------|-------------|-------|
| `payment_id` | `String` | Tier 4 — Non-Personal | No | Unique payment identifier |
| `initiator` | `Address` | Tier 2 — Pseudonymous | No | Initiating address |
| `merchant_address` | `Address` | Tier 2 — Pseudonymous | No | Recipient merchant |
| `signers` | `Vec<Address>` | Tier 2 — Pseudonymous | No | Authorised signer set |
| `amount` | `i128` | Tier 4 — Non-Personal | No | Amount in stroops |
| `required_signatures` | `u32` | Tier 4 — Non-Personal | No | Approval threshold |

### Payment Request (`PaymentRequest` struct)

| Field | Type | Classification | Anonymisable | Notes |
|-------|------|----------------|-------------|-------|
| `request_id` | `String` | Tier 4 — Non-Personal | No | Merchant-assigned identifier |
| `merchant` | `Address` | Tier 2 — Pseudonymous | No | Requesting merchant |
| `token_address` | `Address` | Tier 4 — Non-Personal | No | SAC token |
| `amount` | `i128` | Tier 4 — Non-Personal | No | Requested amount |
| `memo` | `Option<String>` | Tier 3 — Potentially Personal | No | Avoid storing PII in memo |
| `ttl` | `u64` | Tier 4 — Non-Personal | No | Time-to-live in seconds |

---

## On-Chain Event Logs (Horizon Archive)

Events emitted by LumenFlow are recorded on the Stellar blockchain and indexed by Horizon nodes. They are **permanently immutable** — neither LumenFlow's deletion procedure nor any admin function can remove them.

| Event | Data included | Classification |
|-------|--------------|----------------|
| `lumenflow/admin_set` | Admin `Address` | Tier 2 — Pseudonymous |
| `lumenflow/merchant_registered` | Merchant `Address` | Tier 2 — Pseudonymous |
| `lumenflow/merchant_updated` | Merchant `Address` | Tier 2 — Pseudonymous |
| `lumenflow/merchant_deactivated` | Merchant `Address` | Tier 2 — Pseudonymous |
| `lumenflow/payment_processed` | `order_id`, payer `Address`, `amount`; merchant `Address` in `topic[2]` | Tier 2 + Tier 4 |
| `lumenflow/refund_initiated` | `refund_id`, `order_id`; merchant `Address` in `topic[2]` | Tier 2 + Tier 4 |
| `lumenflow/refund_approved` | `refund_id`, `order_id`; merchant `Address` in `topic[2]` | Tier 2 + Tier 4 |
| `lumenflow/refund_rejected` | `refund_id`, `order_id`; merchant `Address` in `topic[2]` | Tier 2 + Tier 4 |
| `lumenflow/refund_executed` | `refund_id`, `order_id`; merchant `Address` in `topic[2]` | Tier 2 + Tier 4 |
| `lumenflow/payment_archived` | `order_id` | Tier 4 — Non-Personal |
| `lumenflow/multisig_initiated` | `payment_id` | Tier 4 — Non-Personal |
| `lumenflow/multisig_executed` | `payment_id` | Tier 4 — Non-Personal |
| `lumenflow/payment_request_paid` | `request_id` | Tier 4 — Non-Personal |
| `lumenflow/suspicious_activity` | `reason`, actor `Address`, `value` | Tier 2 + Tier 4 |
| `lumenflow/merchant_deletion_requested` | Merchant `Address` | Tier 2 — Pseudonymous |
| `lumenflow/merchant_data_deleted` | Merchant `Address` | Tier 2 — Pseudonymous |
| `lumenflow/contract_paused` | `()` or `(reason, lock_until)` | Tier 4 / Tier 3 |
| `lumenflow/contract_unpaused` | `()` or `"multisig_override"` | Tier 4 — Non-Personal |

> **Note:** Event topics (`topic[2]` merchant addresses) appear in Horizon's SSE stream verbatim. Applications that store Horizon event data off-chain must treat these records as Tier-2 pseudonymous data.

---

## Retention Schedule

### Contract Storage Retention

| Data type | Default retention | Configuration | Deletion mechanism |
|-----------|-----------------|---------------|--------------------|
| Merchant profile (non-PII fields) | Indefinite | Not configurable | Admin: `deactivate_merchant` (soft); no hard delete |
| Merchant profile (PII fields: `name`, `description`, `contact_info`) | Until deletion confirmed | N/A | `request_merchant_data_deletion` + `confirm_merchant_data_deletion` |
| Payment records | 90 days (cleanup period) | `set_payment_cleanup_period` (admin) | `cleanup_expired_payments` (admin); `archive_payment_record` (admin, single record) |
| Refund records | Tied to payment record lifetime | Same as payment records | Removed with associated payment |
| Multi-signature payments | 30 days (expiry duration) | `set_multisig_expiry_duration` (admin) | Automatically expired; not queryable after expiry |
| Payment requests | TTL set by merchant at creation | Per-request `ttl` field | Automatically expired after TTL |
| Merchant nonce | Indefinite | Not configurable | Not deletable; integrity requirement |
| Global stats | Indefinite | Not configurable | Not deletable; aggregate counters |

### Off-Chain / Infrastructure Retention

| Artifact / data | Location | Retention | Owner |
|-----------------|----------|-----------|-------|
| CI WASM build artifacts | GitHub Actions | 30 days | DevOps Team |
| Prometheus metrics (scraped) | Prometheus TSDB | Configurable (default: 15 days) | DevOps Team |
| Grafana dashboard snapshots | Grafana instance | Configurable | DevOps Team |
| Exporter cursor file | Monitoring host | Persistent (until manual deletion) | DevOps Team |
| Replay script SQLite output | Local / ephemeral | Manual cleanup after use | Operator |
| Horizon event stream (historical) | Stellar archive nodes | Subject to Stellar Foundation policy | Stellar Foundation |
| GitHub Actions logs | GitHub | 90 days (GitHub default) | GitHub |
| Testnet deployment secrets | GitHub Secrets | Until manually rotated or deleted | Smart Contract Team |

---

## Anonymisable Fields

The following fields can be anonymised via the contract's data-deletion workflow. After anonymisation, the value is replaced with the UTF-8 string `[deleted]`.

| Record type | Field | Anonymisation trigger |
|-------------|-------|----------------------|
| `Merchant` | `name` | Admin confirms `confirm_merchant_data_deletion` |
| `Merchant` | `description` | Admin confirms `confirm_merchant_data_deletion` |
| `Merchant` | `contact_info` | Admin confirms `confirm_merchant_data_deletion` |

Fields **not** anonymised by this process (immutable or integrity-critical):

- `Merchant.address` — retained as a pseudonymous reference anchor
- All `PaymentOrder` fields — retained for financial record-keeping under GDPR Art. 6(1)(c)
- All on-chain event log entries — blockchain-immutable

For the full deletion procedure, see [PRIVACY.md § 5](../PRIVACY.md#5-right-to-erasure-right-to-be-forgotten) and [docs/merchant-onboarding.md — Data Deletion](merchant-onboarding.md#data-deletion).

---

## Access Control by Data Tier

| Tier | Read access | Write / update access | Delete / anonymise access |
|------|-------------|----------------------|--------------------------|
| Tier 1 — Personal (`name`, `description`, `contact_info`) | Merchant (own record), Admin | Merchant (own record via `update_merchant`) | Admin (`confirm_merchant_data_deletion`) |
| Tier 2 — Pseudonymous (wallet addresses) | Any caller (public blockchain) | N/A (immutable after set) | Not deletable |
| Tier 3 — Potentially Personal (`memo`, `reason`) | Merchant + Payer (via `get_payment_by_id`), Admin | Set at creation only | Not deletable; avoid placing PII here |
| Tier 4 — Non-Personal (amounts, timestamps, stats) | Public | Contract functions per permission model | Admin (`cleanup_expired_payments`, `archive_payment_record`) |

For the complete permission matrix, see [docs/access-control.md](access-control.md).

---

## Guidance for Integrators

- **Do not store PII in `memo` or `reason` fields.** These fields are non-anonymisable. Use opaque reference IDs (e.g., invoice numbers) instead of names or email addresses.
- **Treat all wallet addresses as pseudonymous (Tier 2)**, not anonymous. With additional data (KYC records, IP logs), addresses can potentially be linked to natural persons.
- **Off-chain systems that index Horizon events** must apply their own retention and deletion policies to comply with GDPR and equivalent regulations. LumenFlow's on-contract deletion procedure does not extend to off-chain copies.
- **Replay script output** (`replay-db-*.sqlite`, `replay-output-*.csv`) contains pseudonymous identifiers. Delete these files after use or store them in a secure, access-controlled location.
- **Test data:** Never use real personal data in test environments. Use generated/synthetic merchant profiles when testing against local or testnet deployments.

---

## Further Reading

- [PRIVACY.md](../PRIVACY.md) — full GDPR policy and data subject rights
- [docs/artifact-retention.md](artifact-retention.md) — CI and build artifact retention
- [docs/access-control.md](access-control.md) — contract permission matrix
- [docs/storage-schema.md](storage-schema.md) — storage key design and TTL configuration
- [docs/merchant-onboarding.md](merchant-onboarding.md) — data deletion step-by-step guide
