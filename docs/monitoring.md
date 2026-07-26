# LumenFlow Monitoring Guide

How to subscribe to LumenFlow contract events, stream them in production, and set up alerting.

---

## Event Reference

All events are emitted under the `lumenflow` topic prefix. See [events-reference.md](events-reference.md) for full payload schemas.

| Event | Trigger |
|---|---|
| `lumenflow/payment_processed` | Payment completed |
| `lumenflow/refund_initiated` | Refund request opened |
| `lumenflow/refund_executed` | Refund transfer completed |
| `lumenflow/multisig_executed` | Multisig payment executed |
| `lumenflow/suspicious_activity` | Large-payment threshold exceeded |
| `lumenflow/merchant_registered` | New merchant registered |
| `lumenflow/admin_set` | Admin initialised |

---

## Subscribing via Stellar Horizon

Horizon exposes a Server-Sent Events (SSE) endpoint for contract events.

### Stream all LumenFlow events (curl)

```bash
CONTRACT_ID="<your-contract-id>"
HORIZON="https://horizon-testnet.stellar.org"   # or https://horizon.stellar.org for mainnet

curl -N "$HORIZON/contracts/$CONTRACT_ID/events?cursor=now"
```

Each SSE message is a JSON object:

```json
{
  "id": "...",
  "paging_token": "...",
  "type": "contract",
  "ledger": 12345,
  "ledger_closed_at": "2026-05-30T04:00:00Z",
  "contract_id": "<contract-id>",
  "topic": ["lumenflow", "payment_processed"],
  "value": { ... }
}
```

### Poll for recent events (curl)

```bash
# Fetch the last 200 events, newest first
curl "$HORIZON/contracts/$CONTRACT_ID/events?order=desc&limit=200"
```

### JavaScript SDK snippet

```js
import { Horizon } from "@stellar/stellar-sdk";

const server = new Horizon.Server("https://horizon-testnet.stellar.org");

server
  .contracts()
  .contractId(CONTRACT_ID)
  .events()
  .cursor("now")
  .stream({
    onmessage: (event) => {
      const [ns, name] = event.topic;
      console.log(`[${name}]`, event.value);

      if (name === "suspicious_activity") {
        triggerAlert(event);
      }
    },
    onerror: (err) => console.error("Stream error", err),
  });
```

### Python snippet

```python
import requests, json, sseclient

CONTRACT_ID = "<your-contract-id>"
url = f"https://horizon-testnet.stellar.org/contracts/{CONTRACT_ID}/events?cursor=now"

with requests.get(url, stream=True) as r:
    client = sseclient.SSEClient(r)
    for msg in client.events():
        event = json.loads(msg.data)
        topic = event.get("topic", [])
        print(topic, event.get("value"))
```

---

## Recommended Alert Thresholds

| Condition | Suggested threshold | Severity |
|---|---|---|
| `suspicious_activity` events | Any occurrence | Critical |
| `refund_executed` volume in 1 h | > 10 × average hourly refund volume | High |
| `refund_initiated` per order | ≥ configured `max_refunds_per_order` | Medium |
| `payment_processed` gap | No events for > 30 min during business hours | Medium |
| Failed `execute_multisig_payment` rate | > 5 failures / 10 min | Medium |

Configure these thresholds in your alerting tool (PagerDuty, Grafana, etc.) by filtering the event stream on the `topic[1]` field.

---

## Production Setup Checklist

1. **Use mainnet Horizon** (`https://horizon.stellar.org`) and set `cursor=now` so you only process new events.
2. **Persist the `paging_token`** of the last processed event to a durable store. On restart, resume from that token instead of `now` to avoid gaps.
3. **Deduplicate** on `id` — Horizon may re-deliver events after a reconnect.
4. **Alert on stream errors** — a broken SSE connection means missed events.
5. **Rotate monitoring keys** — use a read-only Stellar account for the Horizon API; never use a signing key.

---

## Further Reading

