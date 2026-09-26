# Contract Gas and Storage Budget Thresholds

This document records the approved CPU-instruction and memory-byte budgets
for every critical contract entry point. CI enforces these ceilings as
regression guards — a PR that exceeds a threshold will fail the
`budget-regression` job.

---

## Background

Soroban charges each transaction a metered cost measured in two dimensions:

| Dimension | Unit | Stellar term |
|-----------|------|--------------|
| Compute   | CPU instructions | `cpu_insns` |
| Memory    | bytes allocated  | `mem_bytes` |

Each network upgrade may raise or lower the absolute limits. The thresholds
below are **relative ceilings** chosen as ≤ 80 % of the Stellar testnet
limits at time of last review (2026-08-29), giving headroom for the host
overhead that the native runtime adds on top of the test harness budget.

---

## Thresholds

| Entry point | CPU limit (insns) | Memory limit (bytes) |
|-------------|:-----------------:|:--------------------:|
| `process_payment_with_signature` | 5 000 000 | 2 000 000 |
| `process_payment_with_nonce`     | 5 000 000 | 2 000 000 |
| `batch_payment` (10 items)       | 40 000 000 | 10 000 000 |
| `initiate_refund`                | 3 000 000 | 1 500 000 |
| `approve_refund`                 | 2 000 000 | 1 000 000 |
| `execute_refund`                 | 4 000 000 | 2 000 000 |
| `register_merchant`              | 2 000 000 | 1 000 000 |
| `initiate_multisig_payment`      | 3 000 000 | 1 500 000 |
| `sign_multisig_payment`          | 2 000 000 | 1 000 000 |
| `execute_multisig_payment`       | 4 000 000 | 2 000 000 |
| `create_payment_request`         | 2 000 000 | 1 000 000 |
| `pay_payment_request`            | 4 000 000 | 2 000 000 |

WASM binary size ceiling (enforced separately in the `build` CI job):
**100 KB** (Soroban network limit is 128 KB; CI uses 100 KB as a guard).

---

## How CI enforces the thresholds

The `budget-regression` CI job (see `.github/workflows/ci.yml`) runs:

```bash
cargo test --locked --all-features budget_regression
```

Each test in `test.rs` tagged `budget_regression` calls:

```rust
env.budget().reset_default();
// … invoke the entry point …
let cpu = env.budget().cpu_instruction_count();
let mem = env.budget().memory_bytes_used();
assert!(cpu <= THRESHOLD, "cpu {cpu} exceeded limit");
assert!(mem <= MEM_THRESHOLD, "mem {mem} exceeded limit");
```

The thresholds above are declared as constants in `contracts/lumenflow/src/test.rs`.

---

## Updating thresholds

1. Run the budget tests locally:
   ```bash
   cargo test --all-features budget_regression -- --nocapture
   ```
2. If a deliberate feature addition raises consumption, update both the
   constants in `test.rs` **and** the table in this document in the same PR.
3. Add a note to `CHANGELOG.md` explaining the budget change.

---

## Storage budget

Soroban's per-entry storage limits (as of Protocol 22):

| Storage type | Max key size | Max value size |
|---|---|---|
| Persistent | 300 bytes | 65 536 bytes |
| Temporary  | 300 bytes | 65 536 bytes |
| Instance   | shared instance footprint (counted toward instance size) |

The contract currently stores at most **one `PaymentOrder` (~400 bytes
serialised)** per persistent entry, well within the 64 KB cap. Batch
payments write up to 10 entries per invocation; each write is independent
so no single entry exceeds the limit.

---

*Last reviewed: 2026-08-29. Review again when soroban-sdk major version changes.*
