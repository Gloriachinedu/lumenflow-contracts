# Webhook / Off-Chain Notification Integration Guide

This guide explains how to receive real-time notifications of LumenFlow contract events in your backend system using the Stellar Horizon event stream.

---

## Overview

LumenFlow emits Soroban contract events for every significant action (payments, refunds, disputes, etc.). Your backend can subscribe to these events via the Horizon HTTP event stream and trigger webhooks or internal workflows.

---

## 1. Listening to the Horizon Event Stream

Horizon exposes a Server-Sent Events (SSE) endpoint for contract events:

```
GET https://horizon-testnet.stellar.org/contracts/{CONTRACT_ID}/events
```

For mainnet replace `horizon-testnet.stellar.org` with `horizon.stellar.org`.

### Query parameters

| Parameter | Description |
|-----------|-------------|
| `cursor` | Paging token — use `now` to start from the current ledger, or a saved token to resume |
| `limit` | Max events per page (default 20, max 200) |
| `topic1` | Filter by first topic — use `lumenflow` to receive only LumenFlow events |

### Example stream URL

```
https://horizon-testnet.stellar.org/contracts/{CONTRACT_ID}/events?cursor=now&topic1=lumenflow
```

---

## 2. Verifying Event Authenticity

Events delivered via Horizon are signed by the Stellar network validators. To verify an event is genuine:

