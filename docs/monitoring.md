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

## Event Replay — Data Recovery

If off-chain data is lost or corrupted, the `scripts/replay-events.sh` tool reconstructs the full payment and refund history by re-reading every `lumenflow/*` event from Horizon.

### Dependencies

| Tool | Install |
|------|---------|
| `curl` | OS package manager |
| `jq` ≥ 1.6 | https://stedolan.github.io/jq/download/ |
| `sqlite3` | OS package manager |
| `python3` | https://www.python.org/downloads/ |
| `stellar` CLI | Optional — only for `VALIDATE=1` |

### Quick start

```bash
# Replay all events for a testnet contract
CONTRACT_ID=<your-contract-id> ./scripts/replay-events.sh
```

On completion the script writes:
- A **SQLite database** (`replay-db-<timestamp>.sqlite`) containing `payments`, `refunds`, and `events` tables.
- A **CSV file** (`replay-output-<timestamp>.csv`) with all replayed records.

### Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CONTRACT_ID` | ✅ | — | Deployed LumenFlow contract ID |
| `HORIZON_URL` | — | `https://horizon-testnet.stellar.org` | Horizon endpoint |
| `OUTPUT_CSV` | — | `replay-output-<ts>.csv` | CSV output path |
| `DB_FILE` | — | `replay-db-<ts>.sqlite` | SQLite database path |
| `DATE_FROM` | — | — | ISO-8601 lower bound (e.g. `2024-01-01`) |
| `DATE_TO` | — | — | ISO-8601 upper bound (e.g. `2024-12-31`) |
| `MERCHANT_FILTER` | — | — | Restrict output to one merchant address |
| `PAGE_LIMIT` | — | `200` | Horizon events per page |
| `VALIDATE` | — | `0` | Set `1` to cross-check replayed count against on-chain stats |
| `NETWORK` | — | `testnet` | Stellar network for validation |

### Filtering by date range

```bash
CONTRACT_ID=<id> \
DATE_FROM=2024-06-01 \
DATE_TO=2024-06-30 \
./scripts/replay-events.sh
```

### Filtering by merchant

```bash
CONTRACT_ID=<id> \
MERCHANT_FILTER=GABCDEF... \
./scripts/replay-events.sh
```

### Validating replayed state

Set `VALIDATE=1` to compare the replayed payment count against the value returned by `get_global_payment_stats`. Requires the `stellar` CLI and `ADMIN_ADDRESS` to be set:

```bash
CONTRACT_ID=<id> \
ADMIN_ADDRESS=<admin-public-key> \
VALIDATE=1 \
NETWORK=testnet \
./scripts/replay-events.sh
```

The script exits with code `3` if the counts do not match.

### CSV output schema

| Column | Type | Description |
|--------|------|-------------|
| `record_type` | string | `payment` or `refund` |
| `order_id` | string | Payment order ID |
| `refund_id` | string | Refund ID (refund rows only) |
| `payer` | string | Payer address (payment rows) |
| `merchant` | string | Merchant address (payment rows) |
| `token` | string | SAC token address |
| `amount` | integer | Amount in stroops |
| `refunded_total` | integer | Total refunded so far (payment rows) |
| `status` | string | `Completed`, `PartiallyRefunded`, `FullyRefunded`, `Pending`, `Approved`, `Rejected`, `Executed` |
| `memo` | string | Payment memo / refund reason |
| `timestamp` | ISO-8601 | Event time (payment processed / refund initiated) |
| `resolved_at` | ISO-8601 | Refund resolution time (refund rows only) |

### Querying the replay database

After the script runs you can query the SQLite database directly:

```sql
-- Top merchants by payment volume
SELECT merchant, COUNT(*) AS payments, SUM(amount) AS volume_stroops
FROM payments
GROUP BY merchant
ORDER BY volume_stroops DESC
LIMIT 10;

-- All pending refunds
SELECT refund_id, order_id, amount, initiated_at
FROM refunds WHERE status = 'Pending';

-- Payments partially or fully refunded
SELECT order_id, amount, refunded_total, status
FROM payments
WHERE status IN ('PartiallyRefunded', 'FullyRefunded');
```


