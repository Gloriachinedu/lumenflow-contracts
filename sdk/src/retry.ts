/**
 * Retry / exponential-backoff helper for read-only Soroban RPC calls.
 *
 * Only transient errors (network failures, HTTP 429/503/504) are retried.
 * Business-logic errors (e.g. LumenFlowError) propagate immediately.
 */

export interface RetryConfig {
  /** Maximum number of attempts (including the first). Default: 3 */
  maxAttempts?: number;
  /** Base delay in milliseconds. Default: 200 */
  baseDelayMs?: number;
  /** Maximum delay cap in milliseconds. Default: 5000 */
  maxDelayMs?: number;
  /** Jitter factor 0–1 applied to each delay. Default: 0.2 */
  jitter?: number;
}

/** HTTP status codes that indicate a transient server-side error. */
const TRANSIENT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

/** Returns true for errors that are safe to retry. */
function isTransient(err: unknown): boolean {
  if (err instanceof TypeError) return true; // network failure / CORS
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("timeout") || msg.includes("network") || msg.includes("econnreset")) {
      return true;
    }
    // Check for HTTP status codes embedded in the message
    for (const code of TRANSIENT_STATUS_CODES) {
      if (msg.includes(String(code))) return true;
    }
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn` with exponential backoff, retrying only on transient errors.
 *
 * @param fn         - Async factory for the read operation
 * @param retryOpts  - Optional retry policy overrides
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retryOpts: RetryConfig = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 200,
    maxDelayMs = 5000,
    jitter = 0.2,
  } = retryOpts;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      const isLast = attempt === maxAttempts;
      if (isLast || !isTransient(err)) {
        throw err;
      }

      const exponential = baseDelayMs * 2 ** (attempt - 1);
      const capped = Math.min(exponential, maxDelayMs);
      const jitterMs = capped * jitter * Math.random();
      await delay(Math.round(capped + jitterMs));
    }
  }

  throw lastError;
}
