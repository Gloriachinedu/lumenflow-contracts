# Developer Onboarding Guide

Welcome to LumenFlow! This guide takes you from zero to running tests locally and opening your first PR.

> **SDK Quickstart:** If you want to integrate with LumenFlow using TypeScript, jump straight to the
> [SDK Quickstart Guide](../sdk/README.md#quick-start) — it walks you from installation to your first
> successful payment in under 10 minutes.

---

## Merchant and payer quickstart

### Merchant flow

1. Open the merchant dashboard in [frontend/merchant-dashboard/index.html](../frontend/merchant-dashboard/index.html) or the shared pages in [frontend/history.html](../frontend/history.html) and [frontend/multisig.html](../frontend/multisig.html).
2. Register your merchant profile with the contract using the CLI or SDK. A typical CLI example is:

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$MERCHANT_KEY" \
  -- register_merchant \
  --merchant_address "$MERCHANT_ADDRESS" \
  --name "Demo Store" \
  --description "Accepts payments for digital goods" \
  --contact_info "ops@example.com" \
  --category Retail
```

3. Review incoming payments in the dashboard, then use the refund workflow if a customer requests a reversal.
4. Use the receipt experience in [frontend/receipt.html](../frontend/receipt.html) to verify the final payment status and any refund history.

### Payer flow

1. Start from the receipt page in [frontend/receipt.html](../frontend/receipt.html) to look up an order by ID.
2. Submit a payment using the SDK or CLI. A minimal SDK example is:

```ts
import { signPaymentPayload } from '../sdk/src/signPaymentPayload';

const payload = Buffer.from('order-001');
const signature = signPaymentPayload(payload, secretKey);
```

3. If a refund is needed, initiate it through the payer or merchant flow and monitor the refund lifecycle until it completes.
4. Use the receipt view to confirm payment state, refund history, and the transaction summary after the payment is processed.

### Common end-to-end flows

- Registration: the merchant registers, is activated, and begins receiving payments.
- Payment: the payer submits a signed payment request and receives a receipt.
- Refund: the payer or merchant initiates a refund, the merchant approves or rejects it, and the refund is executed.
- Receipt lookup: a payer or merchant opens the receipt page by order ID to inspect payment and refund details.

Suggested visuals for this guide include a merchant dashboard screenshot, a receipt page screenshot on mobile and desktop, and the refund lifecycle diagram in [docs/refund-lifecycle.md](./refund-lifecycle.md).

If you are preparing a contributor walkthrough or onboarding video, use the script in [docs/onboarding-video-script.md](./onboarding-video-script.md).

---

## 1. Prerequisites (~10 min)

Install the following tools:

| Tool | Install | Verify |
|---|---|---|
| Rust (stable) | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` | `rustc --version` |
| Stellar CLI | [Installation guide](https://developers.stellar.org/docs/tools/stellar-cli) | `stellar --version` |
| Docker Desktop | [docker.com](https://www.docker.com/products/docker-desktop) | `docker --version` |
| Git | System package manager | `git --version` |
| gitleaks | See below | `gitleaks version` |

Add the WASM compilation target:

```bash
rustup target add wasm32-unknown-unknown
```

### Installing gitleaks (secrets scanning)

LumenFlow uses [gitleaks](https://github.com/gitleaks/gitleaks) to prevent
accidental commits of private keys, seed phrases, and API tokens. Install it
before running the pre-commit hook:

**macOS:**
```bash
brew install gitleaks
```

**Linux:**
```bash
curl -sSfL https://github.com/gitleaks/gitleaks/releases/latest/download/gitleaks_linux_x64.tar.gz \
  | tar -xz -C /usr/local/bin
```

**Windows:**
```powershell
winget install gitleaks
```

After installation, activate the pre-commit hook:

```bash
git config core.hooksPath .githooks
# or
./scripts/install_hooks.sh
```

The hook runs `gitleaks protect --staged` on every commit, blocking any
staged files that match the rules in `.gitleaks.toml`.

See [`docs/secrets-and-local-env.md`](./secrets-and-local-env.md) for the full
secrets scanning policy, false-positive handling, and manual scan commands.

---

## 2. Clone and Configure (~2 min)

```bash
# Fork the repo on GitHub first, then:
git clone https://github.com/<your-username>/lumenflow-contracts.git
cd lumenflow-contracts

# Add the upstream remote to stay in sync
git remote add upstream https://github.com/Gloriachinedu/lumenflow-contracts.git
```

---

## 3. Build (~3 min)

```bash
# Compile the contract to WASM
cargo build --target wasm32-unknown-unknown --release --package lumenflow
```

The compiled artifact is at `target/wasm32-unknown-unknown/release/lumenflow.wasm` (~55 KB).

---

## 4. Run Tests (~2 min)

```bash
# Run all tests
cargo test --all-features

# Run a single test by name
cargo test test_successful_refund_flow

# Full lint + test pipeline (matches CI)
./scripts/test.sh
```

All tests live in `contracts/lumenflow/src/test.rs` and use `soroban-sdk` testutils with `mock_all_auths()`.

---

## 5. Local Network Setup (~5 min)

Spin up a local Stellar node with Soroban RPC using Docker:

```bash
# Start the local node and deploy the contract
SOURCE_ACCOUNT=<your-secret-key> ./scripts/local_up.sh
```

The script prints a `CONTRACT_ID`. Use it to initialise the admin:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source-account <admin-secret-key> \
  --rpc-url http://localhost:8000/soroban/rpc \
  --network-passphrase "Standalone Network ; February 2017" \
  -- set_admin --admin <admin-address>
```

Stop the node when done:

```bash
docker compose down
```

---

## 6. Code Coverage (optional, ~3 min setup)

```bash
cargo install cargo-llvm-cov
rustup component add llvm-tools-preview

# Generate HTML report
COVERAGE=1 ./scripts/test.sh
# Open coverage/index.html in your browser
```

---

## 7. Soroban Contract Contributor Guide (~20 min)

This section is for contributors working on the Soroban smart contracts in `contracts/lumenflow/`. It covers the Stellar CLI, local node setup, fuzz testing, reading test snapshots, and a guided first contribution.

### 7.1 Soroban prerequisites

| Tool | Install | Verify |
|---|---|---|
| Rust 1.87.0 | `rustup toolchain install 1.87.0` (pinned in `rust-toolchain.toml`) | `rustc --version` |
| WASM target | `rustup target add wasm32-unknown-unknown` | `rustup target list --installed` |
| Stellar CLI | See 7.2 below | `stellar --version` |
| cargo-fuzz | `cargo install cargo-fuzz` | `cargo fuzz --version` |

The `soroban-sdk` version in `contracts/lumenflow/Cargo.toml` must match the toolchain channel in `rust-toolchain.toml`; a mismatch is the most common cause of cryptic test failures.

### 7.2 Installing the Stellar CLI

Pick one of:

```bash
# Any platform (compiles from source, slowest but always current)
cargo install --locked stellar-cli

# macOS
brew install stellar-cli

# Windows
winget install --id Stellar.StellarCLI
```

Confirm with `stellar --version`, then add the WASM target if you have not already:

```bash
rustup target add wasm32-unknown-unknown
```

### 7.3 Local node setup

The repo ships a helper that starts a standalone Stellar node with Soroban RPC via Docker and deploys the contract:

```bash
SOURCE_ACCOUNT=<your-secret-key> ./scripts/local_up.sh
```

The script prints a `CONTRACT_ID`. Point the CLI at the local node for every subsequent invocation:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source-account <admin-secret-key> \
  --rpc-url http://localhost:8000/soroban/rpc \
  --network-passphrase "Standalone Network ; February 2017" \
  -- set_admin --admin <admin-address>
```

Tear the node down with `docker compose down` when you are finished.

### 7.4 Running the test suite

```bash
# All unit tests, all features
cargo test --all-features

# A single test by name
cargo test test_successful_refund_flow

# Full lint + test pipeline (matches CI)
./scripts/test.sh
```

Contract tests live in `contracts/lumenflow/src/test.rs` and use `soroban-sdk` testutils.

### 7.5 Running fuzz targets

Fuzz targets live under `contracts/lumenflow/fuzz/`. Install `cargo-fuzz` once, then run a target:

```bash
cargo install cargo-fuzz

# Run a target for a fixed number of iterations
cargo fuzz run fuzz_auth \
  --manifest-path contracts/lumenflow/fuzz/Cargo.toml -- -runs=10000

cargo fuzz run fuzz_verify_signature \
  --manifest-path contracts/lumenflow/fuzz/Cargo.toml -- -runs=10000

cargo fuzz run fuzz_batch_payment_deserialize \
  --manifest-path contracts/lumenflow/fuzz/Cargo.toml -- -runs=10000
```

A crash writes a reproducer to `contracts/lumenflow/fuzz/artifacts/<target>/`; commit the reproducer alongside the fix so the regression is captured.

### 7.6 Reading test snapshots

Soroban tests assert on observable contract state rather than internal variables. Two patterns matter:

- **Auth:** call `env.mock_all_auths()` at the start of a test so `require_auth()` calls succeed without real signatures. To assert that an entrypoint *does* require auth, use `env.mock_auths(&[])` and expect a failure.
- **Events:** after invoking an entrypoint, inspect `env.events().all()` and assert on the emitted topics and data. For example:

```rust
let events = env.events().all();
assert_eq!(events.len(), 1);
let (_, topics, data) = &events[0];
// topics[0] is the event name symbol, data is the payload
```

When a test fails, the panic message usually points at the exact assertion; re-run with `cargo test <name> -- --nocapture` to see the full event stream.

### 7.7 First-contribution exercise: add an entrypoint

This exercise adds a read-only `version` entrypoint and a matching test. It touches two files and is a good warm-up for the `#[contractimpl]` pattern.

1. **Add the entrypoint.** In `contracts/lumenflow/src/lib.rs`, inside the existing `#[contractimpl]` block, add:

   ```rust
   /// Returns the contract version string.
   pub fn version(env: Env) -> Symbol {
       Symbol::new(&env, "1_0_0")
   }
   ```

   Note the pattern: `#[contractimpl]` generates the exported WASM functions from these `pub fn` methods, and the first argument is always `Env`.

2. **Write the test.** In `contracts/lumenflow/src/test.rs`, add:

   ```rust
   #[test]
   fn test_version() {
       let env = Env::default();
       let contract_id = env.register_contract(None, LumenFlowContract);
       let client = LumenFlowContractClient::new(&env, &contract_id);
       assert_eq!(client.version(), Symbol::new(&env, "1_0_0"));
   }
   ```

3. **Run it:** `cargo test test_version --all-features`.

4. **Run the full pipeline:** `./scripts/test.sh` to confirm lint and all tests still pass.

5. **Open a PR** following section 8 below, linking the issue with `Closes #N`.

> **Validating this guide:** if you are the first contributor to follow this section from scratch, please note any step that was unclear or out of date in your PR description so we can keep the guide accurate.

---

## 8. Open Your First PR (~5 min)
=======

1. Create a feature branch:
   ```bash
   git checkout -b feat/your-feature
   ```
2. Make your changes, add tests, and verify everything passes:
   ```bash
   ./scripts/test.sh
   ```
3. Commit using [Conventional Commits](https://www.conventionalcommits.org/):
   ```bash
   git commit -m "feat: describe your change"
   ```
4. Push and open a PR against `main`:
   ```bash
   git push -u origin feat/your-feature
   ```
5. Fill out the PR template and link the related issue with `Closes #N`.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for code style, review, and merge requirements.

---

## Troubleshooting

**WASM target missing:**
```bash
rustup target add wasm32-unknown-unknown
```

**Local network fails to start:**
```bash
stellar network container restart local
```

**Test failures — toolchain mismatch:** Ensure the `soroban-sdk` version in `Cargo.toml` matches the channel in `rust-toolchain.toml`.

**Need help?** Open a [GitHub Discussion](https://github.com/Gloriachinedu/lumenflow-contracts/discussions) or join [Discord](https://discord.gg/lumenflow).
