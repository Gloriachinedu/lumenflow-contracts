import {
  createCsrfToken,
  verifyCsrfToken,
  isSafeMethod,
} from "../../security/csrfProtection";

const SECRET = "test-secret-at-least-16-chars";

describe("csrfProtection", () => {
  it("accepts a token that matches its double-submit cookie for the session", () => {
    const token = createCsrfToken("session-1", SECRET);
    expect(verifyCsrfToken(token, token, "session-1", SECRET)).toEqual({
      valid: true,
      error: "",
    });
  });

  it("exempts safe methods without a token", () => {
    expect(isSafeMethod("get")).toBe(true);
    expect(
      verifyCsrfToken(undefined, undefined, "s", SECRET, { method: "GET" }).valid
    ).toBe(true);
  });

  it("rejects a missing token on a state-changing request", () => {
    const r = verifyCsrfToken(undefined, "x", "s", SECRET, { method: "POST" });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("missing CSRF token");
  });

  it("rejects a token/cookie mismatch", () => {
    const a = createCsrfToken("s", SECRET);
    const b = createCsrfToken("s", SECRET);
    expect(verifyCsrfToken(a, b, "s", SECRET).valid).toBe(false);
  });

  it("rejects a token bound to a different session", () => {
    const token = createCsrfToken("session-1", SECRET);
    const r = verifyCsrfToken(token, token, "session-2", SECRET);
    expect(r.valid).toBe(false);
    expect(r.error).toContain("signature");
  });

  it("rejects an expired token", () => {
    let clock = 1_000_000;
    const token = createCsrfToken("s", SECRET, {
      ttlSeconds: 1,
      now: () => clock,
    });
    clock += 5_000;
    const r = verifyCsrfToken(token, token, "s", SECRET, { now: () => clock });
    expect(r.error).toContain("expired");
  });
});
