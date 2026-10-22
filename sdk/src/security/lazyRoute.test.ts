/**
 * Tests for lazy-loading security module routes.
 * Verifies that modules are loaded on demand and cached correctly.
 */

import { security } from "./lazyRoute";

describe("security lazy routes", () => {
  it("loads abuseDetection on demand and returns createAbuseDetector", async () => {
    const mod = await security.abuseDetection();
    expect(typeof mod.createAbuseDetector).toBe("function");
  });

  it("abuseDetection is cached — returns the same promise on repeated calls", () => {
    const p1 = security.abuseDetection();
    const p2 = security.abuseDetection();
    expect(p1).toBe(p2);
  });

  it("loads dataEncryption on demand and returns encrypt/decrypt", async () => {
    const mod = await security.dataEncryption();
    expect(typeof mod.encrypt).toBe("function");
    expect(typeof mod.decrypt).toBe("function");
  });

  it("dataEncryption is cached", () => {
    const p1 = security.dataEncryption();
    const p2 = security.dataEncryption();
    expect(p1).toBe(p2);
  });

  it("loads csrfProtection on demand and returns generateCsrfToken", async () => {
    const mod = await security.csrfProtection();
    expect(typeof mod.generateCsrfToken).toBe("function");
    expect(typeof mod.validateCsrfToken).toBe("function");
  });

  it("csrfProtection is cached", () => {
    const p1 = security.csrfProtection();
    const p2 = security.csrfProtection();
    expect(p1).toBe(p2);
  });

  it("loads rateLimiter on demand and returns RateLimiter class", async () => {
    const mod = await security.rateLimiter();
    expect(typeof mod.RateLimiter).toBe("function");
  });

  it("rateLimiter is cached", () => {
    const p1 = security.rateLimiter();
    const p2 = security.rateLimiter();
    expect(p1).toBe(p2);
  });

  it("abuseDetection module works after lazy load", async () => {
    const { createAbuseDetector } = await security.abuseDetection();
    const detector = createAbuseDetector({ maxRequestsPerMinute: 5 });
    for (let i = 0; i < 5; i++) {
      expect(detector.check()).toBe(true);
    }
    expect(detector.check()).toBe(false);
    detector.reset();
    expect(detector.check()).toBe(true);
  });

  it("dataEncryption module round-trips after lazy load", async () => {
    const { encrypt, decrypt } = await security.dataEncryption();
    const original = "hello lumenflow";
    expect(decrypt(encrypt(original, "key"), "key")).toBe(original);
  });

  it("csrfProtection module generates and validates tokens after lazy load", async () => {
    const { generateCsrfToken, validateCsrfToken } = await security.csrfProtection();
    const token = generateCsrfToken();
    expect(token).toHaveLength(64);
    expect(validateCsrfToken(token, token)).toBe(true);
    expect(validateCsrfToken(token, "wrong")).toBe(false);
  });

  it("rateLimiter module enforces limits after lazy load", async () => {
    const { RateLimiter } = await security.rateLimiter();
    const limiter = new RateLimiter({ maxRequests: 3, windowMs: 5000 });
    expect(limiter.allow()).toBe(true);
    expect(limiter.allow()).toBe(true);
    expect(limiter.allow()).toBe(true);
    expect(limiter.allow()).toBe(false);
    limiter.reset();
    expect(limiter.allow()).toBe(true);
  });
});
