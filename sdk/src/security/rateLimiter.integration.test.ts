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
