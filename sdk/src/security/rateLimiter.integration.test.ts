/**
 * Integration tests: RateLimiter against the mock contract server.
 *
 * These tests verify that the client-side rate limiter correctly throttles
 * calls and that the mock server reflects the actual request count.
 *
 * Run via: jest rateLimiter.integration.test.ts
 * Also runs in CI via .github/workflows/sdk-release.yml
 */

import * as http from "http";
import { RateLimiter } from "./rateLimiter";
import { startMockServer } from "../../tests/mock-server/server";
import type { MockServer } from "../../tests/mock-server/server";

/**
 * Per-merchant webhook delivery limiter.
 *
 * Enforces a maximum number of outbound webhook deliveries per merchant per
 * minute. Deliveries that exceed the limit are queued (never dropped) and can
 * be drained once the merchant's window resets.
 */
class WebhookDeliveryLimiter {
  private readonly limiters = new Map<string, RateLimiter>();
  private readonly queues = new Map<string, Array<() => Promise<void>>>();

  constructor(
    private readonly maxRequests = 100,
    private readonly windowMs = 60_000
  ) {}

  private limiterFor(merchantId: string): RateLimiter {
    let limiter = this.limiters.get(merchantId);
    if (!limiter) {
      limiter = new RateLimiter({
        maxRequests: this.maxRequests,
        windowMs: this.windowMs,
      });
      this.limiters.set(merchantId, limiter);
    }
    return limiter;
  }

  private queueFor(merchantId: string): Array<() => Promise<void>> {
    let queue = this.queues.get(merchantId);
    if (!queue) {
      queue = [];
      this.queues.set(merchantId, queue);
    }
    return queue;
  }

  /** Number of deliveries currently waiting in a merchant's queue */
  queuedCount(merchantId: string): number {
    return this.queues.get(merchantId)?.length ?? 0;
  }

  /**
   * Attempt an outbound delivery. If the merchant is under the limit the
   * delivery runs immediately; otherwise it is queued and `false` is returned.
   */
  async deliver(merchantId: string, delivery: () => Promise<void>): Promise<boolean> {
    if (this.limiterFor(merchantId).allow()) {
      await delivery();
      return true;
    }
    this.queueFor(merchantId).push(delivery);
    return false;
  }

  /**
   * Drain queued deliveries for a merchant, running each one that the limiter
   * now permits. Returns the number of deliveries actually sent.
   */
  async drain(merchantId: string): Promise<number> {
    const queue = this.queueFor(merchantId);
    const limiter = this.limiterFor(merchantId);
    let sent = 0;
    while (queue.length > 0 && limiter.allow()) {
      const delivery = queue.shift()!;
      await delivery();
      sent++;
    }
    return sent;
  }
}

/** Simple helper: send a single request to the mock server */
function sendRequest(url: string): Promise<{ success: boolean }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
  });
}

/**
 * Attempt to send `n` requests through the rate limiter.
 * Returns counts of allowed vs blocked requests.
 */
async function sendBurst(
  limiter: RateLimiter,
  url: string,
  n: number
): Promise<{ allowed: number; blocked: number }> {
  let allowed = 0;
  let blocked = 0;
  for (let i = 0; i < n; i++) {
    if (limiter.allow()) {
      await sendRequest(url);
      allowed++;
    } else {
      blocked++;
    }
  }
  return { allowed, blocked };
}

