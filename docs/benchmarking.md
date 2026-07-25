# Benchmarking

This document describes the benchmark harness for the LumenFlow contract and how to run hot-path performance measurements.

## Goals

The benchmark harness measures relative runtime across key contract operations, including:

- `process_payment_with_signature`
- `get_merchant_payment_history`
- `cleanup_expired_payments`

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
  - measures scanning merchant payment indexes and deleting outdated records.

## Interpreting results

The benchmark output reports execution time for each hot path. Use it to compare relative costs and to detect performance regressions.

### Optimization targets

Benchmark results can highlight:

- expensive signature verification and payload construction
- storage index scanning costs for history queries
- cleanup iteration costs across merchants and payments

## Notes

This harness is intended for local performance analysis. Soroban execution costs in production may differ from in-memory benchmark timings, but the relative ordering of hot-path costs is useful for prioritizing optimizations.
