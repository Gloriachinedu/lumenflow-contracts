import { LumenFlowError, PaymentErrorCode } from "./errors";

export interface IdempotentResult<T> {
  result: T;
  /** true when the response came from a previous identical submission */
  duplicate: boolean;
}

/**
 * Wraps a payment invocation to provide idempotent semantics.
 *
 * If the contract returns PaymentAlreadyExists (code 21) the caller can
 * optionally supply a `fallback` that fetches the existing record so the
 * caller always receives a consistent result rather than an error.
 *
 * @param invoke  - async function that executes the payment
 * @param fallback - optional async function that retrieves the existing record
 *                   when a duplicate is detected
 */
export async function withIdempotency<T>(
  invoke: () => Promise<T>,
  fallback?: () => Promise<T>
): Promise<IdempotentResult<T>> {
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
}
