# lumenflow-cli

Command-line interface for interacting with the LumenFlow Soroban smart contract.

## Configuration

The CLI loads configuration from `.lumenflow.toml` in the current directory, then overrides with environment variables.

### `.lumenflow.toml`

```toml
network = "testnet"          # one of: local, testnet, mainnet
contract_id = "C..."         # 56-character Stellar contract address (starts with 'C')
source_account = "S..."      # 56-character Stellar secret key (starts with 'S')
```

### Environment Variables

| Variable               | Description                        |
|------------------------|------------------------------------|
| `LUMENFLOW_NETWORK`    | Override `network`                 |
| `LUMENFLOW_CONTRACT_ID`| Override `contract_id`             |
| `LUMENFLOW_SOURCE`     | Override `source_account`          |

## Config Validation

Configuration is validated **before any command executes**. The following rules apply:

- `contract_id` — must be a valid Stellar contract address: starts with `C`, exactly 56 alphanumeric characters.
- `network` — must be one of: `local`, `testnet`, `mainnet`.
- `source_account` — must be a valid Stellar secret key: starts with `S`, exactly 56 alphanumeric characters.

On failure, a clear error message shows which field failed and why.

### `validate-config` subcommand

Run config validation explicitly without executing any other command:

```bash
lumenflow validate-config
```

Example output (text):
```
Configuration is valid.
```

Example output (JSON):
```json
{
  "success": true,
  "message": "Configuration is valid."
}
```

On failure:
```
Configuration validation failed:
  - network: 'devnet' is not valid. Must be one of: local, testnet, mainnet
  - contract_id: 'BADID' is not a valid Stellar contract address (must start with 'C' and be 56 characters)
```

## Commands

```
lumenflow [OPTIONS] <COMMAND>

Options:
  -c, --config <FILE>      Path to config file (default: .lumenflow.toml)
      --output <FORMAT>    Output format: text (default) or json

Commands:
  pay              Pay a merchant
  refund init      Initiate a refund
  history          View payment history
  stats            View global statistics (admin only)
  validate-config  Validate configuration without executing a command
```

## `--output json` Flag

All commands support `--output json` for machine-readable output. This is useful for scripts and CI pipelines.

```bash
lumenflow --output json stats
```

```json
{
  "success": true,
  "command": "stats",
  "total_volume": "45000.00",
  "total_payments": 128,
  "active_merchants": 12
}
```

Exit codes remain the same regardless of output format.

### JSON Schemas

#### `pay`
```json
{ "success": true, "command": "pay", "order_id": "...", "merchant": "...", "amount": 0, "network": "..." }
```

#### `refund init`
```json
{ "success": true, "command": "refund", "order_id": "...", "amount": 0, "contract_id": "..." }
```

#### `history`
```json
{ "success": true, "command": "history", "merchant": "...", "payments": [{ "order_id": "...", "amount": "..." }] }
```

#### `stats`
```json
{ "success": true, "command": "stats", "total_volume": "...", "total_payments": 0, "active_merchants": 0 }
```

#### `validate-config`
```json
{ "success": true, "message": "Configuration is valid." }
```
or
```json
{ "success": false, "fields": ["network: ..."] }
```

#### Error (validation failure)
```json
{ "success": false, "error": "Configuration validation failed", "fields": ["..."] }
```
