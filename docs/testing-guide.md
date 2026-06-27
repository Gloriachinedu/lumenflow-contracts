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
