/**
 * Rate limiting for signature verification and authentication failures
 * (issue #898).
 *
 * A fixed-window failure counter keyed by an arbitrary identity string
 * (IP address, API key id, merchant address). Successful attempts reset the
 * counter; repeated failures lock the key out for a cooldown period, which
 * blunts brute-force attacks against signature/auth checks without needing an
 * external store for single-instance deployments.
 */

export interface RateLimitOptions {
  /** Failures allowed within the window before the key is locked. Default: 5. */
  maxFailures?: number;
  /** Rolling window length in milliseconds. Default: 60_000 (1 minute). */
  windowMs?: number;
  /** Lockout duration in milliseconds once `maxFailures` is exceeded. Default: 900_000 (15 minutes). */
  lockoutMs?: number;
  /** Injectable clock for testing. Default: `Date.now`. */
  now?: () => number;
}

export interface RateLimitStatus {
  /** true when the key is currently allowed to attempt. */
  allowed: boolean;
  /** Remaining failures before lockout (0 when locked). */
  remaining: number;
  /** Epoch ms when the current lockout ends, or null when not locked. */
  retryAt: number | null;
}

interface Entry {
  count: number;
  windowStart: number;
  lockedUntil: number;
}

export class FailureRateLimiter {
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly lockoutMs: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, Entry>();

  constructor(options: RateLimitOptions = {}) {
    this.maxFailures = options.maxFailures ?? 5;
    this.windowMs = options.windowMs ?? 60_000;
    this.lockoutMs = options.lockoutMs ?? 900_000;
    this.now = options.now ?? Date.now;
    if (this.maxFailures < 1) throw new Error("maxFailures must be >= 1");
  }

  /** Non-mutating check of whether `key` may attempt right now. */
  check(key: string): RateLimitStatus {
    const entry = this.entries.get(key);
    const t = this.now();
    if (!entry) {
      return { allowed: true, remaining: this.maxFailures, retryAt: null };
    }
    if (entry.lockedUntil > t) {
      return { allowed: false, remaining: 0, retryAt: entry.lockedUntil };
    }
    if (t - entry.windowStart >= this.windowMs) {
      return { allowed: true, remaining: this.maxFailures, retryAt: null };
    }
    return {
      allowed: true,
      remaining: Math.max(0, this.maxFailures - entry.count),
      retryAt: null,
    };
  }

  /** Record a failed verification/auth attempt. Returns the updated status. */
  recordFailure(key: string): RateLimitStatus {
    const t = this.now();
    let entry = this.entries.get(key);

    if (!entry || t - entry.windowStart >= this.windowMs) {
      entry = { count: 0, windowStart: t, lockedUntil: 0 };
      this.entries.set(key, entry);
    }
    if (entry.lockedUntil > t) {
      return { allowed: false, remaining: 0, retryAt: entry.lockedUntil };
    }

    entry.count += 1;
    if (entry.count >= this.maxFailures) {
      entry.lockedUntil = t + this.lockoutMs;
      return { allowed: false, remaining: 0, retryAt: entry.lockedUntil };
    }
    return {
      allowed: true,
      remaining: this.maxFailures - entry.count,
      retryAt: null,
    };
  }

  /** Clear a key's failure history after a successful attempt. */
  recordSuccess(key: string): void {
    this.entries.delete(key);
  }

  /** Drop entries whose window and lockout have both elapsed. */
  prune(): void {
    const t = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.lockedUntil <= t && t - entry.windowStart >= this.windowMs) {
        this.entries.delete(key);
      }
    }
  }
}

/** Default outbound webhook deliveries allowed per merchant per window. */
export const DEFAULT_WEBHOOK_DELIVERIES_PER_MINUTE = 100;

export interface WebhookDeliveryRateLimiterOptions {
  /** Deliveries allowed per merchant within the window. Default: 100. */
  maxDeliveries?: number;
  /** Window length in milliseconds. Default: 60_000 (1 minute). */
  windowMs?: number;
  /** Injectable clock for testing. Default: `Date.now`. */
  now?: () => number;
}