- [Stellar Horizon Events API](https://developers.stellar.org/docs/data/horizon/api-reference/resources/events)
- [Soroban Events](https://developers.stellar.org/docs/learn/encyclopedia/contract-development/events)
- [LumenFlow Events Reference](events-reference.md)

---

## Event Replay — Data Recovery (`scripts/replay-events.sh`)

If off-chain data is lost, `scripts/replay-events.sh` rebuilds the full payment and refund history by replaying every `lumenflow/*` event recorded on Horizon. All replayed records are stored in a local SQLite database and exported to a CSV file.

### Dependencies

| Tool | Install |
|---|---|
| `curl` | pre-installed on most systems |
| `jq` | `apt-get install jq` / `brew install jq` |
| `sqlite3` | `apt-get install sqlite3` / `brew install sqlite3` |

### Quick start

```bash
# Full replay on testnet
LUMENFLOW_CONTRACT_ID=CABC... ./scripts/replay-events.sh

# Replay only July 2026 for a specific merchant
./scripts/replay-events.sh \
  --contract CABC... \
  --date-start 2026-07-01T00:00:00Z \
  --date-end   2026-07-31T23:59:59Z \
  --merchant   GABC...

# Mainnet replay, custom database and CSV paths
./scripts/replay-events.sh \
  --contract CABC... \
  --network mainnet \
  --db /data/lumenflow.db \
  --output /data/lumenflow-replay.csv
```

### Options

| Flag | Description | Default |
|---|---|---|
| `-c`, `--contract` | Contract ID (or `LUMENFLOW_CONTRACT_ID` env var) | — |
| `-n`, `--network` | `testnet` or `mainnet` | `testnet` |
| `-H`, `--horizon` | Override Horizon base URL | auto from `--network` |
| `-d`, `--db` | SQLite database path | `replay.db` |
| `-o`, `--output` | CSV output path | `replay-events.csv` |
| `--date-start` | Only include events at or after this ISO-8601 datetime | — |
| `--date-end` | Only include events at or before this ISO-8601 datetime | — |
| `--merchant` | Filter records for a specific merchant address | — |
| `-v`, `--verbose` | Print each event as it is processed | off |
| `-h`, `--help` | Show usage | — |

### What the script does

1. **Fetches** all `lumenflow/*` events from Horizon using cursor-based pagination (200 events per page).
2. **Stores** every raw event in the `raw_events` table of the SQLite database.
3. **Reconstructs** domain records from the following events:

   | Event | Reconstructed record |
   |---|---|
   | `payment_processed` | `payments` row (payer, merchant, token, amount, memo, paid_at) |
   | `refund_initiated` | `refunds` row (refund_id, order_id, amount, reason, status=Pending) |
   | `refund_approved` | Updates `refunds.status` → Approved |
   | `refund_rejected` | Updates `refunds.status` → Rejected |
   | `refund_executed` | Updates `refunds.status` → Completed; increments `payments.refunded_amount`; marks payment as PartiallyRefunded or FullyRefunded |

4. **Validates** the replayed state:
   - No payment has `refunded_amount > amount`
   - All refund statuses are valid enum values
   - No refund references an unknown order ID

5. **Exports** a CSV (`replay-events.csv`) joining payments and their associated refunds, filtered by the requested date range and merchant.

### CSV columns

```
order_id, payer, merchant, token, amount, refunded_amount, payment_status,
memo, paid_at, payment_ledger, payment_tx_hash,
refund_id, refund_amount, refund_reason, refund_status,
refund_initiated_at, refund_resolved_at
```

### SQLite schema

```sql
payments  (order_id PK, payer, merchant, token, amount, memo, status,
           refunded_amount, paid_at, ledger, tx_hash)
refunds   (refund_id PK, order_id, initiator, merchant, amount, reason,
           status, initiated_at, resolved_at, ledger, tx_hash)
raw_events (event_id PK, paging_token, ledger, ledger_closed_at,
            event_type, value_json)
replay_meta (key PK, value)
```

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Replay completed and validation passed |
| `1` | Validation found one or more inconsistencies |
| `>1` | Script error (missing dependency, bad argument, Horizon unreachable) |
