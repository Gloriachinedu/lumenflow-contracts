# Contributing to LumenFlow

Thank you for your interest in contributing! LumenFlow is an open-source project and we welcome contributions of all kinds.

## Code of Conduct

Be respectful, inclusive, and constructive. We follow the [Contributor Covenant](https://www.contributor-covenant.org/).

## Getting Started

New to the project? Follow the step-by-step [Developer Onboarding Guide](docs/ONBOARDING.md) to go from zero to running tests locally.

1. Fork the repository and clone your fork.
2. Install prerequisites (see README).
3. Run `scripts/install_hooks.sh` after cloning to install the local pre-commit hook.
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
- **Commit messages**: follow [Conventional Commits](https://www.conventionalcommits.org/) — see the [Commits](#commits) section below for the full type list, breaking-change syntax, and examples. The `commit-msg` hook validates messages locally.
- **Linking issues**: add `Closes #N` in the PR description body to auto-close the issue on merge
- **Milestone assignment**: every new issue and PR **must** be assigned to a GitHub Milestone before it can be merged. Milestones correspond directly to the phases defined in [ROADMAP.md](ROADMAP.md) (`v0.4`, `v0.5`, `v0.6`, `Backlog`). If you are unsure which milestone applies, assign `Backlog` and a maintainer will re-triage. See [docs/roadmap-tracking.md](docs/roadmap-tracking.md#github-milestones) for the full milestone table and due dates.
- **One concern per PR** — keep PRs focused; reviewers will ask you to split large ones
- **Fill the PR template** — summary, what was tested, any blocked items
- **CI must be green** before requesting review

### PR Size Labels

Every pull request is automatically labeled by the CI workflow (`.github/workflows/pr-size-label.yml`) based on the total number of lines changed (additions + deletions):

| Label    | Lines changed | Description                              |
|----------|---------------|------------------------------------------|
| `size/XS` | < 50          | Extra-small — trivial fix or tiny change |
| `size/S`  | 50 – 200      | Small — focused, easy to review          |
| `size/M`  | 200 – 500     | Medium — moderate scope                  |
| `size/L`  | 500 – 1000    | Large — consider splitting if possible   |
| `size/XL` | > 1000        | Extra-large — please split into smaller PRs |

Aim for `size/XS` or `size/S` whenever possible. Large PRs are harder to review thoroughly and more likely to introduce bugs. If your PR is labeled `size/L` or `size/XL`, consider breaking it into smaller, independent PRs — one per logical concern.

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

### Container Image Scanning

Every Docker image built in CI is scanned for OS and library vulnerabilities by
Trivy (`.github/workflows/docker-scan.yml`) **before** it can be used in any
deployment:

| Severity | Behaviour |
|----------|-----------|
| **Critical** | Workflow fails — image must not be deployed |
| **High** | Warning annotation posted on the PR; workflow continues |
| All results | Uploaded as SARIF to the GitHub Security tab |

To suppress a false-positive finding, add a `.trivyignore` file at the
repository root with the CVE IDs to skip, one per line, and include a comment
explaining why the finding is not applicable.

## Development Setup

### Secret Scanning Hook

Install gitleaks, then enable the repository's pre-commit scan:

```bash
./scripts/install_hooks.sh
```

The hook scans the repository with `.gitleaks.toml` before each commit. Add
reviewed false-positive exceptions to that configuration. For emergencies only,
`SKIP_SECRET_SCAN=1 git commit ...` skips the scan and prints a warning.

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

## Git Hooks

The `.githooks/` directory contains two Git hooks that are installed locally
when you run the setup command below.  They run automatically before each
commit and catch common mistakes early, before code reaches CI.

### Installation

Run this once after cloning the repository:

```bash
./scripts/install_hooks.sh
```

The script symlinks `.githooks/pre-commit` and `.githooks/commit-msg` into
`.git/hooks/` and ensures both are executable.

### `commit-msg` — Conventional Commits format

The `commit-msg` hook validates every commit message against the
[Conventional Commits](https://www.conventionalcommits.org/) specification.
It rejects messages that do not match the pattern:

```
<type>[(scope)][!]: <subject>
```

Valid types are: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `ci`,
`chore`, `perf`, `revert`, `security`, `build`.

The hook also rejects header lines longer than 100 characters.

Example of a valid commit message:

```
feat(payments): add batch processing endpoint
```

### `pre-commit` — Lint and secret scanning

The `pre-commit` hook runs two checks before every commit:

1. **Secret scanning** — runs [gitleaks](https://github.com/gitleaks/gitleaks)
   against the repository using `.gitleaks.toml` to detect accidentally staged
   secrets (API keys, private keys, tokens, etc.).
2. **Rust lint** — runs `cargo fmt --check` and
   `cargo clippy -- -D warnings` to catch formatting and lint regressions
   before they reach CI.

Both checks must pass for the commit to be recorded.

> **Emergency escape hatch:** if you need to commit without the secret scan
> (e.g., to fix a broken hook configuration), set `SKIP_SECRET_SCAN=1`:
> ```bash
> SKIP_SECRET_SCAN=1 git commit -m "ci: fix hook configuration"
> ```
> Use this sparingly — the scan exists to prevent credential leaks.

### Troubleshooting

**Hook not running at all**

Check that the hook files are executable:

```bash
ls -la .githooks/
```

Both `pre-commit` and `commit-msg` must have execute permission (`-rwxr-xr-x`).
If they do not, re-run the install script:

```bash
./scripts/install_hooks.sh
```

**Commit rejected for bad message format**

The `commit-msg` hook prints the reason for rejection and an example.  A valid
conventional commit looks like:

```
fix(refunds): prevent duplicate refund_id on initiation
```

If your commit covers multiple concerns, split it into separate commits — one
per logical change — or use the multi-line body format:

```
feat: resolve issues #1337 #1338

- #1337: add confirmation dialog modal to multisig.html
- #1338: add Git Hooks section to CONTRIBUTING.md
```

**Secret scan false positive**

If gitleaks flags a string that is not a real secret (e.g., a test fixture or
a documentation example), add an exception to `.gitleaksignore` in the
repository root:

```
# .gitleaksignore
# False positive: test fixture public key — not a real credential
abc123def456...  # git object hash of the flagged commit
```

Alternatively, add an `[allowlist]` entry to `.gitleaks.toml` for a path or
regex pattern that should always be ignored.  Open a PR with a comment
explaining why the exception is safe.

---

## Contribution Guidelines

### Translations

We aim to make LumenFlow accessible to a global audience, particularly the Latin American Stellar community. We welcome contributions that:
- Add translations for `README.md` and other key documentation to new languages.
- Update existing translations to keep them in sync with the English versions.
- Fix errors or improve clarity in translated documents.

When adding a new translation, please follow the naming convention `README.[lang].md` and add a link in the language selector at the top of the main `README.md`.

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

All commit messages **must** follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.
This is enforced by the `commit-msg` git hook installed via `scripts/install_hooks.sh`.
The changelog is generated automatically from these messages on every release.

#### Format

```
<type>[(scope)][!]: <subject>

[optional body]

[optional footer(s)]
```

- **type** — what kind of change (required, lowercase)
- **scope** — the area of the codebase affected (optional, lowercase, in parentheses)
- **`!`** — marks a breaking change (optional, placed before the colon)
- **subject** — short description in the imperative mood, no period at the end, ≤ 100 chars total on the header line

#### Valid types

| Type | Changelog section | Use for |
|---|---|---|
| `feat` | 🚀 Features | New features visible to users or callers |
| `fix` | 🐛 Bug Fixes | Bug fixes |
| `security` | 🔒 Security | Security patches, hardening changes |
| `perf` | ⚡ Performance | Performance improvements |
| `refactor` | _(omitted)_ | Code restructuring with no behaviour change |
| `docs` | 📝 Documentation | Documentation only changes |
| `test` | _(omitted)_ | Adding or updating tests |
| `ci` | 🤖 CI | CI/CD pipeline changes |
| `build` | 🔧 Build | Build system or toolchain changes |
| `chore` | _(omitted)_ | Maintenance (version bumps, lock files) |
| `style` | _(omitted)_ | Formatting, whitespace — no logic change |
| `revert` | ⏪ Reverts | Reverts a prior commit |

#### Examples

```
feat: add subscription payment support
fix: prevent double-refund on concurrent requests
security: validate nonce before signature check
perf(history): cache merchant payment index
docs: update deploy instructions for testnet
test: add edge cases for multisig threshold
ci: pin conventional-changelog-cli to 5.0.0
chore: bump soroban-sdk to 22.0.1
```

With a scope:

```
feat(payments): add batch processing endpoint
fix(refunds): reject duplicate refund_id on initiation
```

#### Breaking changes

Append `!` to the type/scope and add a `BREAKING CHANGE:` footer:

```
feat(payments)!: extend signature payload with nonce field

BREAKING CHANGE: the nonce (8-byte big-endian u64) is now required between
`contract_address` and `order_id` in the signature payload. Existing signatures
must be regenerated. See docs/signature-format.md for the updated layout.
```

Breaking changes appear in a dedicated **⚠ BREAKING CHANGES** section at the top of the changelog and are shown prominently in the GitHub Release notes.

#### Multi-paragraph body

Use a blank line to separate the subject from the body. Wrap body lines at 72 characters:

```
fix(storage): prevent TTL underflow on payment cleanup

cleanup_expired_payments compared a u64 timestamp against a signed
offset, which could wrap on very old entries. Changed the comparison
to saturating subtraction.

Closes #599
```

#### Automated validation

The `commit-msg` hook (installed by `scripts/install_hooks.sh`) rejects any commit whose
header does not match the pattern above **before** the commit is recorded locally.
CI also lints commit messages on every pull request so non-conforming commits cannot merge.

### Pull Requests

- Keep PRs focused — one feature or fix per PR.
- Fill out the PR template completely.
- Link the related issue with `Closes #N`.
- All CI checks must pass before merge.

### Architecture Decision Records (ADRs)

Any PR that introduces a **significant architectural change** must include an ADR. This includes changes to:

- Storage key design or storage tier usage
- Authentication or signature verification approach
- Pagination or query patterns
- New admin controls or circuit-breaker mechanisms
- Any decision that would be hard to reverse or that future maintainers need to understand

ADRs live in [`docs/adr/`](docs/adr/). Use the [ADR template](docs/adr/ADR-000-template.md) to create a new one, appending the next sequential number (e.g. `ADR-006-my-decision.md`). Add the new ADR to the index table in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Team Structure

To ensure high-quality reviews and maintainability, the project is organized into specialized teams:

- **Smart Contract Team** (`@Gloriachinedu/smart-contract-team`): Responsible for core logic in `contracts/`.
- **DevOps Team** (`@Gloriachinedu/devops-team`): Manages deployment `scripts/` and CI/CD.
- **Documentation Team** (`@Gloriachinedu/documentation-team`): Maintains project documentation and the `docs/` folder.
- **SDK Team** (`@Gloriachinedu/sdk-team`): Responsible for the SDK layer (once created).

Pull requests are automatically assigned to the relevant CODEOWNERS. At least one approval from a CODEOWNER is required for all PRs merging into `main`.

## Release Checklist

Use `scripts/release.sh <version>` to automate steps 1–4. Complete the remaining steps manually.

- [ ] All issues and PRs for the milestone are merged into `main`
- [ ] `cargo test --all-features` passes locally
- [ ] Run `./scripts/release.sh <new-version>` — this will:
  - [ ] Bump `version` in `contracts/lumenflow/Cargo.toml`
  - [ ] Update `Cargo.lock`
  - [ ] Prepend a new section to `CHANGELOG.md`
  - [ ] Commit the changes as `chore: release v<version>`
  - [ ] Create an annotated (or signed) git tag `v<version>`
- [ ] Fill in the release notes in `CHANGELOG.md` and amend the commit if needed
- [ ] Push branch and tag: `git push origin main && git push origin v<version>`
- [ ] Verify the `release.yml` CI workflow completes and the GitHub Release is created
- [ ] Announce the release in Discord / GitHub Discussions

## Reporting Security Issues

Do **not** open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md).

## Stale Issue and PR Policy

To keep the issue tracker clean and actionable, LumenFlow uses an automated stale bot
(`.github/workflows/stale.yml`) that runs daily.

### Issues

| Threshold | Action |
|-----------|--------|
| 60 days with no activity | Labelled `stale` with a comment asking for an update |
| 14 further days with no activity | Automatically closed with an explanatory comment |

### Pull Requests

| Threshold | Action |
|-----------|--------|
| 30 days with no activity | Labelled `stale` with a comment asking for an update |
| 7 further days with no activity | Automatically closed with an explanatory comment |

### Exemptions

Issues and PRs labelled **`pinned`** or **`security`** are never labelled stale or
automatically closed.

If your issue or PR is closed by the stale bot, feel free to reopen it — there is no
penalty for reopening work that is still relevant.

## Questions

Open a [GitHub Discussion](../../discussions) for questions, ideas, or general feedback.

## Governance

See [GOVERNANCE.md](GOVERNANCE.md) for how project decisions are made, the RFC process, and how to become a maintainer.
