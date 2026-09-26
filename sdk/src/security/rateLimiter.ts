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
