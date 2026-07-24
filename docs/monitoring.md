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
