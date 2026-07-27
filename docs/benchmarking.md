# Benchmarking

This document describes the benchmark harness for the LumenFlow contract and how to run hot-path performance measurements, as well as the load test suite for concurrent payment submission.

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

---

## Load Testing — High-Frequency Payment Submission

Issue #632 introduced a k6 load test for concurrent payment submission. The script simulates 50 concurrent payers each submitting 10 payments and collects p50/p95/p99 latency, success rate, and error rate metrics.

### Prerequisites

Install [k6](https://k6.io/docs/getting-started/installation):

```bash
# macOS
brew install k6

# Linux (Debian/Ubuntu)
sudo gpg --no-default-keyring \
  --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 \
  --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

### Running the load test

```bash
CONTRACT_ID=<your-contract-id> \
RPC_URL=https://soroban-testnet.stellar.org \
NETWORK=testnet \
./scripts/load-test.sh
```

| Variable | Default | Description |
|---|---|---|
| `CONTRACT_ID` | (required) | Deployed LumenFlow contract address |
| `RPC_URL` | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint |
| `NETWORK` | `testnet` | Stellar network |
| `VUS` | `50` | Number of concurrent virtual users (payers) |
| `PAYMENTS_PER_VU` | `10` | Payments submitted per virtual user |
| `RESULTS_FILE` | `/tmp/load-test-results.json` | Output path for JSON results |

### Pass/fail thresholds

| Metric | Threshold |
|---|---|
| p99 latency | < 5 000 ms |
| Error rate | < 1 % |

The script exits with code `0` on pass and `1` on failure. CI uses these exit codes to gate weekly scheduled runs.

### Output

The script prints a summary to stdout and writes a machine-readable JSON file to `RESULTS_FILE`:

```
════════════════════════════════════════════════════════════════
  Load Test Result: ✅ PASSED
  Date:         2026-07-27T08:00:00.000Z
  Total requests: 500
  p50 latency:  312 ms
  p95 latency:  890 ms
  p99 latency:  1423 ms  (threshold: < 5000 ms)
  Error rate:   0.00%  (threshold: < 1%)
════════════════════════════════════════════════════════════════
```

---

## Load Test Results History

Results are appended here after each scheduled weekly run against testnet. The network version refers to the Soroban protocol version active at the time of the test.

| Date | Network | Protocol Version | p50 (ms) | p95 (ms) | p99 (ms) | Error Rate | Result |
|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | Awaiting first run |

> Results are generated automatically by the weekly CI schedule (see `.github/workflows/load-test.yml`).
> To add a result manually, append a row to the table above with the date, network, and values from `RESULTS_FILE`.
