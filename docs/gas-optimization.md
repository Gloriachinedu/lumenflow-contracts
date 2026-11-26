# Gas Usage: Batch Payment Loop

## Problem (issue #831)

The original `batch_payment` implementation performed **O(N) storage round-trips** for operations that could be collapsed into a single read+write:

| Operation | Original (per N-item batch) | Optimised |
|---|---|---|
| `get_global_stats` | N reads | 1 read |
| `set_global_stats` | N writes | 1 write |
| `get_payer_payment_ids` | N reads | 1 read |
| `set_payer_payment_ids` | N writes | 1 write |
| `env.ledger().timestamp()` | N calls | 1 call |

For the maximum batch size of **10 items** this eliminated **18 redundant ledger entry operations** and **9 redundant timestamp host-function calls**.

## Changes

### `contracts/lumenflow/src/lib.rs` — `batch_payment`

1. **Validation-first pass** — all per-item checks (token allowance, duplicate
   order ID, merchant existence/activity, signature) run in a first pass _before_
   any state is mutated. This prevents partial state writes on failure.

2. **Hoisted globals** — `env.ledger().timestamp()`, `get_global_stats`, and
   `get_payer_payment_ids` are called once before the loop. Counters are
   accumulated in-memory, and the results are written after the loop completes.

### `contracts/lumenflow/src/storage.rs`

- Added `set_payer_payment_ids(env, payer, ids)` — writes the full payer ID
  list in a single operation, used by the optimised batch path.

## Timestamp hoisting (issue #1516)

`env.ledger().timestamp()` is now called **exactly once** at the top of
`batch_payment`, before the batch loop, and the resulting value is reused for
every item in the batch. Previously the timestamp could be fetched once per
item in some code paths, costing up to **N host-function calls** for an N-item
batch (10 calls at the maximum batch size).

### Before / after instruction budget

Measured with `SOROBAN_TEST_BUDGET=1` on `test_batch_payment_max_10_items_enforced`
(10-item batch):

| Metric | Before | After | Delta |
|---|---|---|---|
| `cpu_insns` | _record on `main`_ | _record on branch_ | _fill in_ |
| `mem_bytes` | _record on `main`_ | _record on branch_ | _fill in_ |

To reproduce:

```bash
SOROBAN_TEST_BUDGET=1 cargo test test_batch_payment_max_10_items_enforced -- --nocapture 2>&1 \
  | grep -E "cpu_insns|mem_bytes"
```

## Measuring gas locally

Soroban's test framework exposes CPU instruction and memory byte budgets when
the `SOROBAN_TEST_BUDGET` environment variable is set:

```bash
SOROBAN_TEST_BUDGET=1 cargo test test_batch_payment -- --nocapture 2>&1 \
  | grep -E "cpu_insns|mem_bytes"
```

Compare the output against the `main` branch to quantify the savings.

## Test coverage

Six new unit tests in `test.rs`:

| Test | Verifies |
|---|---|
| `test_batch_payment_single_item` | Basic correctness |
| `test_batch_payment_multiple_items_stats_correct` | Stats accumulated correctly across items |
| `test_batch_payment_payer_history_contains_all_items` | Payer index contains all IDs |
| `test_batch_payment_max_10_items_enforced` | Batch size limit |
| `test_batch_payment_fails_on_duplicate_order_id` | Duplicate rejection |
| `test_batch_payment_validation_pass_prevents_partial_state` | No partial state writes on error |
