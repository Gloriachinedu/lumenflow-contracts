# Developer Onboarding Guide

Welcome to LumenFlow! This guide takes you from zero to running tests locally and opening your first PR.

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

---

## 1. Prerequisites (~10 min)

Install the following tools:

| Tool | Install | Verify |
|---|---|---|
| Rust (stable) | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` | `rustc --version` |
| Stellar CLI | [Installation guide](https://developers.stellar.org/docs/tools/stellar-cli) | `stellar --version` |
| Docker Desktop | [docker.com](https://www.docker.com/products/docker-desktop) | `docker --version` |
| Git | System package manager | `git --version` |

Add the WASM compilation target:

```bash
rustup target add wasm32-unknown-unknown
```

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

## 7. Open Your First PR (~5 min)

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
