Looking at this task, I need to add structured logging to `webhookRelay.ts`. The step references `logRedaction.ts` which I'll need to import. Let me implement the changes:

```typescript
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
 *
 * Every relay operation emits a structured JSON log line carrying `level`,
 * `correlationId`, `operation` and `duration_ms`. Sensitive fields (raw event
 * payloads, keys) are redacted via {@link redactLogFields} before logging.
 */

import { redactLogFields } from './logRedaction';

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

/** Structured log levels, ordered from most to least verbose. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** A single structured log line emitted by the relay. */
export interface RelayLogEntry {
  level: LogLevel;
  correlationId: string;
  operation: string;
  duration_ms: number;
  [field: string]: unknown;
}

/** Sink for structured log entries. Defaults to a JSON `console` writer. */
export type LogSink = (entry: RelayLogEntry) => void;

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
  /** Correlation id propagated through the request lifecycle. Auto-generated when omitted. */
  correlationId?: string;
  /** Minimum level to emit. Default: `info`. */
  logLevel?: LogLevel;
  /** Custom log sink — override in tests to capture entries. */
  logSink?: LogSink;
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

/**
 * Generate a UUID v4 correlation id. Uses `crypto.randomUUID` when available,
 * falling back to a `Math.random`-based implementation for older runtimes.
 */
export function generateCorrelationId(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Default sink: writes a single JSON line per entry to `console`. */
function defaultLogSink(entry: RelayLogEntry): void {
  const line = JSON.stringify(entry);
  switch (entry.level) {
    case 'error':
      console.error(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    case 'debug':
      // eslint-disable-next-line no-console
      console.debug(line);
      break;
    default:
      // eslint-disable-next-line no-console
      console.log(line);
  }
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
  private readonly correlationId: string;
  private readonly logLevel: LogLevel;
  private readonly logSink: LogSink;

  constructor(options: WebhookRelayOptions) {
    this.deliver = options.deliver;
    this.store = options.store ?? new MemoryDedupeStore();
    this.maxAttempts = options.maxAttempts ?? 4;
    this.baseDelayMs = options.baseDelayMs ?? 200;
    this.maxDelayMs = options.maxDelayMs ?? 10_000;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.correlationId = options.correlationId ?? generateCorrelationId();
    this.logLevel = options.logLevel ?? 'info';
    this.logSink = options.logSink ?? defaultLogSink;
  }

  /** The correlation id used for every log line emitted by this relay. */
  getCorrelationId(): string {
    return this.correlationId;
  }

  /** Emit a structured log line, redacting sensitive fields and honoring the level threshold. */
  private log(
    level: LogLevel,
    operation: string,
    durationMs: number,
    fields: Record<string, unknown> = {},
  ): void {
    if (LOG_LEVEL_RANK[level] < LOG_LEVEL_RANK[this.logLevel]) {
      return;
    }
    const redacted = redactLogFields(fields) as Record<string, unknown>;
    const entry: RelayLogEntry = {
      level,
      correlationId: this.correlationId,
      operation,
      duration_ms: durationMs,
      ...redacted,
    };
    try {
      this.logSink(entry);
    } catch {
      // Logging must never break delivery.
    }
  }

  /**
   * Relay a single event to the downstream webhook.
   *
   * @throws {TypeError} when the event carries no idempotency key.
   * @throws {WebhookDeliveryError} when every retry attempt fails.
   */
  async relay(event: RelayEvent): Promise<RelayOutcome> {
    const startedAt = Date.now();
    const key = idempotencyKey(event);
    if (!key) {
      this.log('error', 'relay', Date.now() - startedAt, {
        message: 'relay event is missing an idempotency key (pagingToken or id)',
        event,
      });
      throw new TypeError('relay event is missing an idempotency key (pagingToken or id)');
    }

    if (await this.store.has(key)) {
      this.log('debug', 'relay', Date.now() - startedAt, {
        status: 'duplicate',
        key,
        event,
      });
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
        this.log('info', 'relay', Date.now() - startedAt, {
          status: 'delivered',
          key,
          attempts: attempt,
          httpStatus: response.status,
          event,
        });
        return { status: 'delivered', key, attempts: attempt };
      }

      lastStatus = response?.status;
      const retryable = threw || (lastStatus !== undefined && isRetryableStatus(lastStatus));
      const isLast = attempt === this.maxAttempts;

      if (!retryable) {
        this.log('error', 'relay', Date.now() - startedAt, {
          status: 'failed',
          reason: 'non-retryable',
          key,
          attempts: attempt,
          httpStatus: lastStatus,
          event,
        });
        throw new WebhookDeliveryError(
          `webhook rejected event ${key} with non-retryable status ${lastStatus}`,
          event,
          attempt,
          lastStatus,
        );
      }
      if (isLast) {
        this.log('error', 'relay', Date.now() - startedAt, {
          status: 'failed',
          reason: 'exhausted',
          key,
          attempts: attempt,
          httpStatus: lastStatus,
          event,
        });
        throw new WebhookDeliveryError(
          `webhook delivery for event ${key} exhausted ${this.maxAttempts} attempts`,
          event,
          attempt,
          lastStatus,
        );
      }

      const backoff = Math.min(this.baseDelayMs * 2 ** (attempt - 1), this.maxDelayMs);
      this.log('warn', 'relay.retry', Date.now() - startedAt, {
        key,
        attempt,
        httpStatus: lastStatus,
        backoffMs: backoff,
        event,
      });
      await this.sleep(backoff);
    }

    // Unreachable — the loop always returns or throws.
    this.log('error', 'relay', Date.now() - startedAt, {
      status: 'failed',
      reason: 'unreachable',
      key,
      attempts: this.maxAttempts,
      httpStatus: lastStatus,
      event,
    });
    throw new WebhookDeliveryError(`webhook delivery for event ${key} failed`, event, this.maxAttempts, lastStatus);
  }

  /**
   * Relay a batch of events in order, stopping at the first hard failure so the
   * caller can persist the cursor up to the last delivered event and resume.
   */
  async relayBatch(events: RelayEvent[]): Promise<RelayOutcome[]> {
    const startedAt = Date.now();
    const outcomes: RelayOutcome[] = [];
    try {
      for (const event of events) {
        outcomes.push(await this.relay(event));
      }
      this.log('info', 'relayBatch', Date.now() - startedAt, {
        status: 'completed',
        eventCount: events.length,
        delivered: outcomes.filter((o) => o.status === 'delivered').length,
        duplicates: outcomes.filter((o) => o.status === 'duplicate').length,
      });
      return outcomes;
    } catch (err) {
      this.log('error', 'relayBatch', Date.now() - startedAt, {
        status: 'failed',
        eventCount: events.length,
        processed: outcomes.length,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}