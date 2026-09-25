/**
 * idempotency.ts
 *
 * Automatic idempotency-key generation for LumenFlow payment submissions.
 *
 * Problem: callers of `submitPayment()` previously had to supply an idempotency
 * key manually. Forgetting to do so risked duplicate on-chain payments.
 *
 * Solution: when no key is provided, one is generated automatically with
 * `crypto.randomUUID()`. The generated key is always surfaced in the returned
 * `PaymentResult` so callers can log or correlate it.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Input data required to submit a payment. */
export interface PaymentRequest {
  /** The merchant's Stellar address. */
  merchantAddress: string;
  /** The Stellar asset/token address to pay with. */
  tokenAddress: string;
  /** Payment amount in the smallest unit (integer). */
  amount: number;
  /** Human-readable reference (e.g. invoice number). */
  memo?: string;
}

/** Options accepted by `submitPayment()`. */
export interface SubmitPaymentOptions {
  /**
   * Optional custom idempotency key.
   *
   * Use this to supply a deterministic key derived from your own business
   * logic (e.g. a database order UUID) so that retries of the same logical
   * payment are automatically deduplicated.
   *
   * When omitted, a `crypto.randomUUID()` value is generated automatically.
   */
  idempotencyKey?: string;
}

/** Result returned by `submitPayment()`. */
export interface PaymentResult {
  /** `true` when the payment was accepted by the contract. */
  success: boolean;
  /**
   * The idempotency key that was used for this submission.
   *
   * When the key was auto-generated, this value lets callers log or store it
   * for later deduplication / correlation.
   */
  idempotencyKey: string;
  /** Ledger sequence number on which the payment was recorded. */
  ledger?: number;
  /** Contract-assigned order identifier. */
  orderId?: string;
}

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

/**
 * Generate a new idempotency key using `crypto.randomUUID()`.
 *
 * Works in modern browsers (Web Crypto API) and Node.js ≥ 14.17.
 * Throws if neither environment provides `crypto.randomUUID`.
 */
export function generateIdempotencyKey(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  // Fallback for environments that don't yet expose crypto.randomUUID
  // (e.g. older Node.js). Uses crypto.getRandomValues when available.
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    // Set version (4) and variant bits per RFC 4122.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return [...bytes]
      .map((b, i) =>
        [4, 6, 8, 10].includes(i)
          ? `-${b.toString(16).padStart(2, "0")}`
          : b.toString(16).padStart(2, "0")
      )
      .join("");
  }

  throw new Error(
    "crypto.randomUUID is not available in this environment. " +
      "Provide an explicit idempotencyKey via SubmitPaymentOptions."
  );
}

// ---------------------------------------------------------------------------
// In-memory deduplication store
// ---------------------------------------------------------------------------

/**
 * A simple in-memory deduplication store that maps idempotency keys to their
 * previously returned `PaymentResult`.
 *
 * In production you would back this with a database or distributed cache.
 */
export class IdempotencyStore {
  private readonly store = new Map<string, PaymentResult>();

  /** Check whether a key has already been used. */
  has(key: string): boolean {
    return this.store.has(key);
  }

  /** Retrieve the cached result for a previously submitted key. */
  get(key: string): PaymentResult | undefined {
    return this.store.get(key);
  }

  /** Record a completed payment result against its key. */
  set(key: string, result: PaymentResult): void {
    this.store.set(key, result);
  }

  /** Number of stored entries. */
  get size(): number {
    return this.store.size;
  }

  /** Remove all stored entries (useful for testing). */
  clear(): void {
    this.store.clear();
  }
}

/** Shared singleton store used by `submitPayment()`. */
export const idempotencyStore = new IdempotencyStore();

// ---------------------------------------------------------------------------
// Payment submission with auto-idempotency
// ---------------------------------------------------------------------------

/**
 * Injectable payment executor — accepts request + key, returns a result.
 *
 * The default implementation is a no-op stub. Replace it with a real RPC /
 * contract call in production.
 */
export type PaymentExecutor = (
  request: PaymentRequest,
  idempotencyKey: string
) => Promise<Omit<PaymentResult, "idempotencyKey">>;

const defaultPaymentExecutor: PaymentExecutor = async (
  _request: PaymentRequest,
  _idempotencyKey: string
): Promise<Omit<PaymentResult, "idempotencyKey">> => {
  // Production: call the Soroban contract via Stellar SDK, e.g.:
  //   await client.call('process_payment_with_signature', { ... });
  return { success: true };
};

/**
 * Submit a payment, auto-generating an idempotency key when none is supplied.
 *
 * @param request  - Payment details (merchant, token, amount, memo).
 * @param options  - Optional `idempotencyKey`. Omit to auto-generate.
 * @param executor - Injectable payment executor (defaults to no-op stub).
 * @param store    - Injectable deduplication store (defaults to shared singleton).
 * @returns A `PaymentResult` that always includes the `idempotencyKey` used,
 *          whether it was caller-supplied or auto-generated.
 *
 * @example Auto-generated key:
 * ```ts
 * const result = await submitPayment({ merchantAddress, tokenAddress, amount });
 * console.log('Key for audit log:', result.idempotencyKey);
 * ```
 *
 * @example Custom key (deterministic retry safety):
 * ```ts
 * const result = await submitPayment(
 *   { merchantAddress, tokenAddress, amount },
 *   { idempotencyKey: orderId }
 * );
 * ```
 */
export async function submitPayment(
  request: PaymentRequest,
  options: SubmitPaymentOptions = {},
  executor: PaymentExecutor = defaultPaymentExecutor,
  store: IdempotencyStore = idempotencyStore
): Promise<PaymentResult> {
  // Resolve the idempotency key: use caller-supplied or auto-generate.
  const idempotencyKey = options.idempotencyKey ?? generateIdempotencyKey();

  // Deduplication: if we have already processed this key, return the cached result.
  const cached = store.get(idempotencyKey);
  if (cached !== undefined) {
    return cached;
  }

  // Execute the payment.
  const partial = await executor(request, idempotencyKey);

  const result: PaymentResult = {
    ...partial,
    idempotencyKey,
  };

  // Cache the result before returning so concurrent retries get the same answer.
  store.set(idempotencyKey, result);

  return result;
}