export interface WebhookDeliveryStatus {
  /** true when the merchant may send a delivery right now. */
  allowed: boolean;
  /** Remaining deliveries in the current window (0 when exhausted). */
  remaining: number;
  /** Epoch ms when the current window resets, or null when not exhausted. */
  retryAt: number | null;
  /** Number of deliveries currently queued for the merchant. */
  queued: number;
}

interface DeliveryWindow {
  count: number;
  windowStart: number;
}

/**
 * Per-merchant rate limiter for outbound webhook delivery (issue #1543).
 *
 * Caps deliveries at `maxDeliveries` per merchant per `windowMs` (default
 * 100/minute) so a compromised or buggy endpoint cannot amplify traffic.
 * Deliveries that exceed the limit are queued via `queue` rather than
 * dropped; `drain` releases them once the window resets.
 */
export class WebhookDeliveryRateLimiter {
  private readonly maxDeliveries: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly windows = new Map<string, DeliveryWindow>();
  private readonly queues = new Map<string, unknown[]>();

  constructor(options: WebhookDeliveryRateLimiterOptions = {}) {
    this.maxDeliveries =
      options.maxDeliveries ?? DEFAULT_WEBHOOK_DELIVERIES_PER_MINUTE;
    this.windowMs = options.windowMs ?? 60_000;
    this.now = options.now ?? Date.now;
    if (this.maxDeliveries < 1) throw new Error("maxDeliveries must be >= 1");
    if (this.windowMs < 1) throw new Error("windowMs must be >= 1");
  }

  private currentWindow(merchant: string): DeliveryWindow {
    const t = this.now();
    let win = this.windows.get(merchant);
    if (!win || t - win.windowStart >= this.windowMs) {
      win = { count: 0, windowStart: t };
      this.windows.set(merchant, win);
    }
    return win;
  }

  /** Non-mutating check of whether `merchant` may deliver right now. */
  check(merchant: string): WebhookDeliveryStatus {
    const win = this.currentWindow(merchant);
    const queued = this.queues.get(merchant)?.length ?? 0;
    const remaining = Math.max(0, this.maxDeliveries - win.count);
    if (remaining === 0) {
      return {
        allowed: false,
        remaining: 0,
        retryAt: win.windowStart + this.windowMs,
        queued,
      };
    }
    return { allowed: true, remaining, retryAt: null, queued };
  }

  /**
   * Attempt to reserve a delivery slot for `merchant`. Returns true when the
   * delivery may proceed immediately; false when the limit is exhausted (the
   * caller should then `queue` the delivery).
   */
  allow(merchant: string): boolean {
    const win = this.currentWindow(merchant);
    if (win.count >= this.maxDeliveries) return false;
    win.count += 1;
    return true;
  }

  /** Enqueue a delivery that exceeded the limit instead of dropping it. */
  queue(merchant: string, delivery: unknown): void {
    let q = this.queues.get(merchant);
    if (!q) {
      q = [];
      this.queues.set(merchant, q);
    }
    q.push(delivery);
  }

  /**
   * Release queued deliveries for `merchant` once the window has reset,
   * reserving slots for up to the remaining allowance. Returns the deliveries
   * that may now be sent (empty while the window is still exhausted).
   */
  drain(merchant: string): unknown[] {
    const q = this.queues.get(merchant);
    if (!q || q.length === 0) return [];
    const win = this.currentWindow(merchant);
    const available = Math.max(0, this.maxDeliveries - win.count);
    if (available === 0) return [];
    const released = q.splice(0, available);
    win.count += released.length;
    if (q.length === 0) this.queues.delete(merchant);
    return released;
  }

  /** Number of deliveries currently queued for `merchant`. */
  queuedCount(merchant: string): number {
    return this.queues.get(merchant)?.length ?? 0;
  }

  /** Drop windows whose period has elapsed and empty queues. */
  prune(): void {
    const t = this.now();
    for (const [merchant, win] of this.windows) {
      if (t - win.windowStart >= this.windowMs) {
        this.windows.delete(merchant);
      }
    }
    for (const [merchant, q] of this.queues) {
      if (q.length === 0) this.queues.delete(merchant);
    }
  }
}
