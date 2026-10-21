/**
 * LumenFlow SDK — Webhook delivery and retry status tracking.
 *
 * Provides a {@link WebhookStatusTracker} that wraps {@link WebhookRelay} and
 * records per-event delivery history.  The merchant dashboard can query
 * {@link WebhookStatusTracker.getStatus} and
 * {@link WebhookStatusTracker.listStatuses} to show delivery state, attempt
 * count, last HTTP status code, and whether the relay will retry.
 *
 * Integration points
 * ------------------
 * - Wrap your existing {@link WebhookRelay} with a {@link WebhookStatusTracker}.
 * - Call `tracker.relay(event)` instead of `relay.relay(event)`.
 * - Query `tracker.getStatus(key)` to render per-event state in the dashboard.
 * - Call `tracker.listStatuses()` with optional filters for table/list views.
 *
 * Closes #801.
 */

import { WebhookRelay, RelayEvent, RelayOutcome, WebhookDeliveryError, idempotencyKey } from './webhookRelay';

/** Lifecycle state of a single webhook delivery. */
export type WebhookDeliveryState =
  | 'pending'      // relay has not yet attempted delivery
  | 'delivering'   // at least one attempt in progress / backoff between retries
  | 'delivered'    // successfully acknowledged by the downstream endpoint
  | 'duplicate'    // dropped — already delivered previously
  | 'failed';      // all retries exhausted or a permanent error was returned

export interface WebhookAttemptRecord {
  /** 1-based attempt number. */
  attempt: number;
  /** HTTP status returned by the endpoint, or undefined if the attempt threw. */
  httpStatus?: number;
  /** Whether this attempt succeeded. */
  success: boolean;
  /** ISO timestamp of the attempt. */
  timestamp: string;
  /** Error message if the attempt threw or returned a non-2xx non-retryable code. */
  error?: string;
}

export interface WebhookDeliveryStatus {
  /** Idempotency key for the event. */
  key: string;
  /** Human-readable event type, if provided. */
  eventType?: string;
  state: WebhookDeliveryState;
  /** Total number of delivery attempts made so far. */
  totalAttempts: number;
  /** HTTP status from the most recent attempt. */
  lastHttpStatus?: number;
  /** Whether the relay will attempt delivery again. */
  willRetry: boolean;
  /** Detailed per-attempt history. */
  attempts: WebhookAttemptRecord[];
  /** ISO timestamp of the first delivery attempt. */
  firstAttemptAt?: string;
  /** ISO timestamp of the most recent delivery attempt. */
  lastAttemptAt?: string;
  /** ISO timestamp of successful delivery (if any). */
  deliveredAt?: string;
  /** Error message when state is `failed`. */
  errorMessage?: string;
}

export interface ListStatusOptions {
  state?: WebhookDeliveryState;
  /** Max number of entries to return. Default: 50. */
  limit?: number;
  /** Return entries with `lastAttemptAt` on or after this ISO timestamp. */
  since?: string;
}

/**
 * Wraps a {@link WebhookRelay} and records per-event delivery status for
 * display in the merchant dashboard.
 */
export class WebhookStatusTracker {
  private readonly relay: WebhookRelay;
  private readonly store = new Map<string, WebhookDeliveryStatus>();

  constructor(relay: WebhookRelay) {
    this.relay = relay;
  }

  /**
   * Relay an event and update its delivery status record.
   * Mirrors the {@link WebhookRelay.relay} signature exactly.
   */
  async relay(event: RelayEvent): Promise<RelayOutcome> {
    const key = idempotencyKey(event);
    if (!key) {
      throw new TypeError('relay event is missing an idempotency key (pagingToken or id)');
    }

    this.ensureRecord(key, event);
    const record = this.store.get(key)!;
    record.state = 'delivering';

    try {
      const outcome = await this.relay_inner(event);

      if (outcome.status === 'duplicate') {
        record.state = 'duplicate';
        record.willRetry = false;
      } else {
        record.state = 'delivered';
        record.willRetry = false;
        record.deliveredAt = new Date().toISOString();
        record.totalAttempts = outcome.attempts;
      }

      return outcome;
    } catch (err) {
      record.state = 'failed';
      record.willRetry = false;
      if (err instanceof WebhookDeliveryError) {
        record.totalAttempts = err.attempts;
        record.lastHttpStatus = err.lastStatus;
        record.errorMessage = err.message;
        const attemptRecord: WebhookAttemptRecord = {
          attempt: err.attempts,
          httpStatus: err.lastStatus,
          success: false,
          timestamp: new Date().toISOString(),
          error: err.message,
        };
        record.attempts.push(attemptRecord);
        record.lastAttemptAt = attemptRecord.timestamp;
      }
      throw err;
    }
  }

  private async relay_inner(event: RelayEvent): Promise<RelayOutcome> {
    return this.relay.relay(event);
  }

  /**
   * Relay a batch of events, recording status for each.
   */
  async relayBatch(events: RelayEvent[]): Promise<RelayOutcome[]> {
    const outcomes: RelayOutcome[] = [];
    for (const event of events) {
      outcomes.push(await this.relay(event));
    }
    return outcomes;
  }

  /** Get the delivery status for a single event key. Returns undefined if unknown. */
  getStatus(key: string): WebhookDeliveryStatus | undefined {
    return this.store.get(key);
  }

  /**
   * List all tracked delivery statuses, with optional filtering.
   * Results are sorted by `lastAttemptAt` descending (most recent first).
   */
  listStatuses(options: ListStatusOptions = {}): WebhookDeliveryStatus[] {
    const { state, limit = 50, since } = options;
    let entries = Array.from(this.store.values());

    if (state !== undefined) {
      entries = entries.filter((e) => e.state === state);
    }

    if (since !== undefined) {
      entries = entries.filter(
        (e) => e.lastAttemptAt !== undefined && e.lastAttemptAt >= since,
      );
    }

    entries.sort((a, b) => {
      const ta = a.lastAttemptAt ?? '';
      const tb = b.lastAttemptAt ?? '';
      return tb.localeCompare(ta);
    });

    return entries.slice(0, limit);
  }

  /** Total count of events in a given state. */
  countByState(state: WebhookDeliveryState): number {
    let count = 0;
    for (const entry of this.store.values()) {
      if (entry.state === state) count++;
    }
    return count;
  }

  /**
   * Summary suitable for rendering a dashboard header widget.
   */
  summary(): {
    total: number;
    delivered: number;
    failed: number;
    delivering: number;
    duplicate: number;
  } {
    return {
      total: this.store.size,
      delivered: this.countByState('delivered'),
      failed: this.countByState('failed'),
      delivering: this.countByState('delivering'),
      duplicate: this.countByState('duplicate'),
    };
  }

  private ensureRecord(key: string, event: RelayEvent): void {
    if (!this.store.has(key)) {
      const now = new Date().toISOString();
      this.store.set(key, {
        key,
        eventType: event.type,
        state: 'pending',
        totalAttempts: 0,
        willRetry: true,
        attempts: [],
        firstAttemptAt: now,
        lastAttemptAt: now,
      });
    }
  }
}
