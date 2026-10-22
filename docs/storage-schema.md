# Storage Schema and Size Limits

Soroban persistent storage has a per-entry size limit enforced at the protocol
level. Exceeding it causes the transaction to fail on-chain. This document
defines the size thresholds for every major storage type and explains how to
run the size assertion tests locally.

---

## Per-Type Thresholds

| Type | Threshold | Storage Key Prefix |
|------|-----------|-------------------|
| `Merchant` | **512 bytes** | `DataKey::Merchant(address)` |
| `PaymentOrder` | **1 024 bytes (1 KB)** | `DataKey::Payment(order_id)` |
| `MultisigPayment` | **2 048 bytes (2 KB)** | `DataKey::MultisigPayment(payment_id)` |

Thresholds are measured against the **XDR-serialised ScVal** representation,
which is the byte count that Soroban uses when enforcing its storage limits.

---

## Size Assertion Tests

Automated size tests live in
[`contracts/lumenflow/src/storage_size_tests.rs`](../contracts/lumenflow/src/storage_size_tests.rs).

Each test constructs a **worst-case** instance of the struct (maximum-length
strings, optional fields all populated, maximum number of collection elements)
and asserts the XDR byte count stays within the threshold above.

### Run Locally

```bash
# Run only the storage size tests
cargo test storage_size --package lumenflow -- --nocapture

# Example output:
# [storage_size] Merchant: 348 bytes (limit: 512 bytes)
# [storage_size] PaymentOrder: 712 bytes (limit: 1024 bytes)
# [storage_size] MultisigPayment: 1856 bytes (limit: 2048 bytes)
```

### CI Integration

The size tests are part of the standard `cargo test --all-features` run in
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml). The CI build fails
automatically if any struct exceeds its defined threshold, preventing
regressions from being merged.

---

## Worst-Case Construction

The tests are pessimistic by design:

| Type | Worst-case fields |
|------|------------------|
| `Merchant` | `name` = 64 chars, `description` = 128 chars, `contact_info` = 64 chars; all optional fields present |
| `PaymentOrder` | `memo` = 128 chars, `note` = 128 chars, `tags` = 4 × 36-char strings; `PartiallyRefunded` status |
| `MultisigPayment` | 10 signers, 10 × 64-byte signatures, `payment_id` = 64 chars |

---

## Updating Thresholds

If a deliberate field addition causes a struct to exceed its current limit:

1. Measure the new worst-case size by running the tests with `--nocapture`.
2. Update the constant in `storage_size_tests.rs` (`MERCHANT_SIZE_LIMIT`, etc.).
3. Update the table in this document.
4. Include the justification in the PR description.

Threshold increases must be reviewed by a maintainer to confirm the change is
intentional and that the new size stays safely below Soroban's hard limit
(currently **65 536 bytes** per entry, with an expected tightening in future
protocol versions — always leave headroom).

---

## Soroban Storage Limits Reference

- Soroban enforces a **64 KB per-entry XDR size limit** (protocol v21+).
- Individual entry thresholds in this document are intentionally conservative
  to leave room for future field additions without a breaking protocol change.
- Relevant Stellar documentation:
  [Soroban State Archival](https://developers.stellar.org/docs/learn/encyclopedia/storage/state-archival)
