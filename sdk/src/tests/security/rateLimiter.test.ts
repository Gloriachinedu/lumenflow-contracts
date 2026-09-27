import { FailureRateLimiter } from "../../security/rateLimiter";

describe("FailureRateLimiter", () => {
  let clock: number;
  const now = () => clock;

  beforeEach(() => {
    clock = 1_000_000;
  });

  it("allows attempts until maxFailures is reached, then locks out", () => {
    const rl = new FailureRateLimiter({ maxFailures: 3, now });
    expect(rl.recordFailure("ip").allowed).toBe(true); // 1
    expect(rl.recordFailure("ip").allowed).toBe(true); // 2
    const third = rl.recordFailure("ip"); // 3 -> lockout
    expect(third.allowed).toBe(false);
    expect(third.retryAt).toBe(clock + 900_000);
    expect(rl.check("ip").allowed).toBe(false);
  });

  it("reports remaining attempts", () => {
    const rl = new FailureRateLimiter({ maxFailures: 5, now });
    rl.recordFailure("k");
    expect(rl.check("k").remaining).toBe(4);
  });

  it("resets the counter after a successful attempt", () => {
    const rl = new FailureRateLimiter({ maxFailures: 3, now });
    rl.recordFailure("k");
    rl.recordFailure("k");
    rl.recordSuccess("k");
    expect(rl.check("k").remaining).toBe(3);
    expect(rl.recordFailure("k").allowed).toBe(true);
  });

  it("clears failures once the rolling window elapses", () => {
    const rl = new FailureRateLimiter({ maxFailures: 3, windowMs: 60_000, now });
    rl.recordFailure("k");
    rl.recordFailure("k");
    clock += 60_001;
    expect(rl.check("k").remaining).toBe(3);
    expect(rl.recordFailure("k").allowed).toBe(true);
  });

  it("lifts the lockout after lockoutMs", () => {
    const rl = new FailureRateLimiter({
      maxFailures: 2,
      lockoutMs: 10_000,
      now,
    });
    rl.recordFailure("k");
    rl.recordFailure("k"); // locked
    expect(rl.check("k").allowed).toBe(false);
    clock += 10_001;
    expect(rl.check("k").allowed).toBe(true);
  });

  it("tracks identities independently", () => {
    const rl = new FailureRateLimiter({ maxFailures: 1, now });
    rl.recordFailure("a"); // a locked
    expect(rl.check("a").allowed).toBe(false);
    expect(rl.check("b").allowed).toBe(true);
  });

  it("rejects an invalid maxFailures", () => {
    expect(() => new FailureRateLimiter({ maxFailures: 0 })).toThrow();
  });
});
