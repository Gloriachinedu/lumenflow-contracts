# LumenFlow CLI

A command-line interface for interacting with the LumenFlow Soroban smart contract on Stellar.

---

## Installation

### Pre-built binaries (recommended)

Download the latest release for your platform from the [GitHub Releases](https://github.com/Gloriachinedu/lumenflow-contracts/releases) page:

| Platform | Archive |
|---|---|
| Linux x86_64 | `lumenflow-cli-vX.Y.Z-x86_64-unknown-linux-gnu.tar.gz` |
| Linux arm64 | `lumenflow-cli-vX.Y.Z-aarch64-unknown-linux-gnu.tar.gz` |
| macOS x86_64 | `lumenflow-cli-vX.Y.Z-x86_64-apple-darwin.tar.gz` |
| macOS arm64 (M-series) | `lumenflow-cli-vX.Y.Z-aarch64-apple-darwin.tar.gz` |
| Windows x86_64 | `lumenflow-cli-vX.Y.Z-x86_64-pc-windows-msvc.zip` |

Each archive includes a `.sha256` checksum file. Verify before installing:

```bash
# Linux arm64 example
VERSION=v0.1.0
curl -LO "https://github.com/Gloriachinedu/lumenflow-contracts/releases/download/${VERSION}/lumenflow-cli-${VERSION}-aarch64-unknown-linux-gnu.tar.gz"
curl -LO "https://github.com/Gloriachinedu/lumenflow-contracts/releases/download/${VERSION}/lumenflow-cli-${VERSION}-aarch64-unknown-linux-gnu.tar.gz.sha256"
sha256sum --check "lumenflow-cli-${VERSION}-aarch64-unknown-linux-gnu.tar.gz.sha256"
tar -xzf "lumenflow-cli-${VERSION}-aarch64-unknown-linux-gnu.tar.gz"
sudo mv lumenflow-cli /usr/local/bin/lumenflow
```

### Build from source

```bash
cargo install --path cli/lumenflow-cli
```

---

## Configuration

The CLI reads configuration from `.lumenflow.toml` in the current directory (or the file specified with `--config`). Environment variables override file values.

### Basic configuration

```toml
# .lumenflow.toml
network       = "testnet"
contract_id   = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
source_account = "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
rpc_url       = "https://soroban-testnet.stellar.org"
```

### Named profiles

Profiles let you switch between network environments without editing the file or changing environment variables.

```toml
# .lumenflow.toml

# Top-level keys are the global defaults used when no profile is selected
network        = "testnet"
contract_id    = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
source_account = "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

# Optionally set the profile used when --profile is not supplied
default_profile = "testnet"

[profiles.local]
network     = "local"
contract_id = "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
rpc_url     = "http://localhost:8000/soroban/rpc"

[profiles.testnet]
network     = "testnet"
contract_id = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
rpc_url     = "https://soroban-testnet.stellar.org"

[profiles.mainnet]
network     = "mainnet"
contract_id = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC"
rpc_url     = "https://soroban.stellar.org"
```

Each profile section can override any of the top-level keys. Keys omitted in a profile fall back to the global defaults.

### Selecting a profile

**Via `--profile` flag** (highest precedence after environment variables):

```bash
lumenflow --profile testnet pay --merchant GXXX --amount 500 --order-id ORD001
lumenflow --profile mainnet stats
lumenflow --profile local history --merchant GYYY
```

**Via `LUMENFLOW_PROFILE` environment variable:**

```bash
export LUMENFLOW_PROFILE=testnet
lumenflow pay --merchant GXXX --amount 500 --order-id ORD001
```

**Via `default_profile` in `.lumenflow.toml`:**

```toml
default_profile = "testnet"
```

When no profile is specified via flag, env var, or `default_profile`, the top-level keys in `.lumenflow.toml` are used directly.

### Precedence order (highest → lowest)

1. Environment variables (`LUMENFLOW_NETWORK`, `LUMENFLOW_CONTRACT_ID`, `LUMENFLOW_SOURCE`, `LUMENFLOW_RPC_URL`)
2. `--profile` flag / `LUMENFLOW_PROFILE` env var (selects a profile section)
3. Selected profile section in `.lumenflow.toml`
4. Top-level keys in `.lumenflow.toml`
5. Built-in defaults (`network = "testnet"`)

### Environment variables reference

| Variable | Description |
|---|---|
| `LUMENFLOW_PROFILE` | Active profile name (same as `--profile`) |
| `LUMENFLOW_NETWORK` | Network override (`local`, `testnet`, `mainnet`) |
| `LUMENFLOW_CONTRACT_ID` | Contract address override |
| `LUMENFLOW_SOURCE` | Source account secret key override |
| `LUMENFLOW_RPC_URL` | Soroban RPC URL override |

---

## Commands

### `pay`

Submit a payment to a merchant.

```bash
lumenflow pay --merchant <ADDRESS> --amount <AMOUNT> --order-id <ID>
```

**Options:**

| Flag | Description |
|---|---|
| `-m, --merchant` | Merchant Stellar address |
| `-a, --amount` | Amount in stroops |
| `-o, --order-id` | Unique order identifier |
| `--batch-file <FILE>` | CSV file for batch payments (see below) |
| `--dry-run` | Print what would be submitted without executing |

### `pay --batch-file`

Import and submit payments from a CSV file.

```bash
lumenflow pay --batch-file payments.csv
lumenflow pay --batch-file payments.csv --dry-run
```

CSV format (headers required):

```csv
order_id,merchant_address,amount,memo
ORD001,GXXX...,1000,Invoice #1
ORD002,GYYY...,500,Invoice #2
```

The CLI validates all rows before submitting. Batches are automatically split into groups of up to 10. Use `--dry-run` to preview without executing.

### `refund init`

Initiate a refund for an existing payment.

```bash
lumenflow refund init --order-id <ID> --amount <AMOUNT>
```

### `history`

View paginated payment history for a merchant.

```bash
lumenflow history --merchant <ADDRESS>
```

### `stats`

View global contract statistics (admin only).

```bash
lumenflow stats
```

---

## Global flags

| Flag | Description |
|---|---|
| `-c, --config <FILE>` | Path to config file (default: `.lumenflow.toml`) |
| `--profile <NAME>` | Named profile to activate |
| `-h, --help` | Print help |
| `-V, --version` | Print version |
