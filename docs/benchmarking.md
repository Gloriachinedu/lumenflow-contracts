# Benchmarking

**Version:** 1.0.0 — **Last updated:** 2026-07-26

This document describes the benchmark harness for the LumenFlow smart contract,
how to run hot-path performance measurements, the expected storage operation
counts per function, and the CI regression gate.

---

## Goals

The benchmark harness measures relative runtime across all public hot-path
contract operations to:

- Establish baseline performance metrics for each release.
- Detect regressions (>10 % wall-clock increase) before they reach `main`.
- Guide optimisation work by identifying the costliest storage and compute paths.

---

## Measured hot paths

| Benchmark | Reads | Writes | Dominant cost |
|-----------|------:|-------:|---------------|
| `process_payment_with_signature` | ~8 | ~6 | ed25519 verification |
| `get_merchant_payment_history` | ~22 | 0 | index scan + sort |
| `cleanup_expired_payments` | ~12 | ~10 | index scan + remove |
| `batch_payment` (10 items) | ~60 | ~40 | per-item sig verify + storage |
| `create_escrow` | ~5 | ~3 | token transfer + write |
| `release_escrow` | ~3 | ~2 | timestamp check + transfer |

> **Note:** "Reads" and "Writes" are approximate counts of Soroban storage
> operations (persistent + temporary + instance).  Actual instruction-unit
> consumption in a live network depends on entry sizes, key complexity, and
> XDR serialisation overhead.

---

## Running benchmarks

```bash
# From the workspace root
cargo bench --manifest-path contracts/lumenflow/Cargo.toml
```

Criterion prints a statistical summary including mean, standard deviation, and
change vs the saved baseline.  The first run saves the baseline automatically
under `contracts/lumenflow/target/criterion/`.

### Save a named baseline

```bash
cargo bench --manifest-path contracts/lumenflow/Cargo.toml -- --save-baseline v1.0.0
```

### Compare against a saved baseline

```bash
cargo bench --manifest-path contracts/lumenflow/Cargo.toml -- --baseline v1.0.0
```

---

## CI regression gate

The CI pipeline runs on every PR targeting a release branch (`release/*`).
After benchmarks complete, a script compares each benchmark's mean against the
most recently saved baseline in `contracts/lumenflow/benches/baselines/`.

**Threshold:** any benchmark that regresses by more than **10 %** causes the CI
step to exit non-zero and blocks the PR merge.

```yaml
# .github/workflows/ci.yml (excerpt)
- name: Run benchmarks
  run: cargo bench --manifest-path contracts/lumenflow/Cargo.toml -- --output-format bencher | tee bench_output.txt

- name: Check regression threshold
  run: python3 scripts/check_bench_regression.py bench_output.txt 10
```

---

## Benchmark harness

The harness is in `contracts/lumenflow/benches/benchmark.rs`.  It uses an
in-memory Soroban test environment (`Env::default()` + `mock_all_auths()`) so
that results are deterministic and reproducible without a live network.

### `benchmark_process_payment`

Exercises the full `process_payment_with_signature` path:

1. Merchant nonce validation (`get_merchant_nonce`)
2. Rate-limit counter check and increment
3. Payload construction (network ID + contract address + nonce + order_id + amount)
4. Ed25519 signature verification (dominant CPU cost)
5. Platform fee calculation
6. Token transfer (payer → merchant)
7. Payment record write + merchant and payer index appends
8. Merchant stats update
9. Global stats update
10. Suspicious-activity threshold check
11. Event emission

### `benchmark_query_history`

Pre-loads 20 payment records then exercises `get_merchant_payment_history`:

1. Merchant payment index read
2. 20 individual payment record reads
3. Filter pass (no filter — full pass)
4. `sort_unstable_by` over native `Vec`
5. Cursor-based pagination slice
6. Result construction

### `benchmark_cleanup`

Pre-loads 10 payments then advances time past the cleanup window before exercising
`cleanup_expired_payments`:

1. Merchant list read
2. Per-merchant payment index read
3. Per-payment age check
4. Storage removal for expired records

### `benchmark_batch_payment`

Creates a 10-item batch and exercises the full batch path for each item:

1. Rate-limit check and increment per merchant
2. Token-allow check
3. Ed25519 verification
4. Token transfer
5. Payment storage write + index updates
6. Stats updates

### `benchmark_create_escrow`

Exercises `create_escrow`:

1. Token-allow check
2. Merchant active check
3. Token transfer (payer → contract address)
4. Escrow record write

### `benchmark_release_escrow`

Exercises `release_escrow` after `unlock_at` has passed:

1. Escrow record read
2. Status and timestamp checks
3. Escrow status update write
4. Token transfer (contract → merchant)

---

## Interpreting results

Criterion outputs results in this form:

```
process_payment_with_signature
                        time:   [12.345 µs 12.567 µs 12.789 µs]
                        change: [−0.23% +0.42% +1.07%] (p = 0.38 > 0.05)
                        No change in performance detected.
```

- The three numbers are the lower bound, mean, and upper bound of the
  confidence interval.
- A **positive change > 10 %** with p < 0.05 is treated as a regression.
- A **negative change** is an improvement.

### Optimisation targets

Benchmark results can highlight:

- **Signature verification** — the single largest CPU cost in `process_payment_with_signature`.
- **Storage index scanning** — grows linearly with the number of payments per merchant.
- **Batch payment** — dominated by per-item signature verification.
- **Cleanup iteration** — cost scales with merchant count × payment count.

---

## Notes

This harness measures in-memory timings.  Soroban's on-chain instruction-unit
(CPU + memory) costs may differ from wall-clock time, but the relative ordering
of hot-path costs is stable and useful for prioritising optimisations.

For reproducible comparisons, always run benchmarks on the same machine and
avoid background load.  Use `--baseline` to compare across branches.
