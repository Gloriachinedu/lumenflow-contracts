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
NETWORK=testnet SOURCE_ACCOUNT=<secret-key> ./scripts/deploy.sh
```

### Using `--network` flag
```bash
SOURCE_ACCOUNT=<secret-key> ./scripts/deploy.sh --network testnet
```

`deploy.sh` auto-loads the matching `scripts/env/<network>.env` file before invoking the Stellar CLI.

## Per-environment Values

### Local
```bash
# Start the local network container first
stellar network container start local

SOURCE_ACCOUNT=<your-local-key> ./scripts/deploy.sh --network local
```

### Testnet
```bash
# Fund with Friendbot: https://friendbot.stellar.org
SOURCE_ACCOUNT=<testnet-secret-key> ./scripts/deploy.sh --network testnet
```

### Mainnet
```bash
# Edit scripts/env/mainnet.env and set your RPC_URL with a real API key before deploying
SOURCE_ACCOUNT=<mainnet-secret-key> ./scripts/deploy.sh --network mainnet
```

> **Mainnet warning:** The `mainnet.env` file contains a placeholder RPC URL. Replace `<YOUR_API_KEY>` before deploying to production. Never commit real secret keys or API keys to version control.

## Database Connection Pooling and Query Timeouts

Off-chain services that persist webhook state and event data use a pooled database connection with a bounded query timeout. This prevents connection exhaustion and cascading failures under load.

### Pool Settings

| Setting | Value | Description |
|---|---|---|
| `DB_POOL_MIN` | `2` | Minimum number of idle connections kept open |
| `DB_POOL_MAX` | `20` | Maximum number of concurrent connections |
| `DB_QUERY_TIMEOUT_MS` | `5000` | Query timeout (5 seconds) |

- The pool maintains at least **2** connections and never exceeds **20**.
- Any query exceeding the **5 second** timeout is cancelled and the underlying long-running query is killed, freeing the connection back to the pool.

### Pool Metrics

The following Prometheus gauges are exposed for monitoring pool health:

| Metric | Type | Description |
|---|---|---|
| `db_pool_active_connections` | Gauge | Connections currently in use |
| `db_pool_idle_connections` | Gauge | Connections available in the pool |
| `db_pool_wait_time_seconds` | Gauge | Time requests spend waiting for a connection |

Alert when `db_pool_active_connections` approaches `DB_POOL_MAX` or when `db_pool_wait_time_seconds` rises consistently above zero — both indicate pool saturation.

### Per-environment Tuning

- **Local** — defaults are fine; a single developer rarely saturates the pool.
- **Testnet** — keep defaults; use the pool metrics to observe behavior under integration tests.
- **Mainnet** — keep `DB_POOL_MAX` at or below the database server's connection limit (accounting for other clients). If `db_pool_wait_time_seconds` stays elevated, investigate slow queries before raising `DB_POOL_MAX`.

### Load Testing

A load test verifies that the pool does not exhaust connections at **500 concurrent requests**. Run it before deploying changes that affect database access:

```bash
# Verifies no connection exhaustion under 500 concurrent requests
./scripts/load-test-db.sh
```

The test asserts that `db_pool_active_connections` never exceeds `DB_POOL_MAX` and that no requests fail due to connection acquisition timeouts.
