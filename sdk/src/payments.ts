/**
 * Real-time payment notifications via Horizon's Server-Sent Events (SSE) stream.
 *
 * `subscribeToPayments` opens an SSE connection to the Horizon payments endpoint
 * for a given merchant address and invokes a callback for each incoming
 * `PaymentEvent`. The connection automatically reconnects after 30 seconds of
 * inactivity and can be cleanly closed via the returned `unsubscribe()` function.
 *
 * Horizon's `/payments?cursor=now` SSE endpoint is used as the underlying
 * transport, which provides sub-second latency compared to HTTP polling.
 */

import { PaymentEvent } from './types';

/** Callback invoked for each incoming payment event. */
export type PaymentCallback = (event: PaymentEvent) => void;

/**
 * Per-item result of a batch payment submission.
 *
 * Each item in a batch reports its own outcome so that partial failures are
 * visible to callers: `success` is `true` only when the item was accepted, and
 * `errorCode` is set (non-null) whenever the item failed.
 */
export interface BatchPaymentItemResult<T = unknown> {
  /** Zero-based index of the item within the submitted batch. */
  index: number;
  /** `true` if this item was submitted successfully. */
  success: boolean;
  /** Machine-readable error code when `success` is `false`, otherwise `null`. */
  errorCode: string | null;
  /** Human-readable error message when `success` is `false`, otherwise `null`. */
  errorMessage: string | null;
  /** Result payload for successful items (e.g. transaction hash). */
  result: T | null;
}

/** Aggregate result of a batch payment submission. */
export interface BatchPaymentResult<T = unknown> {
  /** `true` only if every item in the batch succeeded. */
  success: boolean;
  /** Per-item results, in the same order as the submitted items. */
  items: BatchPaymentItemResult<T>[];
  /** Number of items that succeeded. */
  succeeded: number;
  /** Number of items that failed. */
  failed: number;
}

/** Error codes reported per batch item. */
export const BatchPaymentErrorCode = {
  /** The item was rejected by the network / Horizon. */
  REJECTED: 'REJECTED',
  /** The item timed out while being submitted. */
  TIMEOUT: 'TIMEOUT',
  /** The item was rejected as a duplicate of an already-submitted payment. */
  DUPLICATE: 'DUPLICATE',
  /** The item failed validation before submission. */
  INVALID: 'INVALID',
  /** An unexpected error occurred while submitting the item. */
  UNKNOWN: 'UNKNOWN',
} as const;

/** Error code type for batch payment items. */
export type BatchPaymentErrorCode =
  (typeof BatchPaymentErrorCode)[keyof typeof BatchPaymentErrorCode];

/**
 * Submits a batch of payments, isolating failures per item.
 *
 * Each item is submitted independently; a failure in one item does not abort
 * the rest of the batch. The returned `BatchPaymentResult` contains one
 * `BatchPaymentItemResult` per submitted item (in input order), each carrying
 * its own `success` flag and `errorCode` on failure.
 *
 * @param items   - Array of payment payloads to submit.
 * @param submit  - Function that submits a single item and resolves with its
 *                  result, or rejects with an error. Rejections are mapped to
 *                  per-item error codes rather than failing the whole batch.
 * @returns       Aggregate result with per-item outcomes.
 */
