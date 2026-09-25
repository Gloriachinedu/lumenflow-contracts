/**
 * eventPoller.ts
 *
 * Polling-based event subscription for LumenFlow contract events.
 *
 * Key features
 * ─────────────
 * • `subscribeToEvents()` returns an `unsubscribe()` function that stops the
 *   polling interval and releases all retained references — no memory leaks.
 * • An optional `AbortSignal` can be passed; aborting the signal automatically
 *   calls `unsubscribe()`.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single contract event emitted by the LumenFlow smart contract. */
export interface LumenFlowEvent {
  /** e.g. "lumenflow/payment_processed" */
  name: string;
  /** Ledger sequence number at which the event was emitted. */
  ledger: number;
  /** ISO-8601 timestamp of the ledger close. */
  timestamp: string;
  /** Arbitrary event payload (contract-specific). */
  payload: Record<string, unknown>;
}

/** Callback invoked for every new event batch fetched from the RPC. */
export type EventCallback = (events: LumenFlowEvent[]) => void;

/** Options accepted by `subscribeToEvents()`. */
export interface SubscribeOptions {
  /**
   * How often to poll the horizon/RPC endpoint, in milliseconds.
   * Defaults to 5 000 ms.
   */
  pollingIntervalMs?: number;
  /**
   * Ledger cursor — only events after this ledger are returned.
   * Defaults to "now" (the current ledger when the subscription starts).
   */
  cursorLedger?: number;
  /**
   * Optional filter: only deliver events whose `name` starts with this prefix.
   * e.g. "lumenflow/refund"
   */
  eventPrefix?: string;
  /**
   * If provided, the subscription is automatically cancelled when the signal
   * is aborted (e.g. when a component unmounts or a request is cancelled).
   */
  signal?: AbortSignal;
}

/** Returned by `subscribeToEvents()`. Calling it stops polling immediately. */
export type Unsubscribe = () => void;

// ---------------------------------------------------------------------------
// Internal RPC fetch (easily swapped in tests)
// ---------------------------------------------------------------------------

/**
 * Fetch new events from the Horizon / Soroban RPC endpoint.
 *
 * This default implementation is a lightweight stub that can be replaced with
 * a real RPC call in production. It is intentionally kept separate so that
 * unit tests can inject a mock without monkey-patching global `fetch`.
 */
export type EventFetcher = (
  afterLedger: number,
  prefix?: string
) => Promise<LumenFlowEvent[]>;

const defaultEventFetcher: EventFetcher = async (
  _afterLedger: number,
  _prefix?: string
): Promise<LumenFlowEvent[]> => {
  // Production: replace with a real Horizon/RPC call, e.g.:
  //   const resp = await fetch(`${RPC_URL}/events?after=${afterLedger}`);
  //   return (await resp.json()).events;
  return [];
};

// ---------------------------------------------------------------------------
// Core subscription function
// ---------------------------------------------------------------------------

/**
 * Start polling for LumenFlow contract events.
 *
 * @param onEvents  - Callback invoked whenever new events are available.
 * @param options   - Optional configuration (interval, cursor, filter, signal).
 * @param fetcher   - Injectable event-fetcher (defaults to no-op stub; swap in
 *                    tests or production implementations).
 * @returns An `unsubscribe` function that stops polling and clears all resources.
 *
 * @example
 * ```ts
 * const unsubscribe = subscribeToEvents(
 *   (events) => console.log('New events:', events),
 *   { pollingIntervalMs: 3000, eventPrefix: 'lumenflow/refund' }
 * );
 *
 * // Later, when the component/caller is done:
 * unsubscribe();
 * ```
 *
 * @example Using AbortSignal (e.g. React component cleanup):
 * ```ts
 * const controller = new AbortController();
 * subscribeToEvents(handleEvents, { signal: controller.signal });
 *
 * // On unmount:
 * controller.abort();
 * ```
 */
export function subscribeToEvents(
  onEvents: EventCallback,
  options: SubscribeOptions = {},
  fetcher: EventFetcher = defaultEventFetcher
): Unsubscribe {
  const {
    pollingIntervalMs = 5_000,
    cursorLedger = 0,
    eventPrefix,
    signal,
  } = options;

  // Mutable cursor: updated after each successful fetch.
  let lastLedger = cursorLedger;
  // Holds the setInterval handle so we can clear it on unsubscribe.
  let intervalId: ReturnType<typeof setInterval> | null = null;
  // Guard against re-entrant unsubscribe calls.
  let stopped = false;

  /**
   * Stop polling, clear the interval, and release all retained references.
   * Safe to call multiple times.
   */
  function unsubscribe(): void {
    if (stopped) return;
    stopped = true;

    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }

    // Remove the AbortSignal listener to avoid holding a reference to this
    // closure after cleanup.
    if (signal) {
      signal.removeEventListener("abort", unsubscribe);
    }
  }

  // Wire up AbortSignal *before* starting the interval so that an already-
  // aborted signal stops immediately.
  if (signal) {
    if (signal.aborted) {
      // Already aborted — return a no-op unsubscribe without starting polling.
      return unsubscribe;
    }
    signal.addEventListener("abort", unsubscribe, { once: true });
  }

  /**
   * One poll cycle: fetch new events, update the ledger cursor, invoke callback.
   */
  async function poll(): Promise<void> {
    if (stopped) return;

    let events: LumenFlowEvent[];
    try {
      events = await fetcher(lastLedger, eventPrefix);
    } catch {
      // Network/RPC errors are non-fatal; the next interval will retry.
      return;
    }

    if (stopped) return; // unsubscribe() may have been called during the await

    if (events.length > 0) {
      // Advance the cursor past the highest ledger we just received.
      const maxLedger = Math.max(...events.map((e) => e.ledger));
      if (maxLedger > lastLedger) {
        lastLedger = maxLedger;
      }

      try {
        onEvents(events);
      } catch {
        // Errors in the user-supplied callback must not crash the poller.
      }
    }
  }

  // Kick off the first poll immediately, then on the interval.
  void poll();
  intervalId = setInterval(() => void poll(), pollingIntervalMs);

  return unsubscribe;
}
