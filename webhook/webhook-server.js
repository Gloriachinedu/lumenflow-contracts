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

// ---------------------------------------------------------------------------
// Distributed tracing (OpenTelemetry)
//
// Must be required and started before any other module so that the SDK can
// patch instrumented libraries (http, node-fetch, etc.) at load time.
// ---------------------------------------------------------------------------

const { startTracing, shutdownTracing, trace, propagation, SpanStatusCode } = require('./tracing');

startTracing('webhook-relay');

const EventSource = require('eventsource');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
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

// Shared secret used to verify inbound webhook signatures.  Must be supplied
// via the environment — never hard-coded.
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

// Replay protection: reject signatures whose timestamp is outside this window.
const SIGNATURE_TOLERANCE_MS = parseInt(
  process.env.SIGNATURE_TOLERANCE_MS || '300000',
  10,
);

// Per-merchant outbound delivery rate limit.
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '100', 10);
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);

if (!CONTRACT_ID) throw new Error('CONTRACT_ID environment variable is required.');
if (!WEBHOOK_URL) throw new Error('WEBHOOK_URL environment variable is required.');
if (!WEBHOOK_SECRET) throw new Error('WEBHOOK_SECRET environment variable is required.');

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
// Inbound HMAC-SHA256 signature verification
//
// Every inbound webhook delivery must carry an `X-LumenFlow-Signature` header
// of the form `t=<unix-ms>,v1=<hex-hmac>`, where the HMAC is computed over
// `<t>.<raw-body>` using the shared WEBHOOK_SECRET.  Verification is
// timing-safe and includes a replay guard.
// ---------------------------------------------------------------------------

/**
 * Computes the expected HMAC-SHA256 signature over `<timestamp>.<rawBody>`.
 *
 * @param {string|Buffer} rawBody    Raw request body (before JSON parsing).
 * @param {string|number} timestamp  Unix timestamp in milliseconds.
 * @param {string} [secret]          Shared secret (defaults to WEBHOOK_SECRET).
 * @returns {string}                 Lower-case hex digest.
 */
function computeSignature(rawBody, timestamp, secret = WEBHOOK_SECRET) {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
  const signedPayload = Buffer.concat([
    Buffer.from(`${timestamp}.`, 'utf8'),
    body,
  ]);
  return crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
}

/**
 * Parses an `X-LumenFlow-Signature` header value into its components.
 *
 * @param {string} header  e.g. "t=1700000000000,v1=abc123..."
 * @returns {{timestamp: number, signature: string}|null}
 */
function parseSignatureHeader(header) {
  if (typeof header !== 'string' || header.length === 0) return null;
  const parts = {};
  for (const segment of header.split(',')) {
    const idx = segment.indexOf('=');
    if (idx === -1) continue;
    const key = segment.slice(0, idx).trim();
    const value = segment.slice(idx + 1).trim();
    if (key) parts[key] = value;
  }
  if (!parts.t || !parts.v1) return null;
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp)) return null;
  return { timestamp, signature: parts.v1 };
}

// Bounded set of recently-seen signatures to reject exact replays.
const seenSignatures = new Map();
const SEEN_SIGNATURE_TTL_MS = SIGNATURE_TOLERANCE_MS * 2;

function pruneSeenSignatures(now) {
  for (const [sig, seenAt] of seenSignatures) {
    if (now - seenAt > SEEN_SIGNATURE_TTL_MS) seenSignatures.delete(sig);
  }
}

/**
 * Verifies an inbound webhook request.
 *
 * @param {string|undefined} signatureHeader  Value of X-LumenFlow-Signature.
 * @param {string|Buffer} rawBody             Raw request body.
 * @param {number} [now]                      Current time in ms (for tests).
 * @returns {{ok: true}|{ok: false, status: number, reason: string}}
 */
