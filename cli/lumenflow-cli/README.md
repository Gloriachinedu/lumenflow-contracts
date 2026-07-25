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
