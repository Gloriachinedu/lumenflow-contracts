# ADR-001 — Use Saturating Arithmetic for Global Volume Accumulators

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-01-15 |
| **Deciders** | @Gloriachinedu |
| **Tags** | safety / numeric / global-stats |

---

## Context

`GlobalStats` tracks cumulative payment and refund volumes as `i128` fields:

```rust
pub struct GlobalStats {
    pub total_volume: i128,
    pub total_refund_volume: i128,
    // ...
}
```

In Soroban's Wasm runtime, integer overflow on `i128` addition with `+` or `checked_add` that returns `None` causes a contract panic if not handled. A panic in a WASM smart contract aborts the entire transaction, making the global stats update permanently un-callable if the accumulator ever reaches `i128::MAX` (~170 × 10³⁶).

While reaching `i128::MAX` is theoretically unlikely for short-term deployments, the consequences of an uncaught overflow are severe:

- Any invocation that touches `GlobalStats` would permanently fail.
- `get_global_payment_stats` would be unreadable by admins.
- The contract would effectively be bricked for stats-dependent operations.

Two alternative approaches were considered: `checked_add` with an explicit error return, and `wrapping_add` (which would silently corrupt the count). Both have operational problems.

---

## Decision

We will use **saturating addition** (`saturating_add`) for all `GlobalStats` accumulations:

```rust
stats.total_volume = stats.total_volume.saturating_add(amount);
stats.total_refund_volume = stats.total_refund_volume.saturating_add(refund_amount);
```

When the accumulator would overflow `i128::MAX`, it clamps at `i128::MAX` rather than panicking or wrapping.

---

## Consequences

### Positive
- Contract never panics due to accumulator overflow — stats-related functions always succeed.
- Operational safety is preserved even in extreme edge cases.
- Code is simpler than checked arithmetic with explicit error propagation from stats helpers.

### Negative / Trade-offs
- If `i128::MAX` is genuinely reached, reported totals will be capped and silently incorrect.
- Operators must separately monitor for the `i128::MAX` boundary if extremely high volumes are expected (e.g. on mainnet with many merchants over years).

### Neutral
- A monitoring alert on `total_volume` approaching `i128::MAX / 2` is recommended but not implemented in the contract itself.

---

## Alternatives Considered

| Alternative | Reason not chosen |
|-------------|------------------|
| `checked_add` returning `ContractError::Overflow` | Makes every payment fail once volume ceiling is reached — worse user experience than clamping |
| `wrapping_add` | Silently produces negative or incorrect totals — data corruption is worse than clamping |
| `u128` accumulators | Soroban XDR serialisation of `u128` is less ergonomic; `i128` is the standard token amount type |

---

## References

- `contracts/lumenflow/src/types.rs` — `GlobalStats` struct with inline comment
- `contracts/lumenflow/src/lib.rs` — `process_payment_with_signature` accumulation logic
- [Rust `saturating_add` docs](https://doc.rust-lang.org/std/primitive.i128.html#method.saturating_add)