function verifyWebhookSignature(signatureHeader, rawBody, now = Date.now()) {
  if (!signatureHeader) {
    return { ok: false, status: 401, reason: 'missing signature header' };
  }

  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) {
    return { ok: false, status: 401, reason: 'malformed signature header' };
  }

  // Replay guard: timestamp must be within the tolerance window.
  if (Math.abs(now - parsed.timestamp) > SIGNATURE_TOLERANCE_MS) {
    return { ok: false, status: 401, reason: 'signature timestamp outside tolerance' };
  }

  const expected = computeSignature(rawBody, parsed.timestamp);
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(parsed.signature, 'utf8');

  // Length check first — timingSafeEqual throws on mismatched lengths.
  if (expectedBuf.length !== providedBuf.length) {
    return { ok: false, status: 401, reason: 'signature mismatch' };
  }
  if (!crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    return { ok: false, status: 401, reason: 'signature mismatch' };
  }

  // Replay guard: reject an exact signature we have already accepted.
  pruneSeenSignatures(now);
  if (seenSignatures.has(parsed.signature)) {
    return { ok: false, status: 401, reason: 'replayed signature' };
  }
  seenSignatures.set(parsed.signature, now);

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Per-merchant outbound rate limiting
//
// At most RATE_LIMIT_MAX deliveries per merchant per RATE_LIMIT_WINDOW_MS.
// Deliveries that exceed the limit are queued (never dropped) and drained as
// the window resets.
// ---------------------------------------------------------------------------

class MerchantRateLimiter {
  constructor(max, windowMs) {
    this.max = max;
    this.windowMs = windowMs;
    this.buckets = new Map(); // merchantId -> { count, windowStart }
    this.queues = new Map();  // merchantId -> Array<() => void>
    this.timers = new Map();  // merchantId -> Timeout
  }

  _bucket(merchantId, now) {
    let bucket = this.buckets.get(merchantId);
    if (!bucket || now - bucket.windowStart >= this.windowMs) {
      bucket = { count: 0, windowStart: now };
      this.buckets.set(merchantId, bucket);
    }
    return bucket;
  }

  /**
   * Resolves when the caller is allowed to perform a delivery for the given
   * merchant.  If the limit is exceeded the caller is queued and resolved
   * once the window resets.
   *
   * @param {string} merchantId
   * @returns {Promise<void>}
   */
  acquire(merchantId) {
    const now = Date.now();
    const bucket = this._bucket(merchantId, now);

    if (bucket.count < this.max) {
      bucket.count += 1;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let queue = this.queues.get(merchantId);
      if (!queue) {
        queue = [];
        this.queues.set(merchantId, queue);
      }
      queue.push(resolve);
      this._scheduleDrain(merchantId);
    });
  }

  _scheduleDrain(merchantId) {
    if (this.timers.has(merchantId)) return;
    const bucket = this.buckets.get(merchantId);
    const now = Date.now();
    const delay = bucket
      ? Math.max(0, bucket.windowStart + this.windowMs - now)
      : this.windowMs;

    const timer = setTimeout(() => {
      this.timers.delete(merchantId);
      this._drain(merchantId);
    }, delay);
    if (typeof timer.unref === 'function') timer.unref();
    this.timers.set(merchantId, timer);
  }

  _drain(merchantId) {
    const queue = this.queues.get(merchantId);
    if (!queue || queue.length === 0) {
      this.queues.delete(merchantId);
      return;
    }

    const now = Date.now();
    const bucket = this._bucket(merchantId, now);

    while (queue.length > 0 && bucket.count < this.max) {
      bucket.count += 1;
      const resolve = queue.shift();
      resolve();
    }

    if (queue.length > 0) {
      this._scheduleDrain(merchantId);
    } else {
      this.queues.delete(merchantId);
    }
  }
}

const deliveryRateLimiter = new MerchantRateLimiter(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);

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
// Keys are persisted durably in Redis (TTL = idempotency window) so that a
// server restart does not clear deduplication state.  MemoryIdempotencyStore
// is used only as a local-dev fallback when REDIS_URL is not configured.
// ---------------------------------------------------------------------------

const REDIS_URL = process.env.REDIS_URL;
const IDEMPOTENCY_TTL_SECONDS = parseInt(process.env.IDEMPOTENCY_TTL_SECONDS || '86400', 10);

let redisClient = null;
let idempotencyStore;

