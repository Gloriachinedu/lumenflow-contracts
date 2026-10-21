# Changelog

All notable changes to LumenFlow are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
- `Custom(String)` variant to `MerchantCategory` enum (max 32 chars, non-empty). Validated on merchant registration. Resolves #114.
- Explicit named re-export of `MerchantCategory` from `@lumenflow/sdk` package root (`sdk/src/index.ts`). Consumers can now import `MerchantCategory` directly from `@lumenflow/sdk` without internal path imports. Resolves #1259.

### Changed (Breaking)
- `registerMerchant` category parameter is now strictly typed as `MerchantCategory` enum. Raw string literals (e.g. `"Retail"`) are no longer accepted by the TypeScript compiler; use `MerchantCategory.Retail` instead.

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
