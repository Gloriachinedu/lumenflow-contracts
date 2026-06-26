# Contributing to LumenFlow

Thank you for your interest in contributing! LumenFlow is an open-source project and we welcome contributions of all kinds.

## Code of Conduct

Be respectful, inclusive, and constructive. We follow the [Contributor Covenant](https://www.contributor-covenant.org/).

## Getting Started

1. Fork the repository and clone your fork.
2. Install prerequisites (see README).
3. Create a feature branch: `git checkout -b feat/your-feature`.
4. Make your changes, add tests, and ensure everything passes.
5. Open a pull request against `main`.

---

## Repository Layout

```
lumenflow-contracts/
├── contracts/lumenflow/src/   # Soroban smart contract (Rust)
│   ├── lib.rs                 # All public contract entrypoints
│   ├── types.rs               # Shared data structures (contracttype)
│   ├── storage.rs             # Persistent/instance/temporary storage helpers
│   ├── error.rs               # Typed error codes
│   ├── helper.rs              # Auth guards and validation utilities
│   └── test.rs                # Unit + integration tests
├── sdk/src/                   # TypeScript SDK
│   ├── signPaymentPayload.ts  # Ed25519 payload builder
│   ├── wallet.ts              # Wallet connection helpers
│   └── errors.ts              # SDK-side error types
├── cli/lumenflow-cli/src/     # Rust CLI (wraps contract invocations)
│   └── main.rs
├── frontend/                  # HTML/JS payment UI pages
├── dashboard/                 # Merchant dashboard UI
├── scripts/                   # Shell helpers: deploy, test, local network
└── .github/workflows/         # CI/CD: lint, test, WASM build, release
```

Where each concern lives:

| What you want to change | Where to look |
|---|---|
| Contract logic / new entrypoint | `contracts/lumenflow/src/lib.rs` |
| Data structures | `contracts/lumenflow/src/types.rs` |
| Storage access patterns | `contracts/lumenflow/src/storage.rs` |
| Error codes | `contracts/lumenflow/src/error.rs` |
| SDK payload signing | `sdk/src/signPaymentPayload.ts` |
| CLI commands | `cli/lumenflow-cli/src/main.rs` |
| CI pipeline | `.github/workflows/ci.yml` |
| Docs | `docs/` |

---

## Build and Test Commands

```bash
# Run all contract tests
cargo test --all-features

# Run a specific test
cargo test test_successful_refund_flow

# Lint
cargo clippy --all-targets --all-features -- -D warnings

# Format check
cargo fmt --all -- --check

# Build WASM binary
cargo build --target wasm32-unknown-unknown --release --package lumenflow

# Full lint + test + coverage pipeline
./scripts/test.sh

# Start a local Stellar node and deploy
SOURCE_ACCOUNT=<secret-key> ./scripts/local_up.sh
```

---

## Issue and PR Conventions

- **Branch names**: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`, `ci/<slug>`, `test/<slug>`
- **Commit messages**: follow [Conventional Commits](https://www.conventionalcommits.org/) — e.g. `feat: add X`, `fix: prevent Y`, `docs: update Z`
- **Linking issues**: add `Closes #N` in the PR description body to auto-close the issue on merge
- **One concern per PR** — keep PRs focused; reviewers will ask you to split large ones
- **Fill the PR template** — summary, what was tested, any blocked items
- **CI must be green** before requesting review

---

### Toolchain Version

We pin the Rust toolchain to a specific stable version in `rust-toolchain.toml` and `.github/workflows/ci.yml`. To update the version:
1. Update `channel` in `rust-toolchain.toml`.
2. Update the `toolchain` version and the `Verify toolchain version` step in `.github/workflows/ci.yml`.
3. Update this document if the recommended setup changes.

### GitHub Actions Pinning Policy

All `uses:` entries in workflow files **must** reference a full commit SHA, not a mutable tag or branch:

```yaml
# ✅ correct
- uses: actions/checkout@34e114876b0b11c390a56745cba8c7296529d2fc39830  # v4

# ❌ wrong — tag is mutable
- uses: actions/checkout@v4
```

This prevents supply-chain attacks where a tag is silently moved to malicious code.

To update a pinned action:
1. Find the new commit SHA for the desired release on the action's GitHub releases page.
2. Replace the SHA in the workflow file and update the version comment.
3. Dependabot is configured to open PRs for these updates automatically (weekly).

## Development Setup

```bash
# Install Rust stable + WASM target
rustup target add wasm32-unknown-unknown

# Run tests
cargo test --all-features

# Check formatting
cargo fmt --all -- --check

# Run linter
cargo clippy --all-targets --all-features -- -D warnings

# Build WASM
cargo build --target wasm32-unknown-unknown --release
```

## Contribution Guidelines

### Code Style

- Follow standard Rust idioms (`rustfmt` enforced in CI).
- No `unwrap()` in contract code — use `?` with typed errors.
- All public functions must have doc comments.
- Keep functions focused; extract helpers when logic grows.

### Tests

- Every new feature or bug fix must include a test.
- Tests live in `src/test.rs` using `soroban-sdk` testutils.
- Use `mock_all_auths()` for unit tests; integration tests should use real auth.

### Reproducible Builds

- `Cargo.lock` must be committed to the repository.
- CI enforces that the lock file is up-to-date with `Cargo.toml` using `cargo update --locked`.
- Always use the `--locked` flag with cargo commands in production or CI environments.

### Commits

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add subscription payment support
fix: prevent double-refund on concurrent requests
docs: update deploy instructions for testnet
test: add edge cases for multisig threshold
```

### Pull Requests

- Keep PRs focused — one feature or fix per PR.
- Fill out the PR template completely.
- Link the related issue with `Closes #N`.
- All CI checks must pass before merge.

## Team Structure

To ensure high-quality reviews and maintainability, the project is organized into specialized teams:

- **Smart Contract Team** (`@Gloriachinedu/smart-contract-team`): Responsible for core logic in `contracts/`.
- **DevOps Team** (`@Gloriachinedu/devops-team`): Manages deployment `scripts/` and CI/CD.
- **Documentation Team** (`@Gloriachinedu/documentation-team`): Maintains project documentation and the `docs/` folder.
- **SDK Team** (`@Gloriachinedu/sdk-team`): Responsible for the SDK layer (once created).

Pull requests are automatically assigned to the relevant CODEOWNERS. At least one approval from a CODEOWNER is required for all PRs merging into `main`.

## Reporting Security Issues

Do **not** open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md).

## Questions

Open a [GitHub Discussion](../../discussions) for questions, ideas, or general feedback.

## Governance

See [GOVERNANCE.md](GOVERNANCE.md) for how project decisions are made, the RFC process, and how to become a maintainer.
