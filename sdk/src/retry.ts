/**
 * Retry utilities for handling transient HTTP errors with exponential backoff and jitter.
 */

import { LumenFlowError } from './errors';

export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Initial delay in milliseconds */
  initialDelayMs: number;
  /** Maximum delay in milliseconds */
  maxDelayMs: number;
  /** Backoff multiplier (e.g., 2 for exponential backoff) */
  backoffMultiplier: number;
  /** Jitter factor (0-1) to add randomness to delays */
  jitterFactor: number;
  /** HTTP status codes that should trigger a retry */
  retryableStatusCodes: number[];
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 5,
  initialDelayMs: 100,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
  retryableStatusCodes: [429, 503, 504],
};

/**
 * Executes a function with retry logic for transient errors.
 * 
 * @param fn - The async function to execute
 * @param config - Retry configuration (uses defaults if not provided)
 * @returns The result of the function
 * @throws The last error if all retry attempts fail
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const fullConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < fullConfig.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Check if error is retryable
      if (!isRetryableError(error, fullConfig.retryableStatusCodes)) {
        throw error;
      }

      // Don't delay after the last attempt
      if (attempt < fullConfig.maxAttempts - 1) {
        const delay = calculateDelay(attempt, fullConfig);
        await sleep(delay);
      }
    }
  }

  throw lastError || new Error('Retry failed: unknown error');
}

/**
 * Determines if an error should trigger a retry.
 */
function isRetryableError(error: any, retryableStatusCodes: number[]): boolean {
  // LumenFlowError (business logic errors) should not be retried
  if (error instanceof LumenFlowError) {
    return false;
  }

  // Check for HTTP errors with retryable status codes
  if (error?.response?.status) {
    return retryableStatusCodes.includes(error.response.status);
  }

  // Check for network errors (no response)
  if (error?.code === 'ECONNRESET' || error?.code === 'ETIMEDOUT' || error?.code === 'ENOTFOUND') {
    return true;
  }

  // Check for Soroban RPC specific errors
  if (error?.message?.includes('timeout') || error?.message?.includes('network')) {
    return true;
  }

  return false;
}

/**
 * Calculates delay with exponential backoff and jitter.
 */
function calculateDelay(attempt: number, config: RetryConfig): number {
  const baseDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
  const cappedDelay = Math.min(baseDelay, config.maxDelayMs);
  
  // Add jitter to prevent thundering herd
  const jitter = cappedDelay * config.jitterFactor * (Math.random() * 2 - 1);
  return Math.max(0, cappedDelay + jitter);
}

/**
 * Sleep for a specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
