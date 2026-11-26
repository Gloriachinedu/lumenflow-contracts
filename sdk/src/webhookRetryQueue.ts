/**
 * LumenFlow SDK — Webhook retry queue with dead-letter handling.
 *
 * Issue #1541
 *
 * Failed webhook deliveries are retried up to MAX_ATTEMPTS times using
 * exponential backoff (1 s, 2 s, 4 s, 8 s, 16 s).  Events that exhaust
 * every retry are moved to a dead-letter queue (DLQ) where they can be
 * inspected and replayed via an admin API.
 *
 * Usage
 * -----
 * ```ts
 * const queue = new WebhookRetryQueue({ deliver });
 * await queue.enqueue({ id: 'evt_1', type: 'payment_processed', payload: {...} });
 *
 * // Admin: list dead-letter events
 * const dlq = queue.listDeadLetterEvents();
 *
 * // Admin: replay a single dead-letter event
 * await queue.replayDeadLetterEvent('evt_1');
 * ```
 */

/** A webhook event to be delivered. */
export interface WebhookEvent {
  /** Stable identifier for this event (used as the DLQ key). */
  id: string;
  /** Event type name, e.g. `payment_processed`. */
  type: string;
  /** Arbitrary event payload serialisable to JSON. */
  payload: unknown;
  /** ISO-8601 timestamp when the event was first created. */
  createdAt?: string;
}

/** Result of a single delivery attempt. */
export interface DeliveryResult {
  /** HTTP status code returned by the endpoint. */
  status: number;
}

/** Performs the actual HTTP POST to a downstream webhook endpoint. */
export type WebhookDeliverFn = (event: WebhookEvent) => Promise<DeliveryResult>;

/** Record held in the dead-letter queue. */
export interface DeadLetterEntry {
  event: WebhookEvent;
  /** Number of delivery attempts made before the event was dead-lettered. */
  attempts: number;
  /** HTTP status of the last attempt, or `undefined` if every attempt threw. */
  lastStatus?: number;
  /** ISO-8601 timestamp when the event was moved to the DLQ. */
  deadLetteredAt: string;
  /** Error messages from each attempt, oldest first. */
  errors: string[];
}

/** Injectable sleep — override in tests to avoid real timers. */
export type SleepFn = (ms: number) => Promise<void>;

export interface WebhookRetryQueueOptions {
  /** Delivery function (HTTP POST to the merchant endpoint). */
  deliver: WebhookDeliverFn;
  /**
   * Maximum delivery attempts before an event is dead-lettered.
   * Default: 5 (backoff sequence: 1 s, 2 s, 4 s, 8 s, 16 s).
   */
  maxAttempts?: number;
  /**
   * Base backoff delay in milliseconds.
   * Default: 1000 ms (doubles with each attempt: 1s, 2s, 4s, 8s, 16s).
   */
  baseDelayMs?: number;
  /**
   * Maximum backoff delay cap in milliseconds.
   * Default: 30_000 ms.
   */
  maxDelayMs?: number;
  /** Override the sleep implementation — useful in unit tests. */
  sleep?: SleepFn;
}

/** HTTP status codes that are worth retrying (transient failures). */
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function isRetryable(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
}

/**
 * WebhookRetryQueue
 *
 * Delivers events to a downstream HTTP endpoint with exponential-backoff
 * retries.  Events that exceed `maxAttempts` are moved to an in-memory
 * dead-letter queue accessible via `listDeadLetterEvents()` and
 * `replayDeadLetterEvent()`.
 *
 * In production, swap the in-memory DLQ for a persistent store (database table,
 * Redis list, SQS DLQ, etc.) by subclassing and overriding
 * `addToDeadLetterQueue` / `removeFromDeadLetterQueue` / `getDeadLetterEvent`.
 */
export class WebhookRetryQueue {
  private readonly deliver: WebhookDeliverFn;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly sleep: SleepFn;

  /** In-memory dead-letter store: eventId → entry. */
  private readonly dlq: Map<string, DeadLetterEntry> = new Map();

