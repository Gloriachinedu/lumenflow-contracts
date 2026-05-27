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
