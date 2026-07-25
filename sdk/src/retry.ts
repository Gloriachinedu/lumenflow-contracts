/**
 * Retry logic with exponential backoff and jitter for LumenFlow SDK RPC calls.
 *
 * Retry formula:  delay = base * 2^attempt + random_jitter
 *
 * Retried conditions:
 *   - Network errors (no response received)
 *   - HTTP 429 (Too Many Requests)
 *   - HTTP 503 (Service Unavailable)
 *
 * Not retried:
 *   - HTTP 4xx errors other than 429 (client errors, e.g. 400 Bad Request)
 */

/** Options that control retry behaviour. */
export interface RetryOptions {
  /** Maximum number of retry attempts (not counting the initial call). Default: 3. */
  maxRetries?: number;
  /** Base delay in milliseconds before the first retry. Default: 200. */
  baseDelayMs?: number;
  /** Maximum total delay cap in milliseconds. Default: 10_000. */
  maxDelayMs?: number;
  /** Upper bound of the random jitter added to each delay in ms. Default: 100. */
  jitterMs?: number;
}

/** Rejection value returned when all retries are exhausted. */
export interface RetryExhaustedError {
  message: string;
  retryCount: number;
  lastError: unknown;
}

/** HTTP-like error shape that the retry logic inspects. */
export interface HttpError {
  status?: number;
}

/**
 * Returns true if the error represents a condition worth retrying.
 *
 * Retried:   network errors (no `status`), HTTP 429 and 503.
 * Not retried: HTTP 4xx (except 429), including 400 Bad Request.
 */
export function isRetryable(error: unknown): boolean {
  if (error == null || typeof error !== 'object') {
    // Plain non-HTTP error → treat as network error, retry
    return true;
  }
  const httpError = error as HttpError;
  if (httpError.status === undefined) {
    // No status code → network-level error
    return true;
  }
  // Retry on 429 and 503 only
  return httpError.status === 429 || httpError.status === 503;
}

/**
 * Calculates the delay for a given attempt using exponential backoff with jitter.
 *
 * @param attempt     0-indexed attempt number (0 = first retry)
 * @param baseDelayMs Base delay in milliseconds
 * @param maxDelayMs  Maximum delay cap in milliseconds
 * @param jitterMs    Upper bound for random jitter in milliseconds
 */
export function calculateDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterMs: number,
): number {
  const exponential = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * jitterMs;
  return Math.min(exponential + jitter, maxDelayMs);
}

/**
 * Executes `fn` and retries on retryable errors using exponential backoff.
 *
 * @param fn      Async function to execute and potentially retry.
 * @param options Retry configuration overrides.
 * @returns       The resolved value of `fn` on success.
 * @throws        `RetryExhaustedError` when all retries are exhausted,
 *                or the original error immediately for non-retryable failures.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 200;
  const maxDelayMs = options.maxDelayMs ?? 10_000;
  const jitterMs = options.jitterMs ?? 100;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Do not retry non-retryable errors (e.g. 400 Bad Request)
      if (!isRetryable(error)) {
        throw error;
      }

      // If this was the last attempt, break out and throw the exhausted error
      if (attempt === maxRetries) {
        break;
      }

      // Wait before the next attempt
      const delay = calculateDelay(attempt, baseDelayMs, maxDelayMs, jitterMs);
      await sleep(delay);
    }
  }

  const exhausted: RetryExhaustedError = {
    message: `All ${maxRetries} retry attempts exhausted.`,
    retryCount: maxRetries,
    lastError,
  };
  throw exhausted;
}

/** Promisified setTimeout. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
