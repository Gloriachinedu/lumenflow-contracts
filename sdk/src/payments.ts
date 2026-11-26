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
import {
  LumenFlowValidationError,
  validateProcessPaymentInput,
  validateRegisterMerchantInput,
} from './validation';

/** Callback invoked for each incoming payment event. */
export type PaymentCallback = (event: PaymentEvent) => void;

/** Parameters accepted by `processPayment`. */
export interface ProcessPaymentParams {
  /** Merchant order identifier; must be a non-empty string. */
  orderId: string;
  /** Payment amount in stroops; must be positive. */
  amount: number | bigint;
  /** Stellar address of the token (or `native`); must be a valid address. */
  tokenAddress: string;
}

/** Parameters accepted by `registerMerchant`. */
export interface RegisterMerchantParams {
  /** Human-readable merchant name; must be a non-empty string. */
  name: string;
  /** Stellar account address of the merchant; must be valid. */
  address: string;
}

/** Minimal RPC client surface used by the public payment methods. */
export interface PaymentRpcClient {
  submitTransaction(envelope: Record<string, unknown>): Promise<unknown>;
  registerMerchant?(payload: RegisterMerchantParams): Promise<unknown>;
}

/** Options for the public payment methods. */
export interface PaymentMethodOptions {
  /** RPC client used to submit requests. */
  rpc?: PaymentRpcClient;
}

/**
 * Submits a payment request to the RPC layer.
 *
 * All inputs are validated before any network call is made; invalid input
 * throws a `LumenFlowValidationError` identifying the offending field.
 *
 * @param params  - Payment parameters (`orderId`, `amount`, `tokenAddress`).
 * @param options - Optional RPC client override.
 * @returns The RPC submission result.
 * @throws {LumenFlowValidationError} When any input parameter is invalid.
 */
export async function processPayment(
  params: ProcessPaymentParams,
  options: PaymentMethodOptions = {},
): Promise<unknown> {
  validateProcessPaymentInput(params);

  const rpc = options.rpc;
  if (!rpc) {
    throw new LumenFlowValidationError('rpc', 'An RPC client is required to process a payment');
  }

  return rpc.submitTransaction({
    orderId: params.orderId,
    amount: params.amount.toString(),
    tokenAddress: params.tokenAddress,
  });
}

/**
 * Registers a merchant with the RPC layer.
 *
 * All inputs are validated before any network call is made; invalid input
 * throws a `LumenFlowValidationError` identifying the offending field.
 *
 * @param params  - Merchant parameters (`name`, `address`).
 * @param options - Optional RPC client override.
 * @returns The RPC submission result.
 * @throws {LumenFlowValidationError} When any input parameter is invalid.
 */
export async function registerMerchant(
  params: RegisterMerchantParams,
  options: PaymentMethodOptions = {},
): Promise<unknown> {
  validateRegisterMerchantInput(params);

  const rpc = options.rpc;
  if (!rpc || typeof rpc.registerMerchant !== 'function') {
    throw new LumenFlowValidationError('rpc', 'An RPC client is required to register a merchant');
  }

  return rpc.registerMerchant({ name: params.name, address: params.address });
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

/** Filter criteria accepted by `paginatePayments`. */
export interface PaymentFilter {
  /** Only yield payments sent to this merchant address. */
  merchantAddress?: string;
  /** Only yield payments with this asset code (or `native`). */
  token?: string;
  /** Inclusive lower bound on payment timestamp (unix seconds). */
  fromTimestamp?: bigint;
  /** Inclusive upper bound on payment timestamp (unix seconds). */
  toTimestamp?: bigint;
  /** Page size requested from the backend. Defaults to the client default. */
  limit?: number;
}

/**
 * Fetches a single page of payment orders.
 *
 * Implementations are expected to be provided by the SDK client (which wraps
 * `listPayments`). The fetcher receives an opaque cursor (or `undefined` for
 * the first page) and must resolve to the page's records plus the cursor for
 * the next page (`null` when there are no further pages).
 */
export type PaymentPageFetcher = PageFetcher<PaymentOrder>;

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
      ? BigInt(Math.floor(new Date(raw['created_at']).getTime() / 1000))
      : 0n,
    raw,
  };
}

