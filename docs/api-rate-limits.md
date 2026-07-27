# API Rate Limiting — Horizon Endpoints

This document describes the rate limits imposed by Stellar Horizon on HTTP requests, explains the 429 Too Many Requests response, and provides concrete guidance on handling backpressure with exponential backoff.

---

## Table of Contents

1. [Overview](#overview)
2. [Horizon Rate Limits](#horizon-rate-limits)
   - [Per-IP Limits (Default Mode)](#per-ip-limits-default-mode)
   - [Streaming Endpoints](#streaming-endpoints)
   - [Authenticated / Per-Account Limits](#authenticated--per-account-limits)
3. [HTTP 429 Too Many Requests](#http-429-too-many-requests)
   - [Response Structure](#response-structure)
   - [Retry-After Header](#retry-after-header)
4. [Exponential Backoff](#exponential-backoff)
   - [Algorithm Description](#algorithm-description)
   - [TypeScript / JavaScript Implementation](#typescript--javascript-implementation)
   - [Fetch Wrapper with Retry](#fetch-wrapper-with-retry)
5. [LumenFlow SDK Built-in Retry Logic](#lumenflow-sdk-built-in-retry-logic)
6. [Best Practices](#best-practices)
7. [Further Reading](#further-reading)

---

## Overview

The LumenFlow SDK and CLI communicate with the Stellar network through two endpoints:

| Endpoint type | Purpose |
|---|---|
| **Soroban RPC** | Read contract state, simulate and submit transactions |
| **Horizon REST API** | Query account balances, transaction history, streaming updates |

Both endpoint types are subject to rate limiting. Horizon enforces its limits at the HTTP layer; Soroban RPC providers may additionally apply their own caps. This document focuses on **Horizon**, which is the most commonly hit limit when integrating off-chain tooling such as webhooks, event pollers, and dashboards.

---

## Horizon Rate Limits

### Per-IP Limits (Default Mode)

Public Horizon instances operated by SDF (Stellar Development Foundation) and most third-party providers apply a default rate limit of:

| Limit type | Value |
|---|---|
| Requests per hour (per IP) | **3 600** |
| Effective average rate | **1 request/second** |

This means that a single IP address may issue at most 3 600 HTTP requests per rolling hour window to endpoints such as:

- `GET /accounts/{account_id}`
- `GET /transactions`
- `GET /operations`
- `GET /effects`
- `GET /payments`
- `GET /fee_stats`
- Any other REST endpoint

> **Note:** The 3 600 requests/hour cap applies to the **SDF public testnet and mainnet Horizon** instances. Self-hosted Horizon deployments can be configured to use different limits or to disable rate limiting entirely (see [Horizon configuration docs](https://developers.stellar.org/docs/data/horizon/horizon-rate-limiting)).

### Streaming Endpoints

Server-Sent Events (SSE) streaming connections — used for real-time updates — have a separate, much higher limit:

| Limit type | Value |
|---|---|
| Maximum concurrent streaming connections per IP | varies by provider |
| Maximum event throughput (SDF public endpoint) | up to **100 events/second** |

Streaming connections hold an open HTTP connection rather than making repeated discrete requests, so they do not count toward the 3 600 req/hour REST limit. However, each new SSE connection does consume a slot; reconnecting very frequently (for example, on every cursor change) can exhaust connection limits.

### Authenticated / Per-Account Limits

Some Horizon providers offer authenticated API access (via an API key or JWT). When authenticated:

- Limits are tracked **per API key / account** rather than per IP.
- Higher quotas are available (exact values depend on the provider's tier).
- Rate limit headers (`X-RateLimit-*`) are typically included on every response.

When using LumenFlow in production with significant traffic, consider obtaining an API key from your Horizon provider or running a self-hosted Horizon instance.

---

## HTTP 429 Too Many Requests

### Response Structure

When a rate limit is exceeded, Horizon responds with:

```
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 60
X-RateLimit-Limit: 3600
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1722000000

{
  "type": "https://stellar.org/horizon-errors/rate_limit_exceeded",
  "title": "Rate Limit Exceeded",
  "status": 429,
  "detail": "The throttling limit for this client has been reached. You must wait before making another request."
}
```

Key response fields:

| Field | Type | Description |
|---|---|---|
| `status` | number | Always `429` for this error |
| `type` | string | Horizon error type URI |
| `title` | string | Human-readable error title |
| `detail` | string | Explanation of the limit hit |

### Retry-After Header

The `Retry-After` header tells clients how many **seconds** to wait before issuing the next request. You must respect this value:

- Do **not** retry immediately after a 429; the server will continue returning 429 until the window resets.
- If `Retry-After` is absent, default to a safe backoff (see the exponential backoff algorithm below).
- A `Retry-After` value of `0` is unusual but valid — it means you can retry immediately.

```typescript
// Reading Retry-After from a fetch Response
const retryAfterSec = parseInt(response.headers.get('Retry-After') ?? '60', 10);
const retryAfterMs = retryAfterSec * 1000;
```

---

## Exponential Backoff

### Algorithm Description

Exponential backoff is the standard approach for handling rate limits and transient errors:

1. On the first failure, wait `baseDelay` milliseconds.
2. On each subsequent failure, double the wait time: `baseDelay × 2^(attempt − 1)`.
3. Cap the wait at `maxDelay` to avoid excessively long pauses.
4. Add a random **jitter** (±20% by default) to prevent thundering-herd problems when many clients are rate-limited simultaneously.
5. If a `Retry-After` header is present, use `max(calculatedBackoff, retryAfterMs)` to honour the server's requested delay.
6. Stop retrying after `maxAttempts` and re-throw the last error.

| Parameter | Default | Description |
|---|---|---|
| `maxAttempts` | 3 | Total number of attempts (first try + retries) |
| `baseDelayMs` | 200 ms | Initial wait period |
| `maxDelayMs` | 5 000 ms | Upper cap on wait period |
| `jitter` | 0.2 | Fraction of the computed delay to randomize (0 = none) |

### TypeScript / JavaScript Implementation

The following is a complete, standalone exponential backoff helper that handles both `Retry-After` headers and generic transient errors.

```typescript
/**
 * Transient HTTP status codes that are safe to retry.
 * 429 = rate limited, 502/503/504 = upstream/gateway errors, 408 = request timeout.
 */
const RETRYABLE_STATUS_CODES = new Set([408, 429, 502, 503, 504]);

interface RetryOptions {
  /** Total attempts, including the first. Default: 4 */
  maxAttempts?: number;
  /** Base delay in ms. Default: 300 */
  baseDelayMs?: number;
  /** Hard cap on delay in ms. Default: 30_000 */
  maxDelayMs?: number;
  /** Jitter fraction 0–1. Default: 0.25 */
  jitter?: number;
}

/** Resolves after `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps a `fetch` call with exponential backoff and Retry-After support.
 *
 * @param url     - Horizon endpoint URL
 * @param init    - Standard fetch RequestInit options
 * @param opts    - Retry policy overrides
 * @returns       Resolved Response on success
 * @throws        The last error when all attempts are exhausted
 *
 * @example
 * const response = await fetchWithBackoff(
 *   'https://horizon-testnet.stellar.org/accounts/G...',
 *   { headers: { Accept: 'application/json' } }
 * );
 * const account = await response.json();
 */
export async function fetchWithBackoff(
  url: string,
  init: RequestInit = {},
  opts: RetryOptions = {}
): Promise<Response> {
  const {
    maxAttempts = 4,
    baseDelayMs = 300,
    maxDelayMs = 30_000,
    jitter = 0.25,
  } = opts;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Response | undefined;

    try {
      response = await fetch(url, init);
    } catch (networkError) {
      // Network-level failure (no connection, DNS failure, etc.)
      lastError = networkError;

      if (attempt === maxAttempts) throw lastError;

      const backoff = computeBackoff(attempt, baseDelayMs, maxDelayMs, jitter);
      console.warn(
        `[LumenFlow] Network error on attempt ${attempt}/${maxAttempts}. Retrying in ${backoff}ms…`,
        networkError
      );
      await sleep(backoff);
      continue;
    }

    // Success — return immediately
    if (response.ok) return response;

    // Non-retryable HTTP error — throw immediately
    if (!RETRYABLE_STATUS_CODES.has(response.status)) {
      throw new HorizonHttpError(response.status, await response.text());
    }

    // Rate-limited or transient server error
    lastError = new HorizonHttpError(response.status, await response.clone().text());

    if (attempt === maxAttempts) throw lastError;

    // Honour Retry-After if the server supplied one
    const retryAfterSec = parseInt(response.headers.get('Retry-After') ?? '', 10);
    const retryAfterMs = Number.isFinite(retryAfterSec) ? retryAfterSec * 1000 : 0;
    const backoff = Math.max(
      computeBackoff(attempt, baseDelayMs, maxDelayMs, jitter),
      retryAfterMs
    );

    console.warn(
      `[LumenFlow] HTTP ${response.status} on attempt ${attempt}/${maxAttempts}. Retrying in ${backoff}ms…`
    );
    await sleep(backoff);
  }

  throw lastError;
}

/**
 * Computes the jittered exponential backoff delay for a given attempt.
 */
function computeBackoff(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitter: number
): number {
  const exponential = baseDelayMs * Math.pow(2, attempt - 1);
  const capped = Math.min(exponential, maxDelayMs);
  const jitterMs = capped * jitter * Math.random();
  return Math.round(capped + jitterMs);
}

/** Typed error for non-2xx Horizon HTTP responses. */
export class HorizonHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string
  ) {
    super(`Horizon responded with HTTP ${status}`);
    this.name = 'HorizonHttpError';
  }

  /** True when this error is a rate-limit response. */
  get isRateLimited(): boolean {
    return this.status === 429;
  }
}
```

### Fetch Wrapper with Retry

A minimal usage pattern integrating with the Horizon accounts endpoint:

```typescript
import { fetchWithBackoff, HorizonHttpError } from './horizonFetch';

async function getAccountInfo(accountId: string): Promise<AccountRecord> {
  const url = `https://horizon-testnet.stellar.org/accounts/${accountId}`;

  try {
    const response = await fetchWithBackoff(url, {}, {
      maxAttempts: 5,
      baseDelayMs: 500,
      maxDelayMs: 60_000,
    });
    return response.json() as Promise<AccountRecord>;
  } catch (err) {
    if (err instanceof HorizonHttpError && err.isRateLimited) {
      console.error('Rate limit hit after all retries — consider reducing request frequency.');
    }
    throw err;
  }
}
```

---

## LumenFlow SDK Built-in Retry Logic

The LumenFlow SDK includes a production-ready retry helper at [`sdk/src/retry.ts`](../sdk/src/retry.ts). It is used automatically for all RPC reads performed through `LumenFlowClient`.

Key characteristics of the SDK retry implementation:

- **Transient detection:** retries on `TypeError` (network failures), HTTP 408, 429, 500, 502, 503, 504 status codes embedded in error messages, and keywords `timeout`, `network`, `econnreset`.
- **Exponential backoff:** base 200 ms, capped at 5 000 ms, 20% jitter by default.
- **Configurable policy:** every client method accepts an optional `RetryConfig` override.
- **Non-retryable errors bypass:** `LumenFlowError` contract errors propagate immediately without retrying.

```typescript
import { LumenFlowClient, NETWORKS } from '@lumenflow/sdk';

const client = new LumenFlowClient({
  contractId: process.env.CONTRACT_ID!,
  ...NETWORKS.testnet,
});

// Override the default retry policy for a specific call
const merchant = await client.getMerchant(address, {
  maxAttempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 15_000,
  jitter: 0.3,
});
```

The `withRetry` function exported from `retry.ts` can also be used directly for custom Horizon queries outside of the SDK client:

```typescript
import { withRetry } from '@lumenflow/sdk/retry';

const stats = await withRetry(
  () => fetch('https://horizon-testnet.stellar.org/fee_stats').then(r => r.json()),
  { maxAttempts: 4, baseDelayMs: 300 }
);
```

---

## Best Practices

### 1. Cache responses where possible

Many Horizon reads (account balances, fee statistics) change slowly. Cache results with a short TTL rather than polling on every user action:

```typescript
const CACHE_TTL_MS = 30_000; // 30 seconds
const cache = new Map<string, { value: unknown; expires: number }>();

async function cachedGet<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value as T;
  const value = await fetcher();
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}
```

### 2. Use streaming for real-time data

Instead of polling Horizon every second, subscribe to an SSE stream:

```typescript
// Server-Sent Events stream — does not count toward the 3 600 req/hour REST cap
const stream = new EventSource(
  'https://horizon-testnet.stellar.org/payments?cursor=now&order=asc'
);
stream.onmessage = (event) => {
  const payment = JSON.parse(event.data);
  // handle payment
};
```

### 3. Batch queries

Where possible, reduce the number of HTTP requests by fetching paginated results with a high `limit` (up to 200 records per page on Horizon) rather than one-at-a-time:

```bash
GET /payments?account=G...&limit=200&order=desc
```

### 4. Spread requests over time

If your integration processes many accounts in a background job, add deliberate pacing:

```typescript
async function processAccounts(accounts: string[]) {
  for (const account of accounts) {
    await processOne(account);
    await sleep(300); // ~3 req/s leaves comfortable headroom under 3600 req/hr
  }
}
```

### 5. Respect 429s in CI / test suites

Integration tests that exercise Horizon directly should include retry logic or mock the Horizon layer to avoid flaky failures caused by rate limits in shared CI environments.

### 6. Run your own Horizon for high-volume workloads

If your application regularly exceeds ~1 request/second sustained, consider:

- Self-hosting a Horizon instance (see [Running Horizon](https://developers.stellar.org/docs/data/horizon/admin-guide/installing))
- Using a Horizon-as-a-service provider with dedicated rate limits
- Using the Stellar Data Indexer (SDI) for bulk historical queries

### 7. Monitor rate limit headers

Log `X-RateLimit-Remaining` and `X-RateLimit-Reset` in development to understand how close to the limit your application operates:

```typescript
const response = await fetch(url);
const remaining = response.headers.get('X-RateLimit-Remaining');
const reset = response.headers.get('X-RateLimit-Reset');
if (remaining !== null && parseInt(remaining, 10) < 100) {
  console.warn(`[LumenFlow] Rate limit low — ${remaining} requests remaining, resets at ${reset}`);
}
```

---

## Further Reading

- [Horizon API Reference](https://developers.stellar.org/docs/data/horizon) — official Horizon API documentation
- [Horizon Rate Limiting](https://developers.stellar.org/docs/data/horizon/horizon-rate-limiting) — detailed explanation of Horizon's rate limiting configuration and customization
- [Running Horizon](https://developers.stellar.org/docs/data/horizon/admin-guide/installing) — self-hosting guide
- [Stellar Data Indexer](https://developers.stellar.org/docs/data/indexer) — high-throughput alternative for historical queries
- [LumenFlow Monitoring Guide](monitoring.md) — Horizon SSE streaming, alert thresholds, and example code
- [LumenFlow Webhook Integration](webhook-integration.md) — off-chain event notification patterns
- [LumenFlow SDK `src/retry.ts`](../sdk/src/retry.ts) — built-in retry implementation
