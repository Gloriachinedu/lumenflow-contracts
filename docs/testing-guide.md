# LumenFlow Testing Guide

This guide covers all testing strategies used in the LumenFlow project:
unit tests, property-based fuzz tests, snapshot tests, and mutation testing.

---

## Table of Contents

1. [Unit Tests](#1-unit-tests)
2. [Property-Based Fuzz Tests (proptest)](#2-property-based-fuzz-tests-proptest)
3. [Snapshot Tests](#3-snapshot-tests)
4. [Mutation Testing](#4-mutation-testing)

---

## 1. Unit Tests

Unit tests live in `contracts/lumenflow/src/test.rs` and are run with:

```bash
cargo test --package lumenflow --all-features
```

To run a single named test:

```bash
cargo test --package lumenflow --all-features test_successful_refund_flow
```

Full lint + test pipeline (runs fmt, clippy, and tests):

```bash
./scripts/test.sh
```

---

## 2. Property-Based Fuzz Tests (proptest)

### Overview

Property-based tests automatically generate thousands of random inputs to
discover edge cases that hand-written tests miss.  LumenFlow uses the
[`proptest`](https://docs.rs/proptest) crate for Rust contract tests.

The fuzz test module is at:

```
contracts/lumenflow/src/prop_tests.rs
```

### What is tested

| Property | Description |
|----------|-------------|
| `prop_positive_amount_always_accepted` | Any `amount` in `[1, i128::MAX]` must succeed |
| `prop_non_positive_amount_always_rejected` | Any `amount ≤ 0` must return `InvalidAmount` |
| `prop_i128_max_boundary_accepted` | `i128::MAX` must be accepted without overflow |
| `prop_duplicate_order_id_always_rejected` | Duplicate order IDs always return `PaymentAlreadyExists` |
| `prop_no_panic_on_any_order_id` | Random order IDs must never cause a panic |
| `prop_refund_cannot_exceed_original` | Refund amount invariant holds for any payment/refund combo |

### Running locally (default — 256 iterations, fast)

```bash
cargo test --package lumenflow --all-features prop_
```

### Running an extended fuzz session (100 000 iterations)

```bash
PROPTEST_CASES=100000 cargo test --package lumenflow --all-features prop_
```

### Running a long overnight session

```bash
PROPTEST_CASES=10000000 cargo test --package lumenflow --all-features prop_
```

### CI behaviour

CI runs 100 000 iterations via the `fuzz` job in `.github/workflows/ci.yml`.
The `PROPTEST_CASES` environment variable controls the count.  The `build`
job depends on `fuzz` passing, so a failing property blocks the WASM release.

### Reproducing a failure

When proptest finds a failing case it prints a seed and minimised input, e.g.:

```
thread 'prop_positive_amount_always_accepted' panicked at …
Failing input: amount = -9223372036854775808
Shrunk input: amount = -1

To reproduce this failure, run:
PROPTEST_REGRESSIONS=contracts/lumenflow/proptest-regressions \
  cargo test prop_positive_amount_always_accepted
```

Regression files are saved to `contracts/lumenflow/proptest-regressions/`
and committed so CI always re-runs known failures until they are fixed.

### Adding new fuzz targets

1. Add a `proptest!` block in `contracts/lumenflow/src/prop_tests.rs`.
2. Name the test with the `prop_` prefix so CI picks it up automatically.
3. Document the invariant being tested in the block comment.

---

## 3. Snapshot Tests

### Overview

Snapshot tests capture the complete event topics and data payloads emitted by
the contract and compare them against stored golden files.  Any unexpected
change to an event structure fails the build.

Snapshot files live in:

```
contracts/lumenflow/test_snapshots/test/
```

Each file is named `<test_name>.1.json` and contains the full Soroban
environment snapshot (auth, events, storage) from a single test run.

### Running snapshot tests

Snapshots are generated automatically when running the normal test suite:

```bash
cargo test --package lumenflow --all-features
```

### Detecting snapshot drift

If contract code changes produce different event payloads, the next test run
will fail with a diff showing the old vs new snapshot.  CI enforces this via
the `test` job.

### Updating snapshots

When an intentional change to an event payload is made, regenerate the
snapshots with:

```bash
cargo test --package lumenflow --all-features -- --update-snapshots
```

Commit the updated `.json` files as part of your PR.

### Adding a snapshot test for a new function

Add a test in `contracts/lumenflow/src/test.rs` that calls the function and
asserts on the emitted events using `env.events().all()`.  The soroban test SDK
automatically records snapshots on the first run.

```rust
#[test]
fn test_my_new_function_events() {
    let (env, client) = setup();
    // … exercise the function …
    let events = env.events().all();
    // The snapshot is captured automatically; assert structure here too:
    assert_eq!(events.len(), 1);
}
```

### Snapshot CI step

The `test` job in `.github/workflows/ci.yml` runs `cargo test --all-features`.
If snapshots drift, the test output shows a diff and the job fails.

---

## 4. Mutation Testing

### Overview

Mutation testing introduces small code changes (mutants) and verifies that
the test suite catches them.  A surviving mutant means a test is missing.

See [`docs/mutation-testing.md`](mutation-testing.md) for:
- Setup and configuration
- How to run mutation tests locally
- Current mutation score report
- Known surviving mutants

### Quick start

```bash
# Rust (cargo-mutants)
cargo install cargo-mutants
cargo mutants --package lumenflow

# TypeScript SDK (Stryker)
cd sdk && npx stryker run
```

Full instructions and CI integration are documented in
[`docs/mutation-testing.md`](mutation-testing.md).
