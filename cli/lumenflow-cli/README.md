# lumenflow-cli

Command-line interface for interacting with the LumenFlow smart contract on Stellar Soroban.

## Configuration

Create a `.lumenflow.toml` in your project root, or set environment variables:

```toml
network        = "testnet"          # or "mainnet" / "local"
contract_id    = "C..."             # deployed contract address
source_account = "S..."             # your secret key or account alias
```

| Environment variable          | Equivalent field      |
|-------------------------------|-----------------------|
| `LUMENFLOW_CONTRACT_ID`       | `contract_id`         |
| `LUMENFLOW_SOURCE`            | `source_account`      |
| `LUMENFLOW_NETWORK`           | `network`             |

---

## Refund Lifecycle

Refunds progress through the following states:

```
Initiated → Pending → Approved → Executed
                   ↘ Rejected
```

### 1. Initiate a refund

Either the payer or the merchant can open a refund request:

```bash
lumenflow refund init \
  --refund-id  REFUND_001 \
  --order-id   ORDER_001 \
  --amount     500 \
  --caller     <payer-or-merchant-address> \
  --reason     "Customer request"
```

### 2. Approve the refund

A merchant or admin approves the pending refund:

```bash
lumenflow refund approve \
  --refund-id REFUND_001 \
  --caller    <merchant-or-admin-address>
```

### 3. Reject the refund

A merchant or admin can reject instead:

```bash
lumenflow refund reject \
  --refund-id REFUND_001 \
  --caller    <merchant-or-admin-address>
```

### 4. Execute the refund

Once approved, the merchant executes the token transfer:

```bash
lumenflow refund execute --refund-id REFUND_001
```

### 5. Check status

Query the current state of any refund:

```bash
lumenflow refund status --refund-id REFUND_001
```

---

## Batch Payment from CSV

Pay multiple merchants in a single command using a CSV file.

### CSV format

The file must have the following header and columns:

```
order_id,merchant_address,token_address,amount,memo
```

| Column | Description |
|---|---|
| `order_id` | Unique order identifier (non-empty string) |
| `merchant_address` | Merchant Stellar address (starts with `G`, 56 chars) |
| `token_address` | SAC token contract address (starts with `G`, 56 chars) |
| `amount` | Positive integer amount in stroops |
| `memo` | Free-text payment memo |

See `payments.example.csv` for a ready-to-use example file.

### Usage

```bash
lumenflow batch-pay \
  --file payments.csv \
  --signature <hex-encoded-64-byte-ed25519-signature> \
  --merchant-public-key <hex-encoded-32-byte-public-key>
```

The `--signature` and `--merchant-public-key` flags apply to **all rows** in the
file. Use this command when all payments share the same merchant keypair
(e.g. batch payouts signed by the same merchant server).

Optionally override the token address for all rows:

```bash
lumenflow batch-pay \
  --file payments.csv \
  --token GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 \
  --signature <sig> \
  --merchant-public-key <pubkey>
```

### Output

Results are printed as an ASCII table after all rows are processed:

```
+----------+---------+------------------------------------------------------------------+
| order_id | status  | tx_hash                                                          |
+----------+---------+------------------------------------------------------------------+
| ORDER_001 | success | a3f4c…                                                          |
| ORDER_002 | success | 9b12d…                                                          |
| ORDER_003 | FAILED: Error(Contract, #22) | -                                |
+----------+---------+------------------------------------------------------------------+

2/3 payment(s) succeeded.
```

Partial failures are reported per row — successful rows are not rolled back.
The command exits with code 1 if any row failed.

### Validation

Before any submissions are made the CLI validates every row:

- Header must match `order_id,merchant_address,token_address,amount,memo` exactly.
- Each row must have exactly 5 columns.
- `order_id` must be non-empty.
- `merchant_address` and `token_address` must be valid Stellar addresses (start with `G`, exactly 56 characters).
- `amount` must be a positive integer.

If validation fails the entire CSV is rejected and no payments are submitted.

### Limits

A single `batch-pay` invocation processes at most **10 rows** (the contract's
`batch_payment` limit). Split larger files and run the command multiple times.

---

## Other Commands

```bash
# Process a payment
lumenflow pay --merchant <addr> --amount 1000 --order-id ORDER_001

# View payment history
lumenflow history --merchant <addr>

# View global stats (admin only)
lumenflow stats
```

---

## Rate Limiting & Error Handling

The LumenFlow CLI makes HTTP calls to Stellar Horizon and Soroban RPC endpoints. These are subject to rate limits:

| Endpoint | Default limit |
|---|---|
| Horizon REST API (per IP) | 3 600 requests/hour |
| Horizon SSE streaming | up to 100 events/second |

When a rate limit is exceeded, Horizon returns **HTTP 429 Too Many Requests** along with a `Retry-After` header specifying the number of seconds to wait before issuing the next request. The CLI respects this header automatically.

### Automatic retries

The CLI uses the same exponential backoff helper as the SDK ([`sdk/src/retry.ts`](../../sdk/src/retry.ts)) for all outbound Horizon and RPC reads. It retries up to **3 times** with a base delay of **200 ms**, doubling on each attempt (capped at **5 000 ms**) plus a random jitter to avoid request storms.

### Handling 429 errors manually

If you hit rate limits in scripts that wrap the CLI, add a `sleep` before retrying:

```bash
#!/usr/bin/env bash
set -euo pipefail

MAX_ATTEMPTS=4
ATTEMPT=0
DELAY=2

until lumenflow history --merchant "$MERCHANT_ADDR"; do
  ATTEMPT=$((ATTEMPT + 1))
  if [ "$ATTEMPT" -ge "$MAX_ATTEMPTS" ]; then
    echo "ERROR: command failed after $MAX_ATTEMPTS attempts" >&2
    exit 1
  fi
  echo "Rate limited — retrying in ${DELAY}s (attempt $ATTEMPT/$MAX_ATTEMPTS)…"
  sleep "$DELAY"
  DELAY=$((DELAY * 2))
done
```

### Reducing request volume

To stay within the 3 600 req/hour budget in automated workflows:

- Use `--limit` flags to fetch larger pages rather than issuing many small requests.
- Add a short `sleep` between commands in batch scripts (`sleep 0.3` keeps you well under 1 req/s).
- For high-volume integrations, run your own Horizon instance or use an API key with a higher quota.

For complete documentation on Horizon rate limits, `Retry-After` semantics, and JavaScript/TypeScript exponential backoff examples, see **[docs/api-rate-limits.md](../../docs/api-rate-limits.md)**.

---

## Building

```bash
cargo build -p lumenflow-cli --release
```

The binary is output to `target/release/lumenflow`.

## Secrets and local config

Keep secret keys and environment-specific config out of version control. Recommended practices:

- Store secret keys in files outside the repository (e.g. in your home directory) and reference them with `--key-file`.
- Use interactive prompt (`--prompt-key`) for short-lived use rather than embedding keys in files.
- Use your OS keyring or a managed secrets service for production keys (AWS Secrets Manager, HashiCorp Vault, etc.).
- In CI, use the provider's secret store and never echo secrets in logs.

Example `.gitignore` entries (add to your project's `.gitignore`):

```
# LumenFlow and local env
.lumenflow.toml
.env.local
.env.*.local
# key files
*.key
.secrets/
# avoid committing exported files that may contain secrets
exported-keys/
```

CLI behavior notes:

- The CLI supports `--key-file` (reads a single-line secret key) and `--prompt-key` (hidden prompt). Keys read from either source are not printed to stdout/stderr.
- Avoid passing secret values directly on the command line where shell history may record them.