/**
 * Fetches the aggregated payment summary for a payer from the smart contract.
 *
 * Calls the contract's `get_payer_payment_summary` read-only method, which
 * computes the totals from live storage (no caching, no auth required).
 *
 * @param payer - Stellar account address of the payer.
 * @param options - Optional configuration.
 * @param options.contractId - Contract ID to query. Defaults to the SDK's
 *   configured contract ID when omitted.
 * @param options.serverUrl - Soroban RPC URL. Defaults to testnet.
 * @returns A typed `PayerPaymentSummary` with totals and payment count.
 *
 * @example
 * ```typescript
 * import { getPayerPaymentSummary } from '@lumenflow/sdk';
 *
 * const summary = await getPayerPaymentSummary('GABC...payerAddress');
 * console.log(summary.totalPaid, summary.totalRefunded, summary.totalPending);
 * ```
 */
export async function getPayerPaymentSummary(
  payer: string,
  options: GetPayerPaymentSummaryOptions = {},
): Promise<PayerPaymentSummary> {
  const serverUrl = options.serverUrl ?? 'https://soroban-testnet.stellar.org';
  const contractId = options.contractId;

  if (!contractId) {
    throw new Error('getPayerPaymentSummary: contractId is required');
  }

  const response = await fetch(serverUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: '1',
      method: 'simulateTransaction',
      params: {
        transaction: {
          contract_id: contractId,
          function: 'get_payer_payment_summary',
          args: [payer],
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `getPayerPaymentSummary: RPC request failed with status ${response.status}`,
    );
  }

  const body = (await response.json()) as {
    result?: { retval?: unknown };
    error?: { message?: string };
  };

  if (body.error) {
    throw new Error(
      `getPayerPaymentSummary: ${body.error.message ?? 'RPC error'}`,
    );
  }

  const raw = (body.result?.retval ?? {}) as Record<string, unknown>;

  return {
    totalPaid: toBigInt(raw['total_paid']),
    totalRefunded: toBigInt(raw['total_refunded']),
    totalPending: toBigInt(raw['total_pending']),
    paymentCount: Number(raw['payment_count'] ?? 0),
  };
}

/** Options for `getPayerPaymentSummary`. */
export interface GetPayerPaymentSummaryOptions {
  /** Contract ID to query. */
  contractId?: string;
  /** Soroban RPC URL. Defaults to testnet. */
  serverUrl?: string;
}

/** Best-effort conversion of an RPC scalar to bigint. */
function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  if (typeof value === 'string' && value !== '') {
    try {
      return BigInt(value);
    } catch {
      return 0n;
    }
  }
  return 0n;
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
        const data: unknown = event.data;
        if (typeof data !== 'string') {
          return;
        }
        const parsed: unknown = JSON.parse(data);
        if (parsed === null || typeof parsed !== 'object') {
          return;
        }
        const raw = parsed as Record<string, unknown>;
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

/**
 * Lazily iterates over every payment matching `filter`, transparently fetching
 * all pages from the backend.
 *
 * Each iteration yields an individual `PaymentOrder` record — never a page
 * object. Pagination cursors are threaded automatically via the `paginate`
 * helper, so callers do not need to manage cursors themselves.
 *
 * @param filter      - Optional filter criteria applied to the payment list.
 * @param fetchPage   - Page fetcher, typically bound to the client's
 *                      `listPayments` method.
 * @returns An `AsyncGenerator` yielding individual `PaymentOrder` records.
 *
 * @example
 * ```typescript
 * for await (const payment of paginatePayments(
 *   { merchantAddress: 'GABC...' },
 *   (cursor) => client.listPayments({ cursor, limit: 50 }),
 * )) {
 *   console.log(payment.id, payment.amount);
 * }
 * ```
 */
export async function* paginatePayments(
  filter: PaymentFilter,
  fetchPage: PaymentPageFetcher,
): AsyncGenerator<PaymentOrder, void, undefined> {
  const limit = filter.limit;
  const pageFetcher: PaymentPageFetcher = (cursor) =>
    fetchPage(cursor);

  for await (const record of paginate<PaymentOrder>(pageFetcher, {
    limit,
  })) {
    if (!matchesPaymentFilter(record, filter)) {
      continue;
    }
    yield record;
  }
}

/**
 * Applies client-side filtering to a payment record.
 *
 * Server-side filtering is preferred where available; this guard ensures the
 * generator never yields records outside the requested filter even when the
 * backend ignores a criterion.
 */
function matchesPaymentFilter(
  record: PaymentOrder,
  filter: PaymentFilter,
): boolean {
  if (filter.merchantAddress !== undefined && record.merchant_address !== filter.merchantAddress) {
    return false;
  }
  if (filter.token !== undefined && record.token !== filter.token) {
    return false;
  }
  if (filter.fromTimestamp !== undefined && record.timestamp < filter.fromTimestamp) {
    return false;
  }
  if (filter.toTimestamp !== undefined && record.timestamp > filter.toTimestamp) {
    return false;
  }
  return true;
}
