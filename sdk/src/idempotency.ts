import { LumenFlowError, PaymentErrorCode } from "./errors";

export interface IdempotentResult<T> {
  result: T;
  /** true when the response came from a previous identical submission */
  duplicate: boolean;
}

/**
 * In-flight deduplication registry keyed by idempotency key.
 *
 * When multiple concurrent callers submit the same idempotency key, only the
 * first invocation actually executes; the rest await the same promise and
 * receive the same result (marked as duplicates).
 */
const inFlight = new Map<string, Promise<IdempotentResult<unknown>>>();

/**
 * Wraps a payment invocation to provide idempotent semantics.
 *
 * If the contract returns PaymentAlreadyExists (code 21) the caller can
 * optionally supply a `fallback` that fetches the existing record so the
 * caller always receives a consistent result rather than an error.
 *
 * When an `idempotencyKey` is supplied, concurrent submissions with the same
 * key are deduplicated: only one invocation runs, and all callers receive a
 * consistent result. Subsequent callers are marked as `duplicate: true`.
 *
 * @param invoke         - async function that executes the payment
 * @param fallback       - optional async function that retrieves the existing
 *                         record when a duplicate is detected
 * @param idempotencyKey - optional key used to deduplicate concurrent calls
 */
export async function withIdempotency<T>(
  invoke: () => Promise<T>,
  fallback?: () => Promise<T>,
  idempotencyKey?: string
): Promise<IdempotentResult<T>> {
  if (idempotencyKey !== undefined) {
    const existing = inFlight.get(idempotencyKey);
    if (existing) {
      const settled = (await existing) as IdempotentResult<T>;
      return { result: settled.result, duplicate: true };
    }
  }

  const run = async (): Promise<IdempotentResult<T>> => {
    try {
      const result = await invoke();
      return { result, duplicate: false };
    } catch (err) {
      if (
        err instanceof LumenFlowError &&
        err.code === PaymentErrorCode.PaymentAlreadyExists
      ) {
        if (fallback) {
          const result = await fallback();
          return { result, duplicate: true };
        }
        // No fallback — re-throw so callers that don't opt in still see the error
        throw err;
      }
      throw err;
    }
  };

  const promise = run();

  if (idempotencyKey !== undefined) {
    inFlight.set(idempotencyKey, promise as Promise<IdempotentResult<unknown>>);
    // Ensure the registry is cleaned up regardless of outcome so that a
    // later, genuinely new submission with the same key can proceed.
    promise
      .catch(() => undefined)
      .finally(() => {
        if (inFlight.get(idempotencyKey) === promise) {
          inFlight.delete(idempotencyKey);
        }
      });
  }

  return promise;
}