  constructor(options: WebhookRetryQueueOptions) {
    this.deliver = options.deliver;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.baseDelayMs = options.baseDelayMs ?? 1_000;
    this.maxDelayMs = options.maxDelayMs ?? 30_000;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  // ── Core delivery ────────────────────────────────────────────────────────

  /**
   * Enqueue an event for delivery.  Retries up to `maxAttempts` times with
   * exponential backoff.  On exhaustion, the event is dead-lettered.
   *
   * Resolves with `'delivered'` on success or `'dead-lettered'` when every
   * attempt fails.
   */
  async enqueue(event: WebhookEvent): Promise<'delivered' | 'dead-lettered'> {
    const enriched: WebhookEvent = {
      createdAt: new Date().toISOString(),
      ...event,
    };

    const errors: string[] = [];
    let lastStatus: number | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      let result: DeliveryResult | undefined;
      let threw = false;

      try {
        result = await this.deliver(enriched);
      } catch (err) {
        threw = true;
        errors.push(
          `attempt ${attempt}: threw — ${err instanceof Error ? err.message : String(err)}`
        );
      }

      if (result) {
        lastStatus = result.status;

        if (result.status >= 200 && result.status < 300) {
          // Successful delivery
          return 'delivered';
        }

        // Non-retryable 4xx — fail fast; no point retrying a 400/401/403
        if (!isRetryable(result.status)) {
          errors.push(`attempt ${attempt}: non-retryable status ${result.status}`);
          this.addToDeadLetterQueue(enriched, attempt, lastStatus, errors);
          return 'dead-lettered';
        }

        errors.push(`attempt ${attempt}: retryable status ${result.status}`);
      }

      // Not the last attempt — sleep with exponential backoff
      if (attempt < this.maxAttempts) {
        const delay = Math.min(
          this.baseDelayMs * Math.pow(2, attempt - 1),
          this.maxDelayMs
        );
        await this.sleep(delay);
      }
    }

    // All attempts exhausted
    this.addToDeadLetterQueue(enriched, this.maxAttempts, lastStatus, errors);
    return 'dead-lettered';
  }

  // ── Dead-letter queue — admin API ────────────────────────────────────────

  /**
   * Returns all events currently in the dead-letter queue, ordered by the time
   * they were dead-lettered (oldest first).
   */
  listDeadLetterEvents(): DeadLetterEntry[] {
    return Array.from(this.dlq.values()).sort(
      (a, b) =>
        new Date(a.deadLetteredAt).getTime() - new Date(b.deadLetteredAt).getTime()
    );
  }

  /**
   * Returns a single dead-letter entry by event ID, or `undefined` if the
   * event is not in the DLQ.
   */
  getDeadLetterEvent(eventId: string): DeadLetterEntry | undefined {
    return this.dlq.get(eventId);
  }

  /**
   * Manually replay a dead-letter event.  If delivery succeeds the event is
   * removed from the DLQ.  If it fails again it remains in the DLQ with an
   * updated attempt count and error log.
   *
   * @throws {Error} if `eventId` is not found in the DLQ.
   * @returns `'delivered'` on success, `'failed'` if the replay attempt failed.
   */
  async replayDeadLetterEvent(eventId: string): Promise<'delivered' | 'failed'> {
    const entry = this.dlq.get(eventId);
    if (!entry) {
      throw new Error(`Dead-letter event not found: ${eventId}`);
    }

    let result: DeliveryResult | undefined;
    let threw = false;

    try {
      result = await this.deliver(entry.event);
    } catch (err) {
      threw = true;
      entry.errors.push(
        `replay: threw — ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (result) {
      entry.lastStatus = result.status;
      if (result.status >= 200 && result.status < 300) {
        this.removeFromDeadLetterQueue(eventId);
        return 'delivered';
      }
      entry.errors.push(`replay: status ${result.status}`);
    }

    entry.attempts += 1;
    return 'failed';
  }

  /**
   * Remove all entries from the dead-letter queue.
   * Useful for tests or admin reset operations.
   */
  clearDeadLetterQueue(): void {
    this.dlq.clear();
  }

  // ── Overridable persistence hooks ────────────────────────────────────────

  protected addToDeadLetterQueue(
    event: WebhookEvent,
    attempts: number,
    lastStatus: number | undefined,
    errors: string[]
  ): void {
    const existing = this.dlq.get(event.id);
    this.dlq.set(event.id, {
      event,
      attempts: (existing?.attempts ?? 0) + attempts,
      lastStatus,
      deadLetteredAt: new Date().toISOString(),
      errors: [...(existing?.errors ?? []), ...errors],
    });
  }

  protected removeFromDeadLetterQueue(eventId: string): void {
    this.dlq.delete(eventId);
  }
}
