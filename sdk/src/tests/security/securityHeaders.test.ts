import {
  buildSecurityHeaders,
  serializeSecureCookie,
} from "../../security/securityHeaders";

describe("buildSecurityHeaders", () => {
  it("emits the core browser hardening headers by default", () => {
    const h = buildSecurityHeaders();
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(h["Cross-Origin-Opener-Policy"]).toBe("same-origin");
  });

  it("includes HSTS with a 2-year max-age and includeSubDomains by default", () => {
    const h = buildSecurityHeaders();
    expect(h["Strict-Transport-Security"]).toBe(
      "max-age=63072000; includeSubDomains"
    );
  });

  it("adds the preload directive when requested", () => {
    const h = buildSecurityHeaders({ hstsPreload: true });
    expect(h["Strict-Transport-Security"]).toContain("; preload");
  });

  it("omits HSTS when disabled (local plaintext dev)", () => {
    const h = buildSecurityHeaders({ hsts: false });
    expect(h["Strict-Transport-Security"]).toBeUndefined();
  });

  it("rejects a non-positive HSTS max-age", () => {
    expect(() => buildSecurityHeaders({ hstsMaxAge: 0 })).toThrow();
  });
});

describe("serializeSecureCookie", () => {
  it("applies Secure, HttpOnly and SameSite=Strict by default", () => {
    expect(serializeSecureCookie("sid", "abc123")).toBe(
      "sid=abc123; Path=/; SameSite=Strict; Secure; HttpOnly"
    );
  });

  it("serializes Max-Age and Domain when provided", () => {
    const c = serializeSecureCookie("sid", "abc", {
      maxAge: 3600,
      domain: "pay.lumenflow.io",
    });
    expect(c).toContain("Max-Age=3600");
    expect(c).toContain("Domain=pay.lumenflow.io");
  });

  it("forces Secure when SameSite=None", () => {
    const c = serializeSecureCookie("sid", "abc", {
      sameSite: "None",
      secure: false,
    });
    expect(c).toContain("SameSite=None");
    expect(c).toContain("Secure");
  });

  it("rejects a cookie name with control/separator characters (injection)", () => {
    expect(() => serializeSecureCookie("bad name", "v")).toThrow();
    expect(() => serializeSecureCookie("sid", "a;b")).toThrow();
  });

  it("rejects a negative or non-integer maxAge", () => {
    expect(() => serializeSecureCookie("sid", "a", { maxAge: -1 })).toThrow();
  });
});
