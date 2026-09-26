# Local Environment Setup

This guide covers everything you need to build, test, and deploy LumenFlow locally.

## Quick Start

Run the bootstrap script to install all required tools automatically:

```bash
./scripts/bootstrap.sh
```

Supported platforms: **Linux** (x86_64, arm64) and **macOS** (x86_64, arm64).

---

## Required Tools

| Tool | Version | Purpose |
|------|---------|---------|
| Rust (stable) | ≥ 1.74 | Compile contract to WASM |
| `wasm32-unknown-unknown` target | — | Cross-compile for Soroban |
| Stellar CLI | 21.4.1 | Deploy and invoke contracts |
| Docker Desktop | latest | Run a local Stellar network |

---

## Manual Installation

If you prefer to install tools yourself instead of using the bootstrap script:

### 1. Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustc --version   # should print stable version
```

### 2. WASM target

```bash
rustup target add wasm32-unknown-unknown
```

### 3. Stellar CLI

**macOS (Homebrew):**
```bash
brew install stellar/tap/stellar-cli
```

**Linux / macOS (binary):**
```bash
# Replace <TRIPLE> with your platform:
#   x86_64-unknown-linux-gnu  (Linux x86_64)
#   aarch64-unknown-linux-gnu (Linux arm64)
#   x86_64-apple-darwin       (macOS x86_64)
#   aarch64-apple-darwin      (macOS arm64)
VERSION=21.4.1
TRIPLE=x86_64-unknown-linux-gnu
curl -sSfL "https://github.com/stellar/stellar-cli/releases/download/v${VERSION}/stellar-cli-${VERSION}-${TRIPLE}.tar.gz" \
  | tar -xz -C /tmp
sudo install -m 755 /tmp/stellar /usr/local/bin/stellar
stellar --version
```

### 4. Docker Desktop

Download from [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop) and start it before using the local Stellar network.

---

## Environment Variables

Copy the example below into a `.env` file in the project root (git-ignored) and fill in your values:

```bash
# .env (do not commit)
NETWORK=local                     # local | testnet | mainnet
SOURCE_ACCOUNT=S...               # Stellar secret key for deployments
ADMIN_ADDRESS=G...                # Admin public key
CONTRACT_ID=                      # Set after first deploy
```

Load them before running scripts:

```bash
set -a && source .env && set +a
```

---

## Build

```bash
cargo build --target wasm32-unknown-unknown --release --package lumenflow
# WASM output: target/wasm32-unknown-unknown/release/lumenflow.wasm
```

---

## Test

```bash
# Full lint + test pipeline
./scripts/test.sh

# Tests only
cargo test --all-features

# Single test
cargo test test_successful_refund_flow
```

---

## Local Network

```bash
# Start a local Stellar node (requires Docker)
stellar network container start local

# Build and deploy
NETWORK=local SOURCE_ACCOUNT=<secret-key> ./scripts/deploy.sh

# Initialise admin
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source-account <secret-key> \
  --network local \
  -- set_admin --admin <ADMIN_ADDRESS>
```

---

## Testnet

```bash
# Fund your account with testnet XLM
curl "https://friendbot.stellar.org?addr=<YOUR_PUBLIC_KEY>"

# Deploy
NETWORK=testnet SOURCE_ACCOUNT=<testnet-secret-key> ./scripts/deploy.sh
```

---

## Troubleshooting

**`cargo: command not found`**  
Re-source your shell profile: `source "$HOME/.cargo/env"` or open a new terminal.

**`error[E0463]: can't find crate for std` (WASM build)**  
The WASM target is missing: `rustup target add wasm32-unknown-unknown`

**`stellar: command not found` after bootstrap**  
Add `~/.cargo/bin` to your PATH: `export PATH="$HOME/.cargo/bin:$PATH"`

**Local network fails to start**  
Ensure Docker Desktop is running, then: `stellar network container restart local`

**`soroban-sdk` version mismatch in tests**  
Check that the version in `contracts/lumenflow/Cargo.toml` matches the channel in `rust-toolchain.toml`.
