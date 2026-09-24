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

## 3. Example Node.js Webhook Server

The following example uses the `eventsource` package to consume the SSE stream and forward events to your webhook endpoint.

Incoming requests are verified against the `X-Stellar-Signature` header using the Horizon public key and the raw request body. Requests with an invalid or missing signature are rejected with HTTP 401. See [docs/webhook-security.md](./webhook-security.md) for a detailed explanation of the verification algorithm.

### Install dependencies

```bash
npm install eventsource node-fetch tweetnacl
```

A `WEBHOOK_SECRET` environment variable holding the Horizon ed25519 public key (hex-encoded, 32 bytes) is **required**. The server will not start without it.

### `webhook-server.js`

```js
const EventSource = require("eventsource");
const fetch = require("node-fetch");
const http = require("http");
const nacl = require("tweetnacl");

// ── Required environment variables ──────────────────────────────────────────
const CONTRACT_ID = process.env.CONTRACT_ID;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET; // Horizon ed25519 public key, hex-encoded (32 bytes)
const HORIZON_URL =
  process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";

if (!CONTRACT_ID) throw new Error("CONTRACT_ID environment variable is required");
if (!WEBHOOK_URL) throw new Error("WEBHOOK_URL environment variable is required");
if (!WEBHOOK_SECRET) throw new Error("WEBHOOK_SECRET environment variable is required (Horizon ed25519 public key, hex)");

// Decode the public key once at startup
const PUBLIC_KEY = Buffer.from(WEBHOOK_SECRET, "hex");
if (PUBLIC_KEY.length !== 32) {
  throw new Error("WEBHOOK_SECRET must be a 32-byte ed25519 public key encoded as hex");
}

// ── Signature verification ───────────────────────────────────────────────────

/**
 * Verifies the X-Stellar-Signature header against the raw request body.
 *
 * @param {Buffer} rawBody  - Raw (unparsed) request body bytes
 * @param {string} sigHeader - Value of the X-Stellar-Signature header
 * @returns {boolean} true if the signature is valid
 */
function verifySignature(rawBody, sigHeader) {
  if (!sigHeader) return false;
  let sigBytes;
  try {
    sigBytes = Buffer.from(sigHeader, "hex");
  } catch {
    return false;
  }
  if (sigBytes.length !== 64) return false;
  return nacl.sign.detached.verify(
    new Uint8Array(rawBody),
    new Uint8Array(sigBytes),
    new Uint8Array(PUBLIC_KEY)
  );
}

// ── HTTP receiver ────────────────────────────────────────────────────────────
// Listens for forwarded Horizon events posted by a proxy / relay service.

const PORT = process.env.PORT || 3001;

const server = http.createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405).end("Method Not Allowed");
    return;
  }

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", async () => {
    const rawBody = Buffer.concat(chunks);
    const sigHeader = req.headers["x-stellar-signature"];

    if (!verifySignature(rawBody, sigHeader)) {
      console.warn("Rejected request: invalid or missing X-Stellar-Signature");
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid signature" }));
      return;
    }

    let event;
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch {
      res.writeHead(400).end("Bad Request");
      return;
    }

    await handleEvent(event);
    res.writeHead(200).end("OK");
  });
});

server.listen(PORT, () => {
  console.log(`Webhook receiver listening on port ${PORT}`);
});

// ── Horizon SSE consumer ─────────────────────────────────────────────────────

// Resume from a saved cursor, or start from now
let cursor = process.env.CURSOR || "now";

// In-memory idempotency store (use Redis/DB in production)
const processed = new Set();

function connect() {
  const url = `${HORIZON_URL}/contracts/${CONTRACT_ID}/events?cursor=${cursor}&topic1=lumenflow`;
  const es = new EventSource(url);

  es.addEventListener("message", async (msg) => {
    const event = JSON.parse(msg.data);
    const token = event.paging_token;

    // Idempotency check
    if (processed.has(token)) return;
    processed.add(token);

    // Persist cursor so we can resume after restart
    cursor = token;

    await handleEvent(event);
  });

  es.addEventListener("error", (err) => {
    console.error("SSE error, reconnecting in 5s:", err.message);
    es.close();
    setTimeout(connect, 5000);
  });
}

// ── Shared event handler ─────────────────────────────────────────────────────

async function handleEvent(event) {
  const eventName = event.topic ? event.topic[1] : event.event;
  const data = event.value ?? event.data;

  console.log(`[${eventName}]`, data);

  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: eventName, data, ledger: event.ledger }),
    });
  } catch (err) {
    console.error("Webhook delivery failed:", err.message);
    // Implement retry logic here (exponential back-off recommended)
  }
}

connect();
```

### Running the server

```bash
CONTRACT_ID=<your-contract-id> \
WEBHOOK_URL=https://your-backend.example.com/lumenflow-events \
WEBHOOK_SECRET=<horizon-ed25519-public-key-hex> \
node webhook-server.js
```

> **Security note:** Never commit `WEBHOOK_SECRET` to source control. Store it as an environment variable or in your secrets manager. See [docs/secrets-and-local-env.md](./secrets-and-local-env.md) for guidance.

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

| Event | Trigger | Key data |
|-------|---------|----------|
| `payment_processed` | Payment completed | `order_id`, `payer`, `merchant`, `amount` |
| `refund_initiated` | Refund request opened | `refund_id` |
| `refund_approved` | Refund approved | `refund_id` |
| `refund_rejected` | Refund rejected | `refund_id` |
| `refund_executed` | Refund transfer completed | `refund_id` |
| `refund_disputed` | Dispute raised on a refund | `refund_id`, `payer` |
| `dispute_resolved` | Admin resolved a dispute | `refund_id`, `outcome` |
| `payment_note_added` | Merchant added a note to a payment | `order_id` |
| `multisig_initiated` | Multisig payment created | `payment_id` |
| `multisig_executed` | Multisig payment executed | `payment_id` |
| `merchant_registered` | New merchant registered | `merchant_address` |
| `payment_archived` | Payment record removed | `order_id` |

For the full events reference see [events-reference.md](./events-reference.md).

---

## 6. Further Resources

- [Stellar Horizon API — Contract Events](https://developers.stellar.org/docs/data/horizon/api-reference/resources/contract-events)
- [Soroban Events](https://developers.stellar.org/docs/learn/encyclopedia/contract-development/events)
- [Stellar Friendbot (testnet funding)](https://friendbot.stellar.org)
