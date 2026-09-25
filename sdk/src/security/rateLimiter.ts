/**
 * Client-side rate limiter for SDK operations.
 * Prevents burst abuse by limiting calls within a sliding window.
 */

export interface RateLimiterOptions {
  /** Maximum number of requests allowed within the window. Default: 10 */
  maxRequests: number;
  /** Window duration in milliseconds. Default: 1000 (1 second) */
  windowMs: number;
}

export class RateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private timestamps: number[] = [];

  constructor(options: RateLimiterOptions = { maxRequests: 10, windowMs: 1000 }) {
    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowMs;
  }

  /**
   * Returns true if the request is allowed, false if rate-limited.
   */
  allow(): boolean {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    this.timestamps = this.timestamps.filter((t) => t >= windowStart);
    if (this.timestamps.length >= this.maxRequests) {
      return false;
    }
    this.timestamps.push(now);
    return true;
  }

  /**
   * Resets the rate limiter state.
   */
  reset(): void {
    this.timestamps = [];
  }

  /**
   * Returns the number of requests in the current window.
   */
  get currentCount(): number {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    return this.timestamps.filter((t) => t >= windowStart).length;
  }
}