describe("RateLimiter integration tests (mock contract server)", () => {
  let server: MockServer;

  beforeEach(async () => {
    server = await startMockServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it("burst of >N requests within window is throttled", async () => {
    const MAX = 5;
    const limiter = new RateLimiter({ maxRequests: MAX, windowMs: 5000 });

    const { allowed, blocked } = await sendBurst(limiter, server.url, MAX + 5);

    expect(allowed).toBe(MAX);
    expect(blocked).toBe(5);
    // Only the allowed requests actually hit the server
    expect(server.requestCount).toBe(MAX);
  });

  it("requests spread across window all succeed", async () => {
    const MAX = 3;
    // Wide window: requests won't expire during this test
    const limiter = new RateLimiter({ maxRequests: MAX, windowMs: 60_000 });

    const results: boolean[] = [];
    for (let i = 0; i < MAX; i++) {
      const allowed = limiter.allow();
      results.push(allowed);
      if (allowed) {
        await sendRequest(server.url);
      }
    }

    expect(results.every(Boolean)).toBe(true);
    expect(server.requestCount).toBe(MAX);
  });

  it("rate limit resets after window expires", async () => {
    const MAX = 2;
    const WINDOW_MS = 100; // very short window for testing
    const limiter = new RateLimiter({ maxRequests: MAX, windowMs: WINDOW_MS });

    // Fill the window
    for (let i = 0; i < MAX; i++) {
      expect(limiter.allow()).toBe(true);
    }
    expect(limiter.allow()).toBe(false);

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, WINDOW_MS + 50));

    // Should be allowed again
    expect(limiter.allow()).toBe(true);
    await sendRequest(server.url);
    expect(server.requestCount).toBe(1);
  });

  it("manual reset allows requests again immediately", async () => {
    const MAX = 2;
    const limiter = new RateLimiter({ maxRequests: MAX, windowMs: 10_000 });

    for (let i = 0; i < MAX; i++) limiter.allow();
    expect(limiter.allow()).toBe(false);

    limiter.reset();

    expect(limiter.allow()).toBe(true);
    await sendRequest(server.url);
    expect(server.requestCount).toBe(1);
  });
});

describe("Webhook delivery rate limiting (per merchant)", () => {
  let server: MockServer;

  beforeEach(async () => {
    server = await startMockServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it("throttles a burst of >100 deliveries to 100 and queues the rest", async () => {
    const limiter = new WebhookDeliveryLimiter();
    const MERCHANT = "merchant-a";
    const BURST = 150;

    let sent = 0;
    for (let i = 0; i < BURST; i++) {
      const delivered = await limiter.deliver(MERCHANT, async () => {
        await sendRequest(server.url);
        sent++;
      });
      if (!delivered) break;
    }

    expect(sent).toBe(100);
    expect(server.requestCount).toBe(100);
    expect(limiter.queuedCount(MERCHANT)).toBe(BURST - 100);
  });

  it("drains queued deliveries after the window resets", async () => {
    const WINDOW_MS = 100;
    const limiter = new WebhookDeliveryLimiter(100, WINDOW_MS);
    const MERCHANT = "merchant-b";

    for (let i = 0; i < 105; i++) {
      await limiter.deliver(MERCHANT, async () => {
        await sendRequest(server.url);
      });
    }

    expect(server.requestCount).toBe(100);
    expect(limiter.queuedCount(MERCHANT)).toBe(5);

    // Before the window resets, nothing can be drained
    expect(await limiter.drain(MERCHANT)).toBe(0);
    expect(limiter.queuedCount(MERCHANT)).toBe(5);

    // Wait for the window to expire, then drain the queue
    await new Promise((r) => setTimeout(r, WINDOW_MS + 50));

    const drained = await limiter.drain(MERCHANT);
    expect(drained).toBe(5);
    expect(limiter.queuedCount(MERCHANT)).toBe(0);
    expect(server.requestCount).toBe(105);
  });

  it("does not affect a second merchant's deliveries", async () => {
    const limiter = new WebhookDeliveryLimiter();
    const MERCHANT_A = "merchant-c";
    const MERCHANT_B = "merchant-d";

    // Exhaust merchant A's limit
    for (let i = 0; i < 100; i++) {
      await limiter.deliver(MERCHANT_A, async () => {
        await sendRequest(server.url);
      });
    }
    expect(server.requestCount).toBe(100);
    expect(limiter.queuedCount(MERCHANT_A)).toBe(0);

    // Merchant A is now throttled
    const aDelivered = await limiter.deliver(MERCHANT_A, async () => {
      await sendRequest(server.url);
    });
    expect(aDelivered).toBe(false);
    expect(limiter.queuedCount(MERCHANT_A)).toBe(1);
    expect(server.requestCount).toBe(100);

    // Merchant B is unaffected and can still deliver
    const bDelivered = await limiter.deliver(MERCHANT_B, async () => {
      await sendRequest(server.url);
    });
    expect(bDelivered).toBe(true);
    expect(server.requestCount).toBe(101);
    expect(limiter.queuedCount(MERCHANT_B)).toBe(0);
  });
});