1. **Check the contract ID** — confirm `contract_id` in the event matches your deployed contract address.
2. **Check the ledger sequence** — events include a `ledger` field; cross-reference with Horizon's `/ledgers/{seq}` endpoint to confirm finality.
3. **Verify the topic** — the first topic must be `lumenflow` and the second must match the expected event name (e.g. `payment_processed`).
4. **Replay protection** — store the `paging_token` of each processed event and reject duplicates (see [Idempotency](#4-idempotency-considerations)).

> **Note:** Horizon itself does not provide a cryptographic signature over event data. For high-value integrations, additionally verify the transaction hash on-chain via `/transactions/{hash}`.

---

## 3. Example Node.js Webhook Server — Filtered by Merchant

LumenFlow payment and refund events include the **merchant address as `topic[2]`**. You can pass this directly as the `topic3` query parameter on the Horizon SSE stream to receive only events for a specific merchant, eliminating client-side filtering.

### Horizon SSE — merchant-filtered stream

```
GET https://horizon-testnet.stellar.org/contracts/{CONTRACT_ID}/events
    ?cursor=now
    &topic1=lumenflow
    &topic2=payment_processed
    &topic3=<merchant-address-xdr-base64>
```

To compute the base64 XDR of a Stellar address:

```javascript
import { Address } from '@stellar/stellar-sdk';

const merchantXdr = Address.fromString('G...MERCHANT_ADDR')
  .toScVal()
  .toXDR('base64');

const url =
  `${HORIZON_URL}/contracts/${CONTRACT_ID}/events` +
  `?cursor=now&topic1=lumenflow&topic2=payment_processed&topic3=${encodeURIComponent(merchantXdr)}`;
```

The following example uses the `eventsource` package to consume the SSE stream and forward events to your webhook endpoint.

### Install dependencies

```bash
npm install eventsource node-fetch @stellar/stellar-sdk
```

### `webhook-server.js`

```js
const EventSource = require("eventsource");
const fetch = require("node-fetch");
const { Address, scValToNative, xdr } = require("@stellar/stellar-sdk");

const CONTRACT_ID   = process.env.CONTRACT_ID;    // deployed contract address
const MERCHANT_ADDR = process.env.MERCHANT_ADDR;  // your merchant's Stellar address
const WEBHOOK_URL   = process.env.WEBHOOK_URL;    // your backend endpoint
const HORIZON_URL   = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";

// Encode the merchant address as base64 XDR for the topic3 filter
const merchantTopicXdr = Address.fromString(MERCHANT_ADDR).toScVal().toXDR("base64");

// Resume from a saved cursor, or start from now
let cursor = process.env.CURSOR || "now";

// In-memory idempotency store (use Redis/DB in production)
const processed = new Set();

function buildUrl(eventType) {
  const params = new URLSearchParams({
    cursor,
    topic1: "lumenflow",
    topic2: eventType,
    topic3: merchantTopicXdr,
  });
  return `${HORIZON_URL}/contracts/${CONTRACT_ID}/events?${params}`;
}

function connect(eventType) {
  const es = new EventSource(buildUrl(eventType));

  es.addEventListener("message", async (msg) => {
    const event = JSON.parse(msg.data);
    const token = event.paging_token;

    // Idempotency check
    if (processed.has(token)) return;
    processed.add(token);
    cursor = token; // persist so we can resume after restart

    // Decode the data payload
    const rawVal = xdr.ScVal.fromXDR(event.value.xdr, "base64");
    const data   = scValToNative(rawVal);

    // For payment_processed: data = [order_id, payer, amount]
    // merchant_address is in event.topic[2], already filtered by Horizon
    console.log(`[${eventType}] merchant=${MERCHANT_ADDR}`, data);

    try {
      await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event:    eventType,
          merchant: MERCHANT_ADDR,
          data,
          ledger:   event.ledger,
          token,
        }),
      });
    } catch (err) {
      console.error("Webhook delivery failed:", err.message);
    }
  });

  es.addEventListener("error", (err) => {
    console.error(`SSE error (${eventType}), reconnecting in 5s:`, err.message);
    es.close();
    setTimeout(() => connect(eventType), 5000);
  });
}

// Subscribe to all merchant-specific event types
[
  "payment_processed",
  "refund_initiated",
  "refund_approved",
  "refund_rejected",
  "refund_executed",
].forEach(connect);
```

### Running the server

```bash
CONTRACT_ID=<your-contract-id> \
MERCHANT_ADDR=G...YOUR_MERCHANT_ADDRESS \
WEBHOOK_URL=https://your-backend.example.com/lumenflow-events \
node webhook-server.js
```

---

## 4. Idempotency Considerations

Network retries and Horizon reconnections can deliver the same event more than once. Your handler **must** be idempotent.

### Recommended approach

1. **Persist the `paging_token`** of every successfully processed event in a database.
2. Before processing, query the database — if the token already exists, skip the event.
3. Use a database transaction to atomically record the token and apply the business logic.

```js
// Pseudocode
async function handleEvent(event) {
  const token = event.paging_token;
  const alreadyProcessed = await db.events.findOne({ token });
  if (alreadyProcessed) return;

  await db.transaction(async (tx) => {
    await tx.events.insert({ token, processed_at: new Date() });
    await applyBusinessLogic(event, tx);
  });
}
```

### Order IDs as natural idempotency keys

For `payment_processed` events, the `order_id` in the event data is unique per payment. You can use it as a secondary idempotency key in your payments table.

---

## 5. LumenFlow Events Reference

Payment and refund events expose the merchant address as **`topic[2]`** for server-side filtering.

| Event | topic[1] | topic[2] | Data |
|-------|----------|----------|------|
| `payment_processed` | `payment_processed` | `merchant_address` ✦ | `(order_id, payer, amount)` |
| `refund_initiated` | `refund_initiated` | `merchant_address` ✦ | `(refund_id, order_id)` |
| `refund_approved` | `refund_approved` | `merchant_address` ✦ | `(refund_id, order_id)` |
| `refund_rejected` | `refund_rejected` | `merchant_address` ✦ | `(refund_id, order_id)` |
| `refund_executed` | `refund_executed` | `merchant_address` ✦ | `(refund_id, order_id)` |
| `multisig_initiated` | `multisig_initiated` | — | `payment_id` |
| `multisig_executed` | `multisig_executed` | — | `payment_id` |
| `merchant_registered` | `merchant_registered` | — | `merchant_address` |
| `payment_archived` | `payment_archived` | — | `order_id` |
| `contract_paused` | `contract_paused` | — | `()` or `(reason, lock_until)` |
| `contract_unpaused` | `contract_unpaused` | — | `()` or `("multisig_override",)` |

✦ Filterable via `topic3` on Horizon SSE or the `topics[2]` filter in Soroban RPC.

For the full events reference see [events-reference.md](./events-reference.md).

---

## 6. Further Resources

- [Stellar Horizon API — Contract Events](https://developers.stellar.org/docs/data/horizon/api-reference/resources/contract-events)
- [Soroban Events](https://developers.stellar.org/docs/learn/encyclopedia/contract-development/events)
- [Stellar Friendbot (testnet funding)](https://friendbot.stellar.org)

