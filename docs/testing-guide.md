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

## Frontend unit tests

The static frontend ships pure helper modules (e.g. `frontend/validation.js`)
that are unit-tested with the Node.js built-in test runner — no extra
dependencies:

```bash
cd frontend
npm run test:unit        # runs tests/unit/*.test.mjs
```

Tests live in `frontend/tests/unit/` as ESM (`*.test.mjs`) and import the module
under test directly. Keep them focused on logic that does not need a DOM;
DOM-driven form behavior is covered by the Playwright specs under
`frontend/tests/` and `tests/playwright/`.

`frontend/tests/unit/validation.test.mjs` covers the shared form validators,
including edge cases: non-string input, length boundaries (`ORDER_ID_MAX_LENGTH`
and one over), whitespace trimming, base32-alphabet enforcement for Stellar
keys, and the `integer` / `allowZero` / `required` / `prefixes` option flags.

## Common pitfalls

- Do not assume `mock_all_auths()` tests auth logic. For auth-related code paths, add explicit integration-style tests.
- Use `require_positive()` or equivalent validations before transferring amounts.
- When working with `String` and `Vec`, use the Soroban SDK helpers such as `String::from_str(&env, "...")` and `Vec::new(&env)`.
- Remember that ledger time advances are local to the test environment and do not persist across separate `Env` instances.
- Prefer explicit `try_*` calls when asserting contract errors.

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

## Coverage thresholds by subsystem

Overall project coverage must stay at or above **80%** (`codecov.yml`). In
addition, each subsystem has its own published target that is scored
independently via Codecov `component_management`, so a regression in one area is
visible even when the aggregate number still passes:

| Subsystem | Paths | Target |
|---|---|---|
| Soroban contracts | `contracts/**` | 85% |
| TypeScript SDK | `sdk/src/**` | 80% |
| Web frontend | `frontend/**` | 70% |
| Merchant dashboard | `dashboard/**` | 70% |

Raise a target as coverage improves; never lower one silently.

## Fuzz tests for malformed signatures and payloads

`sdk/src/tests/signatureFuzz.test.ts` feeds large volumes of randomised and
adversarial input (a seeded PRNG keeps failures reproducible) into the payload
builders and ed25519 verification. It asserts that malformed field
combinations, corrupt contract IDs, random / bit-flipped / truncated signatures,
and tampered payloads are all rejected deterministically rather than crashing or
silently accepting a bad signature.

## Failure-injection tests for upstream Horizon outages

`sdk/src/tests/horizonOutage.test.ts` injects Horizon SSE connection errors and
Soroban RPC transient failures (503/504, timeouts, `ECONNRESET`). It verifies
the event stream reconnects with capped exponential backoff, stops cleanly when
unsubscribed mid-outage, resumes delivery once the outage clears, and that
`withRetry` retries transient errors but surfaces permanent ones immediately.

## Restore drills

A backup that has never been restored is untested. `scripts/restore-drill.mjs`
performs a full round trip — snapshot → serialize → restore → byte-for-byte
compare — and fails loudly on corruption, truncation, or silent tampering.

```bash
node scripts/restore-drill.mjs                       # drill critical repo config
node scripts/restore-drill.mjs codecov.yml Makefile  # drill specific files
npm run test:roadmap                                 # runs scripts/*.test.mjs, incl. the drill tests
```
