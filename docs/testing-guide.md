# Testing Guide

This guide explains the Soroban contract test architecture used in the LumenFlow repository.

## Soroban testutils overview

Soroban provides a `testutils` module for contract unit testing in Rust. It includes:

- `Env` — a simulated Soroban environment with ledger state
- `Env::mock_all_auths()` — bypasses cryptographic auth checks for unit tests
- `Env::register()` and client wrappers — deploy contracts and call methods
- `Ledger` helpers — manipulate timestamp, sequence numbers, and ledger headers

## mock_all_auths() vs real auth

- `mock_all_auths()` disables signature verification and auth checks. It is useful for single-contract unit tests where auth behavior is not under test.
- Real auth should be used in integration or end-to-end tests to verify that `require_auth()` and signature checks actually enforce permissions.
- In this repository, unit tests in `contracts/lumenflow/src/test.rs` use `mock_all_auths()` for setup and still explicitly authenticate callers with the contract client APIs.

## Ledger timestamp manipulation

Use the ledger helper to simulate time changes:

```rust
env.ledger().with_mut(|l| {
    l.timestamp += 31 * 24 * 3600; // advance 31 days
});
```

This is useful for testing refund expiration, cleanup windows, and time-based contract behavior.

## Token minting in tests

Create a test asset and mint tokens to test accounts:

```rust
let token_admin = Address::generate(&env);
let token = create_token(&env, &token_admin);
mint(&env, &token, &token_admin, &payer, 10_000);
```

This pattern is used throughout the contract tests to fund payer accounts before payment flows.

## Testing events

Use `env.events().all()` to inspect published events and assert expected actions:

```rust
let events = env.events().all();
let suspicious_event = events.iter().find(|e| {
    e.topics.get(1).unwrap() == soroban_sdk::Symbol::new(&env, "suspicious_activity")
});
assert!(suspicious_event.is_some());
```

## Common pitfalls

- Do not assume `mock_all_auths()` tests auth logic. For auth-related code paths, add explicit integration-style tests.
- Use `require_positive()` or equivalent validations before transferring amounts.
- When working with `String` and `Vec`, use the Soroban SDK helpers such as `String::from_str(&env, "...")` and `Vec::new(&env)`.
- Remember that ledger time advances are local to the test environment and do not persist across separate `Env` instances.
- Prefer explicit `try_*` calls when asserting contract errors.

## Property-Based Tests (proptest)

Property-based tests verify that refund invariants hold across **arbitrary** sequences of partial refunds, not just hand-picked examples.

### Files

| File | Purpose |
|------|---------|
| `contracts/lumenflow/src/invariant_refund.rs` | Pure invariant definitions (no contract dependencies) |
| `contracts/lumenflow/src/prop_tests.rs` | proptest strategies and property assertions |

### Running

```bash
cargo test --all-features prop_
```

This runs all tests whose names start with `prop_`. For full CI coverage use:

```bash
cargo test --all-features
```

### Invariants verified

1. **Cumulative refunds ≤ original amount** — the sum of all executed partial refunds never exceeds the original payment amount.
2. **Refund window respected** — a refund initiated more than 30 days after payment is always rejected with `RefundWindowExpired`.
3. **Order independence** — the total refunded amount is the same regardless of the order partial refunds are applied.
4. **Remaining balance non-negative** — at any point, `original_amount - sum(executed_refunds) >= 0`.

### Adding new strategies

New refund invariants can be added to `invariant_refund.rs` and then exercised in `prop_tests.rs` using `proptest!` macros:

```rust
proptest! {
    #[test]
    fn prop_my_new_invariant(amount in 1_i128..=100_000_i128) {
        // ... exercise the contract or call invariant functions directly
        prop_assert!(my_invariant(amount));
    }
}
```

## Dependency Security Audits

Dependency audits run automatically in CI for every push and pull request.

### Rust (`cargo audit`)

Scans all Rust workspace crates against the [RustSec Advisory Database](https://rustsec.org/).

```bash
# Install once
cargo install cargo-audit --locked

# Run locally (uses audit.toml configuration)
cargo audit --config audit.toml
```

Configuration is in `audit.toml` at the workspace root. Advisories with severity **high** or **critical** fail CI. To temporarily ignore a false-positive, add its ID to the `ignore` list:

```toml
[advisories]
ignore = ["RUSTSEC-2020-0001"]
```

### npm (`npm audit`)

Scans the `sdk/` package dependencies against the npm advisory database.

```bash
cd sdk

# Install dependencies first
npm ci

# Run audit — exits non-zero on critical vulnerabilities
npm audit --audit-level=critical

# Full report (all severities)
npm audit
```

Only **critical** vulnerabilities fail CI. To investigate a specific advisory, use `npm audit --json` for machine-readable output.
