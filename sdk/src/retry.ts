/**
 * Retry / exponential-backoff helper for read-only Soroban RPC calls.
 *
 * Only transient errors (network failures, HTTP 429/503/504) are retried.
 * Business-logic errors (e.g. LumenFlowError) propagate immediately.
 *
 * ## HTTP 429 — Rate Limit Handling
 *
 * When a 429 Too Many Requests response is detected the retry logic:
 *  1. Reads the `Retry-After` header value (seconds) if present.
 *  2. Waits exactly that duration before the next attempt.
 *  3. Falls back to exponential back-off when `Retry-After` is absent or
 *     cannot be parsed.
 *
 * This ensures the SDK respects the server's rate-limit window rather than
 * hammering it with requests during a back-off period.
 */

export interface RetryConfig {
  /** Maximum number of attempts (including the first). Default: 3 */
  maxAttempts?: number;
  /** Maximum number of retries after the first attempt. Default: maxAttempts - 1 */
  maxRetries?: number;
  /** Base delay in milliseconds. Default: 200 */
  baseDelayMs?: number;
  /** Maximum delay cap in milliseconds. Default: 5000 */
  maxDelayMs?: number;
  /** Fixed jitter in milliseconds added to each computed delay. Default: 40 */
  jitterMs?: number;
  /** Jitter factor 0–1 applied to each delay (legacy, overridden by jitterMs). Default: 0.2 */
  jitter?: number;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/** Thrown when all retry attempts have been exhausted. */
export class RetryExhaustedError extends Error {
  /** Number of retry attempts made (not counting the first attempt). */
  readonly retryCount: number;
  /** The last error that caused the final attempt to fail. */
  readonly lastError: unknown;

  constructor(retryCount: number, lastError: unknown) {
    const msg =
      lastError instanceof Error
        ? lastError.message
        : String(lastError);
    super(`${retryCount} retry attempts exhausted: ${msg}`);
    this.name = 'RetryExhaustedError';
    this.retryCount = retryCount;
    this.lastError = lastError;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** HTTP status codes that indicate a transient server-side error. */
const TRANSIENT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Returns true for errors that are safe to retry.
 *
 * An error is retryable when:
 *  - It has a `status` property whose value is in TRANSIENT_STATUS_CODES, or
 *  - It is a network-level error with no `status` property (e.g. ECONNRESET,
 *    timeout, TypeError from fetch).
 */
export function isRetryable(err: unknown): boolean {
  if (err !== null && typeof err === 'object' && 'status' in err) {
    return TRANSIENT_STATUS_CODES.has((err as { status: number }).status);
  }
  // Network-level errors (no status property) are always retryable
  return true;
}

/**
 * Extracts the `Retry-After` delay (in milliseconds) from an error that
 * represents an HTTP 429 response.
 *
 * The error object may carry the header value under:
 *  - `err.retryAfter`  (number, seconds)
 *  - `err.headers['retry-after']` (string, seconds)
 *  - `err.headers['Retry-After']` (string, seconds)
 *
 * Returns `null` when the error is not a 429 or no usable header is found.
 *
 * @param err  The thrown error / rejection value.
 * @returns    Delay in **milliseconds**, or `null`.
 */
export function getRetryAfterMs(err: unknown): number | null {
  if (err === null || typeof err !== 'object') return null;
  const e = err as Record<string, unknown>;

  if (e['status'] !== 429) return null;

  // Direct numeric property (set by some SDK wrappers)
  if (typeof e['retryAfter'] === 'number' && e['retryAfter'] > 0) {
    return e['retryAfter'] * 1000;
  }

  // Headers object (fetch Response-style)
  const headers = e['headers'];
  if (headers !== null && typeof headers === 'object') {
    const h = headers as Record<string, unknown>;
    const raw =
      typeof h['retry-after'] === 'string'
        ? h['retry-after']
        : typeof h['Retry-After'] === 'string'
        ? h['Retry-After']
        : null;

    if (raw !== null) {
      const parsed = parseFloat(raw);
      if (!isNaN(parsed) && parsed > 0) return parsed * 1000;
    }
  }

  return null;
}

/**
 * Calculates the delay for a given retry attempt using exponential back-off
 * with an optional fixed jitter.
 *
 * Formula: `min(baseDelayMs * 2^attempt, maxDelayMs) + jitterMs`
 *
 * @param attempt     Zero-based retry index (0 = first retry).
 * @param baseDelayMs Base delay in milliseconds.
 * @param maxDelayMs  Hard cap on the computed delay (before jitter).
 * @param jitterMs    Fixed number of milliseconds of jitter to add.
 * @returns           Computed delay in milliseconds.
 */
export function calculateDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterMs: number
): number {
  const exponential = baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, maxDelayMs);
  return capped + jitterMs * Math.random();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Runs `fn` with exponential back-off, retrying only on transient errors.
 *
 * When a 429 Too Many Requests error is encountered the function first
 * checks for a `Retry-After` header and honours it before falling back to
 * the standard exponential back-off schedule.
 *
 * @param fn         - Async factory for the read operation.
 * @param retryOpts  - Optional retry policy overrides.
 * @throws {RetryExhaustedError} when all retry attempts are exhausted.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retryOpts: RetryConfig = {}
): Promise<T> {
  const {
    maxAttempts,
    maxRetries,
    baseDelayMs = 200,
    maxDelayMs = 5000,
    jitterMs,
    jitter = 0.2,
  } = retryOpts;

  // Resolve effective limits: support both maxAttempts and maxRetries APIs
  const effectiveMaxRetries =
    maxRetries !== undefined
      ? maxRetries
      : maxAttempts !== undefined
      ? maxAttempts - 1
      : 2; // default: 2 retries (3 total attempts)

  // Resolve jitter: prefer explicit jitterMs, fall back to jitter factor
  const effectiveJitterMs =
    jitterMs !== undefined ? jitterMs : baseDelayMs * jitter;

  let lastError: unknown;
  let retriesMade = 0;

  for (let attempt = 0; attempt <= effectiveMaxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      const isLast = attempt === effectiveMaxRetries;
      if (isLast || !isRetryable(err)) {
        // Non-retryable errors bubble up immediately; exhausted retries throw
        // RetryExhaustedError only when at least one retry was attempted.
        if (isLast && retriesMade > 0) {
          throw new RetryExhaustedError(retriesMade, err);
        }
        throw err;
      }

      // ── 429 with Retry-After ──────────────────────────────────────────────
      const retryAfterMs = getRetryAfterMs(err);
      if (retryAfterMs !== null) {
        await sleep(retryAfterMs);
      } else {
        // Standard exponential back-off
        const delayMs = calculateDelay(
          attempt,
          baseDelayMs,
          maxDelayMs,
          effectiveJitterMs
        );
        await sleep(Math.round(delayMs));
      }

      retriesMade++;
    }
  }

  throw lastError;
}