export async function submitBatchPayments<TInput, TResult>(
  items: TInput[],
  submit: (item: TInput, index: number) => Promise<TResult>,
): Promise<BatchPaymentResult<TResult>> {
  const results: BatchPaymentItemResult<TResult>[] = [];

  for (let index = 0; index < items.length; index++) {
    try {
      const result = await submit(items[index], index);
      results.push({
        index,
        success: true,
        errorCode: null,
        errorMessage: null,
        result,
      });
    } catch (err) {
      const { code, message } = classifyBatchError(err);
      results.push({
        index,
        success: false,
        errorCode: code,
        errorMessage: message,
        result: null,
      });
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.length - succeeded;

  return {
    success: failed === 0,
    items: results,
    succeeded,
    failed,
  };
}

/**
 * Maps an arbitrary thrown value to a batch payment error code and message.
 */
function classifyBatchError(err: unknown): { code: BatchPaymentErrorCode; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  const rawCode =
    err !== null && typeof err === 'object' && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';

  switch (rawCode) {
    case BatchPaymentErrorCode.TIMEOUT:
      return { code: BatchPaymentErrorCode.TIMEOUT, message };
    case BatchPaymentErrorCode.DUPLICATE:
      return { code: BatchPaymentErrorCode.DUPLICATE, message };
    case BatchPaymentErrorCode.REJECTED:
      return { code: BatchPaymentErrorCode.REJECTED, message };
    case BatchPaymentErrorCode.INVALID:
      return { code: BatchPaymentErrorCode.INVALID, message };
    default:
      return { code: BatchPaymentErrorCode.UNKNOWN, message };
  }
}

/** Object returned by `subscribeToPayments`. Call `unsubscribe()` to close. */
export interface PaymentSubscription {
  /** Closes the SSE connection and stops all reconnect timers. */
  unsubscribe(): void;
}

/** Options for `subscribeToPayments`. */
export interface SubscribeOptions {
  /**
   * Horizon base URL, e.g. `https://horizon-testnet.stellar.org`.
   * Defaults to testnet if not provided.
   */
  horizonUrl?: string;
  /**
   * Inactivity timeout in milliseconds.
   * If no event arrives within this window the connection is closed and
   * reopened. Defaults to 30 000 ms (30 seconds).
   */
  inactivityTimeoutMs?: number;
  /**
   * Factory function for creating an EventSource-compatible object.
   * Override in tests to inject a mock. Defaults to the global `EventSource`.
   */
  eventSourceFactory?: EventSourceFactory;
}

/**
 * Minimal EventSource interface used internally.
 * Compatible with both browser EventSource and the `eventsource` npm package.
 */
export interface IEventSource {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
}

/** Factory type for creating IEventSource instances. */
export type EventSourceFactory = (url: string) => IEventSource;

/** Default factory uses the global EventSource (browser / Node with polyfill). */
function defaultEventSourceFactory(url: string): IEventSource {
  // eslint-disable-next-line no-undef
  return new EventSource(url);
}

/**
 * Parses a raw Horizon SSE payment record into a typed `PaymentEvent`.
 *
 * Horizon's payment objects vary by type; this function extracts the common
 * fields shared across `payment`, `create_account`, and path-payment operations.
 *
 * @param raw - Raw JSON object from the Horizon SSE stream.
 * @returns A typed `PaymentEvent` with best-effort field extraction.
 */
export function parsePaymentEvent(raw: Record<string, unknown>): PaymentEvent {
  return {
    type: typeof raw['type'] === 'string' ? raw['type'] : 'payment',
    order_id: typeof raw['id'] === 'string' ? raw['id'] : '',
    merchant_address: typeof raw['to'] === 'string' ? raw['to'] : '',
    payer: typeof raw['from'] === 'string' ? raw['from'] : '',
    token: typeof raw['asset_code'] === 'string'
      ? raw['asset_code']
      : (typeof raw['asset_type'] === 'string' ? raw['asset_type'] : 'native'),
    amount: typeof raw['amount'] === 'string'
      ? BigInt(Math.round(parseFloat(raw['amount']) * 10_000_000))
      : 0n,
    timestamp: typeof raw['created_at'] === 'string'
      ? BigInt(Math.floor(new Date(raw['created_at'] as string).getTime() / 1000))
      : 0n,
    raw,
  };
}

/**
 * Subscribes to real-time payment events for a given merchant address using
 * Horizon's SSE payment stream.
 *
 * The subscription:
 * - Filters incoming events by `merchantAddress` (checks `to` field)
 * - Automatically reconnects after `inactivityTimeoutMs` (default: 30 s)
 * - Can be cleanly closed by calling `subscription.unsubscribe()`
 *
 * @param merchantAddress - Stellar account address of the merchant to watch.
 * @param callback        - Function called with each matching `PaymentEvent`.
 * @param options         - Optional configuration overrides.
 * @returns               `PaymentSubscription` object with `unsubscribe()`.
 *
 * @example
 * ```typescript
 * import { subscribeToPayments } from '@lumenflow/sdk';
 *
 * const sub = subscribeToPayments(
 *   'GABC...merchantAddress',
 *   (event) => {
 *     console.log('Payment received:', event.amount, 'from', event.payer);
 *   },
 *   { horizonUrl: 'https://horizon-testnet.stellar.org' },
 * );
 *
 * // Later, when done:
 * sub.unsubscribe();
 * ```
 */
export function subscribeToPayments(
  merchantAddress: string,
  callback: PaymentCallback,
  options: SubscribeOptions = {},
): PaymentSubscription {
  const horizonUrl = options.horizonUrl ?? 'https://horizon-testnet.stellar.org';
  const inactivityTimeoutMs = options.inactivityTimeoutMs ?? 30_000;
  const factory = options.eventSourceFactory ?? defaultEventSourceFactory;

  let es: IEventSource | null = null;
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  function clearInactivityTimer(): void {
    if (inactivityTimer !== null) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
  }

  function closeEventSource(): void {
    if (es !== null) {
      es.onmessage = null;
      es.onerror = null;
      es.close();
      es = null;
    }
  }

  function reconnect(): void {
    clearInactivityTimer();
    closeEventSource();
    if (!closed) {
      connect();
    }
  }

  function resetInactivityTimer(): void {
    clearInactivityTimer();
    inactivityTimer = setTimeout(reconnect, inactivityTimeoutMs);
  }

  function connect(): void {
    const url = `${horizonUrl}/payments?cursor=now`;
    es = factory(url);

    resetInactivityTimer();

    es.onmessage = (event: MessageEvent): void => {
      resetInactivityTimer();
      try {
        const raw = JSON.parse(event.data as string) as Record<string, unknown>;
        // Only invoke callback for events directed at our merchant
        if (raw['to'] === merchantAddress || merchantAddress === '') {
          callback(parsePaymentEvent(raw));
        }
      } catch {
        // Ignore malformed SSE frames
      }
    };

    es.onerror = (): void => {
      // On error, schedule a reconnect via the inactivity timeout
      resetInactivityTimer();
    };
  }

  connect();

  return {
    unsubscribe(): void {
      closed = true;
      clearInactivityTimer();
      closeEventSource();
    },
  };
}
