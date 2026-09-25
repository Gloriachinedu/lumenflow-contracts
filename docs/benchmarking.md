# Benchmarking

This document describes the benchmark harness for the LumenFlow contract and how to run hot-path performance measurements.

## Goals

The benchmark harness measures relative runtime across key contract operations, including:

- `process_payment_with_signature`
- `get_merchant_payment_history`
- `cleanup_expired_payments` (unbatched — full scan with default batch_size=100)
- `cleanup_expired_payments_batch_10` (batched — 10 records per call)

These benchmarks help identify optimization targets and track regressions as code changes.

## Running benchmarks

From the repository root:

```bash
cargo bench --manifest-path contracts/lumenflow/Cargo.toml
```

The harness uses `criterion` to report relative timing and statistical summaries.

## Benchmark harness

The benchmark harness is implemented in `contracts/lumenflow/benches/benchmark.rs`.
It executes a Soroban in-memory contract environment and exercises the contract entrypoints in realistic scenarios.

### Measured hot paths

- `process_payment_with_signature`
  - measures token transfer, signature validation, payment storage, merchant/payer indexing, and stats updates.
- `get_merchant_payment_history`
  - measures history retrieval, pagination, filtering, and sorting over an in-memory payment dataset.
- `cleanup_expired_payments`
  - measures a full cleanup pass (default `batch_size=100`) scanning merchant payment indexes and deleting outdated records over a dataset of 10 payments.
- `cleanup_expired_payments_batch_10`
  - measures batched cleanup with `batch_size=10` over a dataset of 50 payments, reflecting typical incremental invocations in production to avoid hitting Soroban instruction limits.

## Batched cleanup (issue #1026)

`cleanup_expired_payments` now accepts an optional `batch_size: Option<u32>` parameter:

| Parameter value | Behaviour |
|---|---|
| `None` | Uses the default cap of 100 records per call |
| `Some(n)` where `0 < n ≤ 100` | Removes at most `n` expired records |
| `Some(0)` | Clamped to 1 |
| `Some(n > 100)` | Clamped to 100 |

The function now returns a `CleanupResult` struct:

```rust
pub struct CleanupResult {
    pub cleaned: u32,   // records removed in this batch
    pub has_more: bool, // true if more expired records may remain
}
```

When `has_more` is `true`, callers should invoke `cleanup_expired_payments` again
in a subsequent transaction to continue cleaning up.

### Recommended invocation pattern

```bash
# First pass — remove up to 50 records
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY --network $NETWORK \
  -- cleanup_expired_payments --admin $ADMIN_ADDR --batch_size 50

# Repeat until has_more is false
```

### Instruction limit guidance

With `batch_size <= 100`, the cleanup function remains within Soroban's instruction
budget. Larger datasets should be handled by calling the function multiple times
across separate transactions rather than increasing the batch size.

## Interpreting results

The benchmark output reports execution time for each hot path. Use it to compare relative costs and to detect performance regressions.

### Optimization targets

Benchmark results can highlight:

- expensive signature verification and payload construction
- storage index scanning costs for history queries
- cleanup iteration costs across merchants and payments
- per-record overhead vs. fixed overhead in batched cleanup

## Notes

This harness is intended for local performance analysis. Soroban execution costs in production may differ from in-memory benchmark timings, but the relative ordering of hot-path costs is useful for prioritizing optimizations.
