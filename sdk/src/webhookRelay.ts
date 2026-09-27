/**
 * LumenFlow SDK — Webhook relay with at-least-once delivery, retry and
 * deduplication.
 *
 * The relay sits between the Horizon / Soroban RPC contract-event stream and a
 * downstream HTTP webhook endpoint (see `docs/webhook-integration.md`). Two
 * hazards are handled here:
 *
 *  1. **Duplicate events** — Horizon reconnections and RPC re-polls replay
 *     events that were already seen. Every event carries a stable idempotency
 *     key (`paging_token`, falling back to `id`). The relay records processed
 *     keys in a {@link DedupeStore} and drops replays before they reach the
 *     webhook.
 *
 *  2. **Transient delivery failures** — the downstream endpoint may be briefly
 *     unavailable (network blip, HTTP 429/5xx). Delivery is retried with
 *     exponential backoff. Non-transient responses (HTTP 4xx other than 429)
 *     fail fast — retrying a `401` or `422` will never succeed.
 *
 * A key is only marked processed once delivery *succeeds*, so a crash or an
 * exhausted retry budget leaves the event eligible for redelivery on the next
 * poll. That is the trade-off for at-least-once semantics; downstream handlers
 * must themselves be idempotent on the event key.
 */

export interface RelayEvent {
  /** Horizon paging token — the preferred idempotency key. */
  pagingToken?: string;
  /** Soroban RPC event id — fallback idempotency key. */
  id?: string;
  /** Event name, e.g. `payment_processed`. */
  type?: string;
  /** Topic array as delivered by Horizon / RPC. */
  topic?: string[];
  /** Decoded event payload. */
  value?: unknown;
  /** Ledger sequence the event was emitted in. */
  ledger?: number;
}

/** Persistent record of which event keys have been delivered. */
export interface DedupeStore {
  has(key: string): boolean | Promise<boolean>;
  add(key: string): void | Promise<void>;
}

/** In-memory {@link DedupeStore}. Swap for Redis/DB in production. */
export class MemoryDedupeStore implements DedupeStore {
  private readonly seen = new Set<string>();

  has(key: string): boolean {
    return this.seen.has(key);
  }

  add(key: string): void {
    this.seen.add(key);
  }

  /** Test/inspection helper. */
  get size(): number {
    return this.seen.size;
  }
}

/** Result of a single webhook POST attempt. */
export interface DeliveryResponse {
  status: number;
}

/** Performs the actual HTTP POST to the downstream webhook. */
export type DeliveryFn = (event: RelayEvent) => Promise<DeliveryResponse>;

export interface WebhookRelayOptions {
  deliver: DeliveryFn;
  store?: DedupeStore;
  /** Max delivery attempts per event (including the first). Default: 4. */
  maxAttempts?: number;
  /** Base backoff delay in ms. Default: 200. */
  baseDelayMs?: number;
  /** Backoff cap in ms. Default: 10_000. */
  maxDelayMs?: number;
  /** Injectable sleep — override in tests to avoid real timers. */
  sleep?: (ms: number) => Promise<void>;
}

export class WebhookDeliveryError extends Error {
  constructor(
    message: string,
    readonly event: RelayEvent,
    readonly attempts: number,
    readonly lastStatus?: number,
  ) {
    super(message);
    this.name = 'WebhookDeliveryError';
  }
}

/** HTTP status codes worth retrying. Everything else in 4xx fails fast. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function idempotencyKey(event: RelayEvent): string | null {
  return event.pagingToken ?? event.id ?? null;
}

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

export interface RelayOutcome {
  /** `delivered` — POST succeeded; `duplicate` — dropped as a replay. */
  status: 'delivered' | 'duplicate';
  key: string;
  attempts: number;
}

export class WebhookRelay {
  private readonly deliver: DeliveryFn;
  private readonly store: DedupeStore;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: WebhookRelayOptions) {
    this.deliver = options.deliver;
    this.store = options.store ?? new MemoryDedupeStore();
    this.maxAttempts = options.maxAttempts ?? 4;
    this.baseDelayMs = options.baseDelayMs ?? 200;
    this.maxDelayMs = options.maxDelayMs ?? 10_000;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /**
   * Relay a single event to the downstream webhook.
   *
   * @throws {TypeError} when the event carries no idempotency key.
   * @throws {WebhookDeliveryError} when every retry attempt fails.
   */
  async relay(event: RelayEvent): Promise<RelayOutcome> {
    const key = idempotencyKey(event);
    if (!key) {
      throw new TypeError('relay event is missing an idempotency key (pagingToken or id)');
    }

    if (await this.store.has(key)) {
      return { status: 'duplicate', key, attempts: 0 };
    }

    let lastStatus: number | undefined;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      let response: DeliveryResponse | undefined;
      let threw = false;
      try {
        response = await this.deliver(event);
      } catch {
        threw = true;
      }

      if (response && response.status >= 200 && response.status < 300) {
        await this.store.add(key);
        return { status: 'delivered', key, attempts: attempt };
      }

      lastStatus = response?.status;
      const retryable = threw || (lastStatus !== undefined && isRetryableStatus(lastStatus));
      const isLast = attempt === this.maxAttempts;

      if (!retryable) {
        throw new WebhookDeliveryError(
          `webhook rejected event ${key} with non-retryable status ${lastStatus}`,
          event,
          attempt,
          lastStatus,
        );
      }
      if (isLast) {
        throw new WebhookDeliveryError(
          `webhook delivery for event ${key} exhausted ${this.maxAttempts} attempts`,
          event,
          attempt,
          lastStatus,
        );
      }

      const backoff = Math.min(this.baseDelayMs * 2 ** (attempt - 1), this.maxDelayMs);
      await this.sleep(backoff);
    }

    // Unreachable — the loop always returns or throws.
    throw new WebhookDeliveryError(`webhook delivery for event ${key} failed`, event, this.maxAttempts, lastStatus);
  }

  /**
   * Relay a batch of events in order, stopping at the first hard failure so the
   * caller can persist the cursor up to the last delivered event and resume.
   */
  async relayBatch(events: RelayEvent[]): Promise<RelayOutcome[]> {
    const outcomes: RelayOutcome[] = [];
    for (const event of events) {
      outcomes.push(await this.relay(event));
    }
    return outcomes;
  }
}
