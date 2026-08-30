# LumenFlow Webhook Server

An idempotent, production-ready webhook delivery server that subscribes to LumenFlow Soroban contract events via the Horizon SSE stream and forwards them to your backend.

## Features

- **Idempotent delivery** — each event is identified by its `paging_token`. Duplicate events from reconnections or network retries are silently dropped using a pluggable store.
- **Cursor persistence** — the last processed `paging_token` is written to `.webhook-cursor` so that restarts resume from the correct position without re-processing past events.
- **Retry with exponential back-off** — failed deliveries are retried up to `MAX_RETRIES` times with configurable initial delay.
- **Pluggable store** — swap `MemoryIdempotencyStore` (dev/test) for `RedisIdempotencyStore` (production) with a single line change.
- **Graceful shutdown** — handles `SIGINT` and `SIGTERM` cleanly.

## Quick start

```bash
cd webhook
npm install
CONTRACT_ID=<your-contract-id> WEBHOOK_URL=https://your-backend.example.com/hook node webhook-server.js
```

## Environment variables

| Variable       | Required | Default                                    | Description                              |
|----------------|----------|--------------------------------------------|------------------------------------------|
| `CONTRACT_ID`  | ✅       | —                                          | Deployed Soroban contract address        |
| `WEBHOOK_URL`  | ✅       | —                                          | Downstream endpoint to receive events    |
| `HORIZON_URL`  |          | `https://horizon-testnet.stellar.org`      | Horizon base URL                         |
| `CURSOR`       |          | `now` (or last persisted cursor)           | Starting paging token                    |
| `MAX_RETRIES`  |          | `5`                                        | Delivery attempts before giving up       |
| `RETRY_BASE_MS`|          | `500`                                      | Initial back-off in milliseconds         |

## Idempotency stores

### MemoryIdempotencyStore (default)

In-memory store — suitable for development and single-instance deployments. State is lost on restart (the cursor file provides restart safety for the stream position).

### RedisIdempotencyStore (production)

Persistent, TTL-aware store backed by Redis. Tokens expire after `ttlSeconds` (default 7 days).

```js
const Redis = require('ioredis');
const { RedisIdempotencyStore } = require('./idempotency-store');
const idempotencyStore = new RedisIdempotencyStore(new Redis(), { ttlSeconds: 86400 * 7 });
```

Replace the `idempotencyStore` constant in `webhook-server.js` with the above.

## Custom store

Implement the interface:

```js
class MyStore {
  async has(token) { /* return boolean */ }
  async add(token, meta) { /* persist token */ }
  async size() { /* return count (optional) */ }
}
```

## Testing

```bash
npm test
```

Tests cover both `MemoryIdempotencyStore` and the `RedisIdempotencyStore` contract via a lightweight Redis stub (no real Redis required).

## Delivery headers

Each webhook POST includes:

| Header                       | Description                         |
|------------------------------|-------------------------------------|
| `X-LumenFlow-Event`          | Event name (e.g. `payment_processed`) |
| `X-LumenFlow-Paging-Token`   | Unique event identifier              |
| `X-LumenFlow-Attempt`        | Delivery attempt number (1-based)    |

## See also

- [Webhook Integration Guide](../docs/webhook-integration.md)
- [Events Reference](../docs/events-reference.md)