if (REDIS_URL) {
  const Redis = require('ioredis');
  redisClient = new Redis(REDIS_URL);
  redisClient.on('error', (err) => {
    console.error('[redis] Connection error:', err.message);
  });
  idempotencyStore = new RedisIdempotencyStore(redisClient, {
    ttlSeconds: IDEMPOTENCY_TTL_SECONDS,
  });
  console.log(`[idempotency] Using Redis store (ttl=${IDEMPOTENCY_TTL_SECONDS}s)`);
} else {
  idempotencyStore = new MemoryIdempotencyStore();
  console.warn('[idempotency] REDIS_URL not set — using in-memory store (local dev only)');
}

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
async function deliverWithRetry(eventName, data, ledger, pagingToken, merchantId) {
  const payload = JSON.stringify({ event: eventName, data, ledger });
  const rateLimitKey = merchantId || 'default';

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // Apply per-merchant rate limiting before each outbound attempt.  If the
    // limit is exceeded this awaits until the window resets (queued, not
    // dropped).
    await deliveryRateLimiter.acquire(rateLimitKey);

    try {
      // Propagate W3C trace context to the downstream webhook receiver.
      const traceHeaders = {};
      propagation.inject(trace.setSpan(trace.context.active(), span), traceHeaders);

      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: applySecurityHeaders({
          ...traceHeaders,
          'Content-Type': 'application/json',
          'X-LumenFlow-Event': eventName,
          'X-LumenFlow-Paging-Token': pagingToken,
          'X-LumenFlow-Attempt': String(attempt),
        }),
        body: payload,
      });

      span.setAttribute('http.status_code', response.status);

      if (response.ok) {
        span.setStatus({ code: SpanStatusCode.OK });
        console.log(`[delivered] ${eventName} (token=${pagingToken}, attempt=${attempt})`);
        return;
      }

      const body = await response.text().catch(() => '');
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: `HTTP ${response.status}`,
      });
      console.warn(
        `[retry] ${eventName} attempt ${attempt}/${MAX_RETRIES} — HTTP ${response.status}: ${body}`,
      );
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      console.warn(
        `[retry] ${eventName} attempt ${attempt}/${MAX_RETRIES} — network error: ${err.message}`,
      );
    } finally {
      span.end();
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
 *  3. Atomically claim the token in the idempotency store.  If the token is
 *     already present, return the previously stored response instead of
 *     re-delivering (duplicate within window) — a token whose TTL has expired
 *     is treated as a brand-new request.
 *  4. Deliver to WEBHOOK_URL with retry / back-off.
 *  5. Store the delivery response alongside the token for duplicate replays.
 *  6. Persist the cursor for crash recovery.
 *
 * @param {MessageEvent} msg  Raw SSE message event.
 * @returns {Promise<void>}
 */
async function handleMessage(msg) {
  const span = trace.getTracer('webhook-relay').startSpan('webhook.handleMessage', {
    kind: trace.SpanKind.SERVER,
    attributes: {
      'messaging.system': 'horizon-sse',
      'messaging.operation': 'process',
    },
  });

  try {
    let event;
    try {
      event = JSON.parse(msg.data);
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      console.error('[parse] Failed to parse SSE message:', err.message, msg.data);
      return;
    }

    const pagingToken = event.paging_token;
    if (!pagingToken) {
      console.warn('[skip] Event missing paging_token — cannot deduplicate:', event);
      return;
    }

  // ── Idempotency check ────────────────────────────────────────────────────
  // Atomically claim the token before delivery.  If it is already claimed
  // (duplicate within the idempotency window), replay the stored response
  // rather than re-delivering or raising an error.  An expired key is gone
  // from the store, so the same token is treated as a new request.
  const claimed = await idempotencyStore.add(pagingToken, {
    receivedAt: new Date().toISOString(),
    status: 'in_progress',
  });

  if (!claimed) {
    const previous = await idempotencyStore.get(pagingToken);
    console.log(
      `[duplicate] Returning stored response for token=${pagingToken}`,
      previous ? JSON.stringify(previous) : '(no stored response)',
    );
    return previous;
  }

  const eventName = Array.isArray(event.topic) ? event.topic[1] : String(event.topic);
  const data = event.value;
  const merchantId = event.merchant_id || event.merchantId || data && data.merchant_id;

  await deliverWithRetry(eventName, data, event.ledger, pagingToken, merchantId);

  // Persist the delivery response so duplicates within the window can replay it.
  await idempotencyStore.add(pagingToken, {
    receivedAt: new Date().toISOString(),
    status: 'delivered',
    event: eventName,
    ledger: event.ledger,
  });

    // Persist cursor after successful processing so restarts resume here.
    saveCursor(pagingToken);
  } catch (err) {
    span.recordException(err);
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    throw err;
  } finally {
    span.end();
  }
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
  if (redisClient) {
    redisClient.quit().catch(() => {});
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ---------------------------------------------------------------------------
// Exports (for testing)
// ---------------------------------------------------------------------------

module.exports = {
  computeSignature,
  parseSignatureHeader,
  verifyWebhookSignature,
  MerchantRateLimiter,
  deliveryRateLimiter,
  deliverWithRetry,
  applySecurityHeaders,
  SECURITY_HEADERS,
};

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

if (require.main === module) {
  connect();
}
