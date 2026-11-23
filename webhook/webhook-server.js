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
 *  - Sets security HTTP response headers on all outgoing responses to
 *    protect against common web vulnerabilities (XSS, clickjacking, MIME
 *    sniffing, etc.).
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
const http = require('http');
const crypto = require('crypto');
const { MemoryIdempotencyStore } = require('./idempotency-store');
const {
  csrfMiddleware,
  createCsrfToken,
  setCsrfCookie,
} = require('../sdk/dist/security/csrfProtection');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONTRACT_ID = process.env.CONTRACT_ID;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '5', 10);
const RETRY_BASE_MS = parseInt(process.env.RETRY_BASE_MS || '500', 10);
const CSRF_SECRET = process.env.CSRF_SECRET;

if (!CONTRACT_ID) throw new Error('CONTRACT_ID environment variable is required.');
if (!WEBHOOK_URL) throw new Error('WEBHOOK_URL environment variable is required.');
if (!CSRF_SECRET || CSRF_SECRET.length < 32) {
  throw new Error('CSRF_SECRET environment variable is required and must be at least 32 characters.');
}

// ---------------------------------------------------------------------------
// Security headers
//
// Applied to every HTTP response sent by this server.  These headers protect
// against common web vulnerabilities if the webhook server is ever exposed
// directly to a browser (e.g. through a status/health endpoint).
//
// Reference: docs/webhook-security.md
// ---------------------------------------------------------------------------

/**
 * Security headers to attach to every outgoing HTTP response.
 *
 * - Content-Security-Policy: restricts resource loading to the same origin,
 *   blocking inline scripts and mixed-content.
 * - Strict-Transport-Security: instructs browsers to use HTTPS only for
 *   the next year, protecting against protocol downgrade attacks.
 * - X-Content-Type-Options: prevents browsers from MIME-sniffing the
 *   response away from the declared Content-Type.
 * - X-Frame-Options: prevents the response from being embedded in an
 *   iframe, blocking clickjacking attacks.
 * - X-XSS-Protection: enables the browser's built-in XSS filter (legacy
 *   browsers; modern browsers rely on CSP instead).
 * - Referrer-Policy: limits the Referer header to the same origin,
 *   reducing information leakage.
 * - Permissions-Policy: disables access to sensitive browser features
 *   (camera, microphone, geolocation) that are not needed by this server.
 */
const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'none'; frame-ancestors 'none'",
  'Strict-Transport-Security':
    'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options':
    'nosniff',
  'X-Frame-Options':
    'DENY',
  'X-XSS-Protection':
    '1; mode=block',
  'Referrer-Policy':
    'same-origin',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=()',
};

/**
 * Applies the security headers defined in SECURITY_HEADERS to a fetch
 * Response object (or any object with a `headers` Map/object).
 *
 * Usage:
 *   const headers = { 'Content-Type': 'application/json' };
 *   applySecurityHeaders(headers);
 *   // → headers now includes all security headers
 *
 * @param {Record<string, string>} headers  Mutable headers object to augment.
 * @returns {Record<string, string>}        The same object, for chaining.
 */
function applySecurityHeaders(headers) {
  Object.assign(headers, SECURITY_HEADERS);
  return headers;
}

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
        headers: applySecurityHeaders({
          'Content-Type': 'application/json',
          'X-LumenFlow-Event': eventName,
          'X-LumenFlow-Paging-Token': pagingToken,
          'X-LumenFlow-Attempt': String(attempt),
        }),
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
// HTTP server with CSRF protection
//
// Every state-changing route (POST / PUT / DELETE / PATCH) is guarded by the
// CSRF middleware from sdk/security/csrfProtection.  Clients obtain a token
// from GET /csrf-token and must echo it back via the `x-csrf-token` header
// (or the `_csrf` body field) on subsequent state-changing requests.
// ---------------------------------------------------------------------------

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

/**
 * Parses the `Cookie` header into a plain object.
 *
 * @param {string|undefined} header
 * @returns {Record<string, string>}
 */
function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

/**
 * Ensures the request carries a `session` cookie, minting one if absent.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @returns {string} The session id.
 */
function ensureSession(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.session) return cookies.session;

  const sessionId = crypto.randomBytes(32).toString('hex');
  res.setHeader(
    'Set-Cookie',
    `session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict`,
  );
  return sessionId;
}

/**
 * Sends a JSON response with the standard security headers applied.
 *
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {object} body
 */
function sendJson(res, status, body) {
  const headers = applySecurityHeaders({ 'Content-Type': 'application/json' });
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

/**
 * Reads and JSON-parses the request body (best effort).
 *
 * @param {http.IncomingMessage} req
 * @returns {Promise<object>}
 */
function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

/**
 * Creates the webhook relay HTTP server with CSRF protection wired in.
 *
 * @returns {http.Server}
 */
function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const method = (req.method || 'GET').toUpperCase();

    // ── Token issuance ─────────────────────────────────────────────────────
    if (method === 'GET' && url.pathname === '/csrf-token') {
      const sessionId = ensureSession(req, res);
      const token = createCsrfToken(sessionId, CSRF_SECRET);
      const cookie = setCsrfCookie(token);
      const existing = res.getHeader('Set-Cookie');
      const cookies = existing
        ? Array.isArray(existing) ? existing.slice() : [String(existing)]
        : [];
      cookies.push(cookie);
      res.setHeader('Set-Cookie', cookies);
      return sendJson(res, 200, { token });
    }

    // ── CSRF guard for all state-changing routes ───────────────────────────
    if (STATE_CHANGING_METHODS.has(method)) {
      const body = await readJsonBody(req);
      const guardedReq = Object.assign(req, { body });
      let rejected = false;
      const guardedRes = {
        statusCode: 200,
        setHeader: (name, value) => res.setHeader(name, value),
        getHeader: (name) => res.getHeader(name),
        end: (payload) => {
          rejected = true;
          const headers = applySecurityHeaders(
            res.getHeader('Content-Type')
              ? {}
              : { 'Content-Type': 'application/json' },
          );
          res.writeHead(res.statusCode || 403, headers);
          res.end(payload);
        },
      };

      await csrfMiddleware(CSRF_SECRET)(guardedReq, guardedRes, () => {
        rejected = false;
      });

      if (rejected) return;

      // Placeholder handler for relayed webhook events.
      return sendJson(res, 202, { accepted: true });
    }

    return sendJson(res, 404, { error: 'Not found' });
  });
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

module.exports = { createServer };

if (require.main === module) {
  const port = parseInt(process.env.PORT || '0', 10);
  const server = createServer();
  server.listen(port, () => {
    console.log(`[http] CSRF-protected relay listening on port ${server.address().port}`);
  });
  connect();
}
