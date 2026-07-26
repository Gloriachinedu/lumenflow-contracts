# Changelog

All notable changes to LumenFlow are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
- `Custom(String)` variant to `MerchantCategory` enum (max 32 chars, non-empty). Validated on merchant registration. Resolves #114.
- Per-merchant nonce tracking in `process_payment_with_signature` to prevent signature replay attacks. The `nonce` parameter (equal to `get_merchant_nonce() + 1`) is included in the signature payload; the merchant nonce counter is incremented on every successful payment. Adds `get_merchant_nonce(merchant_address)` public read function. Resolves #563.
- Per-merchant rolling-window rate limiting on `process_payment_with_signature` and `batch_payment`. Default cap: 100 payments per 300-ledger window (~25 min). Configurable via `set_rate_limit(admin, limit)`. Returns `RateLimitExceeded` (error 90) when exceeded. Resolves #565.
- Time-locked payment escrow: `create_escrow`, `release_escrow`, `cancel_escrow_before_lock`, and `get_escrow` functions. Funds are held inside the contract until `unlock_at`; the merchant may release after that time; the payer may cancel before it. Emits `escrow_created`, `escrow_released`, `escrow_cancelled` events. Documented in `docs/escrow-guide.md`. Resolves #564.
- Comprehensive benchmark coverage for all public hot-path functions: `process_payment_with_signature`, `get_merchant_payment_history`, `cleanup_expired_payments`, `batch_payment` (10 items), `create_escrow`, and `release_escrow`. Storage operation counts and dominant costs documented per benchmark. CI regression gate: >10% wall-clock increase blocks PR merge. Updated `docs/benchmarking.md` with version stamp (1.0.0, 2026-07-26) and full table of expected storage costs. Resolves #562.

### Changed
- `process_payment_with_signature` signature payload extended: nonce (8-byte big-endian u64) now included between `contract_address` and `order_id`. **Breaking change for existing signature payloads** — callers must regenerate signatures to include the nonce field. See `docs/signature-format.md` for updated payload layout and SDK examples.

---

## [1.0.0] - 2026-05-17

### Added
- Initial release of the LumenFlow payment processing smart contract.
- Merchant registration, deactivation, and profile management.
- Payment processing with ed25519 signature verification.
- Refund lifecycle: initiate → approve/reject → execute.
- Multi-signature payment support with configurable threshold.
- Paginated payment history queries for merchants and payers.
- Filtering by date range, amount range, token, and status.
- Sorting by date or amount (ascending/descending).
- Global payment statistics (admin only).
- Payment record archiving and automated cleanup.
- Comprehensive test suite using `soroban-sdk` testutils.
- CI/CD workflows for lint, test, WASM build, and release.
- Deploy and test helper scripts.
