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
