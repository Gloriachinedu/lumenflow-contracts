# ADR-004 — Storage Key Design Using Typed `DataKey` Enum

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-01-25 |
| **Deciders** | @Gloriachinedu |
| **Tags** | storage / architecture |

---

## Context

Soroban storage is a key-value store where keys are arbitrary XDR `Val` values. The contract needs to store and retrieve several distinct record types keyed by different identifiers (admin address, merchant address, order ID string, refund ID string, etc.).

Early prototypes used raw string keys like `"admin"`, `"merchant:{address}"`, and `"payment:{order_id}"`. This approach had several problems:

- String concatenation for composite keys is error-prone and produces variable-length keys that are hard to reason about.
- Type safety is lost: any code can read any key with any type, and type mismatches cause runtime panics.
- Refactoring key names is risky because old keys on-chain cannot be migrated automatically.
- No single source of truth for all keys — adding a new storage operation meant searching for the right string format.

Soroban's SDK supports `#[contracttype]` on Rust enums, which serialises each variant (including associated data) into a compact, stable XDR representation suitable for use as a storage key.

---

## Decision

We will use a single `#[contracttype]` enum `DataKey` as the sole type for all storage keys in the contract:

```rust
#[contracttype]
pub enum DataKey {
    Admin,
    CleanupPeriod,
    GlobalStats,
    Merchant(Address),
    MerchantList,
    Payment(String),
    // ... etc.
}
```

All storage reads and writes go through typed helper functions in `storage.rs` that accept domain types and construct the `DataKey` internally. Callers never construct raw keys.

---

## Consequences

### Positive
- **Type safety**: the Rust type system prevents accidentally reading a `Merchant` record as a `Payment` record.
- **Single source of truth**: all storage keys are enumerated in one place (`DataKey`).
- **Compact XDR serialisation**: enum variant discriminants are small integers; associated data is typed, not stringified.
- **Stable on-chain format**: XDR serialisation of a `#[contracttype]` enum is deterministic across contract versions (as long as variant order is not changed).
- **Testability**: storage helpers are easy to unit-test in isolation.

### Negative / Trade-offs
- Adding a new variant to `DataKey` must be done carefully — removing or reordering variants breaks on-chain compatibility with existing data (variant discriminants shift).
- New variants must always be **appended** to the end of the enum to preserve existing discriminants.
- All storage operations are gated through helper functions, adding a layer of indirection.

### Neutral
- `storage.rs` grows as new record types are added, but remains well-organised by domain section.

---

## Migration Rules

When modifying `DataKey`:

| Allowed | Not allowed |
|---------|------------|
| Appending new variants at the end | Removing existing variants |
| Changing associated data types (with a data migration plan) | Reordering variants |
| Adding new helper functions in `storage.rs` | Renaming variants (changes discriminant label in XDR) |

---

## Alternatives Considered

| Alternative | Reason not chosen |
|-------------|------------------|
| Raw string keys (`"admin"`, `"merchant:{addr}"`) | Error-prone, no type safety, hard to audit |
| Separate key structs per record type | More boilerplate; no single enumerated list of all keys |
| Hash-based keys (SHA256 of record type + id) | Loses human-readable structure; harder to debug with block explorers |

---

## References

- `contracts/lumenflow/src/storage.rs` — Full `DataKey` enum and all helper functions
- [docs/storage-schema.md](../storage-schema.md) — Retention policies, TTL values, and cost estimates per key
- [Soroban `#[contracttype]` docs](https://developers.stellar.org/docs/smart-contracts/example-contracts/custom-types)