---

## Grafana Dashboard & Prometheus Exporter

Real-time monitoring of contract health is provided via a Prometheus exporter
(`monitoring/lumenflow_exporter.py`) and a pre-built Grafana dashboard
(`monitoring/grafana-dashboard.json`).

### Architecture

```
Horizon SSE  →  lumenflow_exporter.py  →  Prometheus  →  Grafana
```

The exporter polls `GET /contracts/{id}/events` on Horizon, maps each
`lumenflow/*` event to a Prometheus metric, and persists a cursor so it
resumes after a restart without gaps.

### Metrics exposed

| Metric | Type | Description |
|--------|------|-------------|
| `lumenflow_payments_total` | Counter | Total `payment_processed` events |
| `lumenflow_refunds_total` | Counter | Total `refund_executed` events |
| `lumenflow_refunds_initiated_total` | Counter | Total `refund_initiated` events |
| `lumenflow_errors_total` | Counter | `suspicious_activity` events |
| `lumenflow_merchants_registered_total` | Counter | `merchant_registered` events |
| `lumenflow_multisig_executed_total` | Counter | `multisig_executed` events |
| `lumenflow_payment_amount` | Histogram | Payment amount distribution (stroops) |
| `lumenflow_active_merchants` | Gauge | Running count of active merchants |
| `lumenflow_contract_paused` | Gauge | `1` = paused, `0` = active |
| `lumenflow_last_scrape_timestamp_seconds` | Gauge | Unix timestamp of last successful scrape |
| `lumenflow_scrape_errors_total` | Counter | Horizon fetch errors |

### Running the exporter

```bash
pip install prometheus_client requests

CONTRACT_ID=<your-contract-id> \
HORIZON_URL=https://horizon-testnet.stellar.org \
SCRAPE_INTERVAL=30 \
EXPORTER_PORT=9101 \
python3 monitoring/lumenflow_exporter.py
```

Metrics are available at `http://localhost:9101/metrics`.

#### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CONTRACT_ID` | — (required) | LumenFlow contract address |
| `HORIZON_URL` | `https://horizon-testnet.stellar.org` | Horizon base URL |
| `SCRAPE_INTERVAL` | `30` | Seconds between polls |
| `EXPORTER_PORT` | `9101` | Port to expose `/metrics` on |
| `CURSOR_FILE` | `.lumenflow_cursor` | File to persist the last paging token |

#### Prometheus scrape config

Add to `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: lumenflow
    scrape_interval: 30s
    static_configs:
      - targets: ["localhost:9101"]
```

### Importing the Grafana dashboard

1. Open Grafana → **Dashboards → Import**.
2. Upload `monitoring/grafana-dashboard.json`.
3. Select your Prometheus data source when prompted.
4. Click **Import**.

The dashboard opens with the following panels:

| Panel | Description |
|-------|-------------|
| Total Payments | All-time counter |
| Total Refunds | All-time counter |
| Contract Status | Active / PAUSED indicator |
| Active Merchants | Current registered merchant count |
| Error Rate (5m) | Rolling error percentage |
| Payments per hour | Time-series throughput |
| Refunds per hour | Time-series throughput |
| Average Payment Amount | Rolling mean in stroops |
| Error Rate over time | Error events time-series |

### Alerts

Three alert rules are embedded in the dashboard JSON:

| Alert | Condition | Severity |
|-------|-----------|----------|
| High Error Rate | Error rate > 5% for 5 min | Critical |
| Payment Volume Drop 50% | Volume this hour < 50% of last hour | Warning |
| Contract Paused | `lumenflow_contract_paused == 1` for 1 min | Critical |

To enable alerts, configure a **Contact point** (Slack, PagerDuty, email, etc.)
in Grafana under **Alerting → Contact points**, then link it to a
**Notification policy**.
