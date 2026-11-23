# Deployment Environments

LumenFlow supports three target environments: **local**, **testnet**, and **mainnet**. Each has an isolated config file under `scripts/env/`.

## Environment Config Files

| File | Network | RPC |
|---|---|---|
| `scripts/env/local.env` | `local` | `http://localhost:8000/soroban/rpc` |
| `scripts/env/testnet.env` | `testnet` | `https://soroban-testnet.stellar.org` |
| `scripts/env/mainnet.env` | `mainnet` | Your mainnet RPC endpoint |

Each file exports:
- `NETWORK` — network name passed to the Stellar CLI
- `RPC_URL` — RPC endpoint (passed as `--rpc-url`)
- `NETWORK_PASSPHRASE` — network passphrase (passed as `--network-passphrase`)

## Deploying

### Using `NETWORK` environment variable (original style)
```bash
NETWORK=testnet SOURCE_ACCOUNT=S_EXAMPLE_DO_NOT_USE ./scripts/deploy.sh
```

### Using `--network` flag
```bash
SOURCE_ACCOUNT=S_EXAMPLE_DO_NOT_USE ./scripts/deploy.sh --network testnet
```

`deploy.sh` auto-loads the matching `scripts/env/<network>.env` file before invoking the Stellar CLI.

> **Key hygiene:** `S_EXAMPLE_DO_NOT_USE` is a fake placeholder, not a valid key. Generate a fresh keypair for each environment with `scripts/generate_smoke_keypair.sh` and never commit real secret keys. Any testnet keys previously shown in this documentation are **deprecated and unfunded** — do not reuse them.

## Per-environment Values

### Local
```bash
# Start the local network container first
stellar network container start local

SOURCE_ACCOUNT=S_EXAMPLE_DO_NOT_USE ./scripts/deploy.sh --network local
```

### Testnet
```bash
# Generate a fresh keypair first: ./scripts/generate_smoke_keypair.sh
# Fund with Friendbot: https://friendbot.stellar.org
SOURCE_ACCOUNT=S_EXAMPLE_DO_NOT_USE ./scripts/deploy.sh --network testnet
```

### Mainnet
```bash
# Edit scripts/env/mainnet.env and set your RPC_URL with a real API key before deploying
SOURCE_ACCOUNT=S_EXAMPLE_DO_NOT_USE ./scripts/deploy.sh --network mainnet
```

> **Mainnet warning:** The `mainnet.env` file contains a placeholder RPC URL. Replace `<YOUR_API_KEY>` before deploying to production. Never commit real secret keys or API keys to version control.
