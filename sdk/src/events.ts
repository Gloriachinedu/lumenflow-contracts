/**
 * LumenFlow SDK — Horizon event streaming
 *
 * Works in both Node.js (via the global `EventSource` polyfill or native fetch)
 * and the browser (native EventSource).
 */

const HORIZON_MAINNET = 'https://horizon.stellar.org';
const HORIZON_TESTNET = 'https://horizon-testnet.stellar.org';

export type EventFilter = {
  /** Filter by event name, e.g. "refund_approved". Matches the second topic. */
  eventName?: string;
};

export type LumenFlowEvent = {
  id: string;
  type: string;
  topics: string[];
  value: string;
};

/**
 * Decoded payload of a `CrossAssetPaymentEvent` emitted by the contract when a
 * payer pays in a different asset than the merchant's preferred token.
 */
export type CrossAssetPaymentEvent = {
  /** Payer address (or identifier) that initiated the payment. */
  payer: string;
  /** Merchant address (or identifier) that received the payment. */
  merchant: string;
  /** Asset the payer sent, e.g. "native" or "CODE:ISSUER". */
  sendAsset: string;
  /** Asset the merchant received, e.g. "native" or "CODE:ISSUER". */
  destAsset: string;
  /** Amount of `sendAsset` actually spent. */
  sendAmount: bigint;
  /** Amount of `destAsset` actually received by the merchant. */
  destAmount: bigint;
  /**
   * Exchange rate used for the conversion, expressed as `destAmount / sendAmount`.
   * Provided as a number for convenience; use `sendAmount`/`destAmount` for exact math.
   */
  exchangeRate: number;
  /** Optional payment reference/memo. */
  reference?: string;
};

const CROSS_ASSET_PAYMENT_EVENT = 'cross_asset_payment';

function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return 0n;
    return BigInt(trimmed);
  }
  return 0n;
}

function toAssetString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // Soroban asset enums are commonly serialized as { native: ... } or { credit_alphanum4: ... }.
    if ('native' in obj) return 'native';
    if (typeof obj.code === 'string' && typeof obj.issuer === 'string') {
      return `${obj.code}:${obj.issuer}`;
    }
    const keys = Object.keys(obj);
    if (keys.length === 1) {
      const inner = obj[keys[0]];
      if (inner && typeof inner === 'object') {
        const innerObj = inner as Record<string, unknown>;
        if (typeof innerObj.code === 'string' && typeof innerObj.issuer === 'string') {
          return `${innerObj.code}:${innerObj.issuer}`;
        }
      }
      return keys[0];
    }
  }
  return String(value ?? '');
}

/**
 * Decode a raw `LumenFlowEvent` into a typed `CrossAssetPaymentEvent`.
 *
 * Returns `null` when the event is not a cross-asset payment event or its
 * payload cannot be parsed.
 */
export function decodeCrossAssetPaymentEvent(
  event: LumenFlowEvent,
): CrossAssetPaymentEvent | null {
  const isCrossAsset =
    event.topics[1] === CROSS_ASSET_PAYMENT_EVENT ||
    event.type === CROSS_ASSET_PAYMENT_EVENT;
  if (!isCrossAsset) return null;

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(event.value);
    if (!parsed || typeof parsed !== 'object') return null;
    payload = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  const sendAmount = toBigInt(payload.send_amount ?? payload.sendAmount);
  const destAmount = toBigInt(payload.dest_amount ?? payload.destAmount);

  let exchangeRate: number;
  if (typeof payload.exchange_rate === 'number') {
    exchangeRate = payload.exchange_rate;
  } else if (typeof payload.exchangeRate === 'number') {
    exchangeRate = payload.exchangeRate;
  } else if (sendAmount > 0n) {
    exchangeRate = Number(destAmount) / Number(sendAmount);
  } else {
    exchangeRate = 0;
  }

  const reference = payload.reference ?? payload.memo;

  return {
    payer: String(payload.payer ?? ''),
    merchant: String(payload.merchant ?? ''),
    sendAsset: toAssetString(payload.send_asset ?? payload.sendAsset),
    destAsset: toAssetString(payload.dest_asset ?? payload.destAsset),
    sendAmount,
    destAmount,
    exchangeRate,
    reference: typeof reference === 'string' ? reference : undefined,
  };
}

export type UnsubscribeFn = () => void;

type SubscribeOptions = {
  /** Horizon base URL. Defaults to testnet. */
  horizonUrl?: string;
  /** Cursor to resume from. Defaults to "now". */
  cursor?: string;
  /** Called before a retry, with its one-based attempt number and delay. */
  onReconnecting?: (attempt: number, delayMs: number) => void;
  /** Called when a retry successfully opens the stream. */
  onReconnected?: () => void;
  /** Called after all reconnect attempts fail. */
  onError?: (error: Event) => void;
};

/**
 * Subscribe to contract events from Horizon SSE.
 *
 * @param contractId  - Soroban contract ID to watch
 * @param filter      - Optional filter (by event name)
 * @param callback    - Called for each matching event
 * @param options     - Horizon URL and cursor options
 * @returns           - Unsubscribe function
 */
export function subscribe(
  contractId: string,
  filter: EventFilter,
  callback: (event: LumenFlowEvent) => void,
  options: SubscribeOptions = {},
): UnsubscribeFn {
  const base = options.horizonUrl ?? HORIZON_TESTNET;
  const cursor = options.cursor ?? 'now';
  const url = `${base}/contract_events?contract_id=${encodeURIComponent(contractId)}&cursor=${cursor}`;

  let es: EventSource | null = null;
  let stopped = false;
  let retries = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let hasConnected = false;
  const maxRetries = 5;
  const initialRetryDelay = 1_000;

  function connect() {
    if (stopped) return;

    es = new EventSource(url);
    es.onopen = () => {
      if (hasConnected) options.onReconnected?.();
      hasConnected = true;
      retries = 0;
    };

    es.onmessage = (msg: MessageEvent) => {
      try {
        const raw = JSON.parse(msg.data as string);
        const event: LumenFlowEvent = {
          id: raw.id ?? '',
          type: raw.type ?? '',
          topics: raw.topic ?? [],
          value: raw.value ?? '',
        };
        // Apply filter: second topic encodes the event name
        if (filter.eventName && event.topics[1] !== filter.eventName) return;
        callback(event);
      } catch {
        // ignore malformed messages
      }
    };

    es.onerror = (event: Event) => {
      es?.close();
      es = null;
      if (stopped) return;

      if (retries >= maxRetries) {
        options.onError?.(event);
        return;
      }

      retries += 1;
      const delayMs = initialRetryDelay * 2 ** (retries - 1);
      options.onReconnecting?.(retries, delayMs);
      reconnectTimer = setTimeout(connect, delayMs);
    };
  }

  connect();

  return () => {
    stopped = true;
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    es?.close();
    es = null;
  };
}

/** Convenience namespace so callers can write `sdk.events.subscribe(...)`. */
export const events = { subscribe, decodeCrossAssetPaymentEvent };
