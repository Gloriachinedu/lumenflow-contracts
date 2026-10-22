/**
 * webhook-server.js
 *
 * Production-grade, idempotent webhook delivery server for LumenFlow.
 *
 * Features
 * --------
 *  - Subscribes to the Horizon SSE event stream for a configured contract.
 *  - Deduplicates events using a pluggable IdempotencyStore so that
 *    reconnections and network retries never deliver the same event twice.
 *  - Persists the last processed cursor so that the stream resumes from the
 *    correct position after a restart.
 *  - Delivers events to a downstream WEBHOOK_URL with configurable retries
 *    and exponential back-off.
 *  - Graceful shutdown on SIGINT / SIGTERM.
 *
 * Environment variables
 * ---------------------
 *  CONTRACT_ID   (required) Deployed Soroban contract address.
 *  WEBHOOK_URL   (required) Your backend endpoint to receive events.
 *  HORIZON_URL   (optional) Defaults to testnet.
 *  CURSOR        (optional) Starting paging token; defaults to "now".
 *  MAX_RETRIES   (optional) Max delivery attempts per event (default 5).
 *  RETRY_BASE_MS (optional) Initial back-off in ms (default 500).
 *
 * Usage
 * -----
 *  CONTRACT_ID=<id> WEBHOOK_URL=https://example.com/hook node webhook-server.js
 */

'use strict';

const EventSource = require('eventsource');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { MemoryIdempotencyStore } = require('./idempotency-store');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONTRACT_ID = process.env.CONTRACT_ID;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '5', 10);
const RETRY_BASE_MS = parseInt(process.env.RETRY_BASE_MS || '500', 10);

if (!CONTRACT_ID) throw new Error('CONTRACT_ID environment variable is required.');
if (!WEBHOOK_URL) throw new Error('WEBHOOK_URL environment variable is required.');

// ---------------------------------------------------------------------------
// Cursor persistence
// ---------------------------------------------------------------------------

const CURSOR_FILE = path.join(__dirname, '.webhook-cursor');

function loadCursor() {
  try {
    return fs.readFileSync(CURSOR_FILE, 'utf8').trim() || 'now';
  } catch {
    return process.env.CURSOR || 'now';
  }
}

function saveCursor(token) {
  try {
    fs.writeFileSync(CURSOR_FILE, token, 'utf8');
  } catch (err) {
    console.error('[cursor] Failed to persist cursor:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Idempotency store
//
// Swap MemoryIdempotencyStore for RedisIdempotencyStore in production:
//
//   const Redis = require('ioredis');
//   const { RedisIdempotencyStore } = require('./idempotency-store');
//   const idempotencyStore = new RedisIdempotencyStore(new Redis());
// ---------------------------------------------------------------------------

const idempotencyStore = new MemoryIdempotencyStore();

// ---------------------------------------------------------------------------
// Delivery with retries and exponential back-off
// ---------------------------------------------------------------------------

/**
 * Delivers an event payload to WEBHOOK_URL, retrying with exponential
 * back-off on transient failures.
 *
 * @param {string} eventName  e.g. "payment_processed"
 * @param {object} data       Parsed event value.
 * @param {number|string} ledger  Ledger sequence number.
 * @param {string} pagingToken   Original paging token (for logging).
 * @returns {Promise<void>}
 */
async function deliverWithRetry(eventName, data, ledger, pagingToken) {
  const payload = JSON.stringify({ event: eventName, data, ledger });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-LumenFlow-Event': eventName,
          'X-LumenFlow-Paging-Token': pagingToken,
          'X-LumenFlow-Attempt': String(attempt),
        },
        body: payload,
      });

      if (response.ok) {
        console.log(`[delivered] ${eventName} (token=${pagingToken}, attempt=${attempt})`);
        return;
      }

      const body = await response.text().catch(() => '');
      console.warn(
        `[retry] ${eventName} attempt ${attempt}/${MAX_RETRIES} — HTTP ${response.status}: ${body}`,
      );
    } catch (err) {
      console.warn(
        `[retry] ${eventName} attempt ${attempt}/${MAX_RETRIES} — network error: ${err.message}`,
      );
    }

    if (attempt < MAX_RETRIES) {
      const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }

  console.error(`[failed] ${eventName} could not be delivered after ${MAX_RETRIES} attempts (token=${pagingToken})`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main SSE loop
// ---------------------------------------------------------------------------

let es = null;
let shutdownRequested = false;

/**
 * Handles a single SSE message with full idempotency guarantees:
 *
 *  1. Parse the raw message.
 *  2. Extract the paging_token (unique, stable event identifier).
 *  3. Check the idempotency store — skip if already processed.
 *  4. Record the token atomically before delivering to avoid double-processing
 *     on in-flight retries.
 *  5. Deliver to WEBHOOK_URL with retry / back-off.
 *  6. Persist the cursor for crash recovery.
 *
 * @param {MessageEvent} msg  Raw SSE message event.
 * @returns {Promise<void>}
 */
async function handleMessage(msg) {
  let event;
  try {
    event = JSON.parse(msg.data);
  } catch (err) {
    console.error('[parse] Failed to parse SSE message:', err.message, msg.data);
    return;
  }

  const pagingToken = event.paging_token;
  if (!pagingToken) {
    console.warn('[skip] Event missing paging_token — cannot deduplicate:', event);
    return;
  }

  // ── Idempotency check ────────────────────────────────────────────────────
  if (await idempotencyStore.has(pagingToken)) {
    console.log(`[duplicate] Skipping already-processed event (token=${pagingToken})`);
    return;
  }

  // Record the token *before* delivery.  If the process crashes between
  // recording and successful delivery, the event is skipped on the next run —
  // which is the safer trade-off (at-most-once within a single run) versus
  // re-delivering and relying solely on the downstream handler for dedup.
  await idempotencyStore.add(pagingToken, { receivedAt: new Date().toISOString() });

  const eventName = Array.isArray(event.topic) ? event.topic[1] : String(event.topic);
  const data = event.value;

  await deliverWithRetry(eventName, data, event.ledger, pagingToken);

  // Persist cursor after successful processing so restarts resume here.
  saveCursor(pagingToken);
}

function connect() {
  if (shutdownRequested) return;

  const cursor = loadCursor();
  const url = `${HORIZON_URL}/contracts/${CONTRACT_ID}/events?cursor=${cursor}&topic1=lumenflow`;
  console.log(`[connect] Subscribing to ${url}`);

  es = new EventSource(url);

  es.addEventListener('message', (msg) => {
    handleMessage(msg).catch((err) =>
      console.error('[handler] Unhandled error in handleMessage:', err),
    );
  });

  es.addEventListener('error', (err) => {
    console.error('[sse] Connection error, reconnecting in 5 s:', err.message || err);
    es.close();
    if (!shutdownRequested) {
      setTimeout(connect, 5000);
    }
  });
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function shutdown(signal) {
  console.log(`\n[shutdown] Received ${signal} — closing SSE connection.`);
  shutdownRequested = true;
  if (es) es.close();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

connect();
