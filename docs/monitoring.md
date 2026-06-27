# Monitoring Plan

This document describes how to monitor LumenFlow contract activity and service health. The approach is manual-first; automated alerting can be layered on top as the deployment matures.

---

## Components to Monitor

| Component | What to Watch |
|---|---|
| **Soroban RPC node** | Availability, latency, block lag |
| **Contract** | Event emission, error codes, payment volume |
| **Wallet / payer integration** | Failed transaction submissions, fee spikes |
| **Horizon API** | Request rate, response time, `result_codes` |

---

## Key Metrics

### Contract Health

| Metric | Description | Warning Signal |
|---|---|---|
| `payment_processed` event rate | Payments per minute / hour | Sudden drop to 0 |
| `suspicious_activity` event count | Large payments or auth failures | Any occurrence |
| `InvalidSignature` (code 23) error rate | Signature verification failures | > 1% of payment attempts |
| `refund_initiated` / `refund_executed` ratio | Unresolved refund backlog | Ratio > 0.2 over 24 h |
| Total payment volume (i128) | Running sum from `payment_processed` events | Unexpected plateau |

### Infrastructure

| Metric | Description | Warning Signal |
|---|---|---|
| RPC node uptime | HTTP health endpoint | < 99.5% over 1 h |
| RPC response time (p95) | Soroban RPC `getTransaction` latency | > 2 s |
| Ledger close lag | Latest ledger vs. expected cadence (~5 s) | > 30 s behind |
| Horizon `latest_ledger` staleness | Difference between Horizon and network | > 10 ledgers |

---

## Contract Events to Track

All events use topic prefix `("lumenflow", <event_name>)`. See [events-reference.md](events-reference.md) for full payload schemas.

| Event | Severity | Action |
|---|---|---|
| `payment_processed` | Info | Record for volume metrics |
| `suspicious_activity` | **Warning** | Page on-call; review actor and value fields |
| `refund_executed` | Info | Reconcile against `refund_initiated` |
| `merchant_deactivated` | Warning | Verify intent; check for unauthorized admin action |
| `admin_set` | **Critical** | Alert immediately if unexpected |

---

## Manual Monitoring Procedure

Use these commands periodically until automated alerting is in place.

### 1. Check RPC node availability

```bash
curl -s -o /dev/null -w "%{http_code}" \
  https://soroban-testnet.stellar.org/
# Expected: 200
```

### 2. Fetch recent contract events via Horizon

```bash
curl -s "https://horizon-testnet.stellar.org/accounts/$CONTRACT_ID/transactions?limit=10&order=desc" \
  | jq '.._embedded.records[].operation_count'
```

### 3. Poll for `suspicious_activity` events

```bash
stellar contract events \
  --id "$CONTRACT_ID" \
  --network testnet \
  --start-ledger "$LAST_CHECKED_LEDGER" \
  --filter '["lumenflow","suspicious_activity"]'
```

### 4. Verify latest ledger is advancing

```bash
curl -s https://horizon-testnet.stellar.org/ | jq '.horizon_latest_ingested_ledger'
# Compare with previous value — should increase every ~5 seconds
```

---

## Recommended Alerting Setup (Future)

When you're ready to automate:

1. **Datadog / Grafana** — ship Horizon and RPC metrics via a custom collector that polls `/metrics` endpoints.
2. **PagerDuty / OpsGenie** — route `suspicious_activity` and `admin_set` events to on-call rotation.
3. **Stellar Turret / Horizon SSE** — subscribe to the event stream and push to a webhook for real-time processing.

Example SSE subscription (Node.js):

```js
import { Horizon } from "@stellar/stellar-sdk";

const server = new Horizon.Server("https://horizon-testnet.stellar.org");
server
  .transactions()
  .forAccount(CONTRACT_ID)
  .cursor("now")
  .stream({ onmessage: (tx) => console.log("new tx:", tx.id) });
```

---

## Runbooks

### High `InvalidSignature` rate

1. Check recent SDK version in use — a payload format change can break existing integrations.
2. Verify merchant public key registration matches the signing key.
3. Review `docs/signature-format.md` for the canonical payload spec.

### `suspicious_activity` alert

1. Identify the `actor` address in the event data.
2. Check payment volume for that actor in the last 1 h via `get_payer_payment_history`.
3. If fraudulent, call `deactivate_merchant` or coordinate with the admin to freeze activity.

### RPC node unreachable

1. Switch the SDK / CLI `--network` to a backup RPC endpoint.
2. Check [Stellar Status](https://status.stellar.org) for network-wide incidents.
3. Monitor `horizon_latest_ingested_ledger` until it catches up before resuming operations.
