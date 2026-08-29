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

export type UnsubscribeFn = () => void;

type SubscribeOptions = {
  /** Horizon base URL. Defaults to testnet. */
  horizonUrl?: string;
  /** Cursor to resume from. Defaults to "now". */
  cursor?: string;
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
  let retryDelay = 1_000; // ms, doubles on each failure up to 30s

  function connect() {
    if (stopped) return;

    es = new EventSource(url);

    es.onmessage = (msg: MessageEvent) => {
      retryDelay = 1_000; // reset on success
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

    es.onerror = () => {
      es?.close();
      es = null;
      if (!stopped) {
        setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30_000);
      }
    };
  }

  connect();

  return () => {
    stopped = true;
    es?.close();
    es = null;
  };
}

/** Convenience namespace so callers can write `sdk.events.subscribe(...)`. */
export const events = { subscribe };
