/**
 * Secure cookie, transport and browser security headers (issue #897).
 *
 * Provides a single source of truth for the HTTP response headers that every
 * LumenFlow HTTP surface (payment-link pages, webhook receivers, dashboard API)
 * should emit, plus a hardened `Set-Cookie` serializer.
 *
 * The helpers are transport-agnostic: they return plain objects / strings so
 * they can be applied to Node's `http.ServerResponse`, Express, Fastify or an
 * edge runtime without pulling in a framework dependency.
 */

export interface SecurityHeaderOptions {
  /**
   * When true (default) emit `Strict-Transport-Security`. Disable only for
   * local plaintext development where HTTPS is unavailable.
   */
  hsts?: boolean;
  /** `max-age` for HSTS in seconds. Default: 2 years. */
  hstsMaxAge?: number;
  /** Add the `preload` directive to HSTS. Default: false. */
  hstsPreload?: boolean;
  /**
   * Content-Security-Policy value. Defaults to a strict self-only policy that
   * forbids inline script and framing.
   */
  contentSecurityPolicy?: string;
  /** `Referrer-Policy` value. Default: `strict-origin-when-cross-origin`. */
  referrerPolicy?: string;
  /** `Permissions-Policy` value. Default: disables camera, microphone, geolocation. */
  permissionsPolicy?: string;
}

const DEFAULT_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
  "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

const TWO_YEARS_SECONDS = 63_072_000;

/**
 * Build the recommended browser + transport security headers.
 *
 * @returns a header-name → header-value map, safe to spread into a response.
 */
export function buildSecurityHeaders(
  options: SecurityHeaderOptions = {}
): Record<string, string> {
  const {
    hsts = true,
    hstsMaxAge = TWO_YEARS_SECONDS,
    hstsPreload = false,
    contentSecurityPolicy = DEFAULT_CSP,
    referrerPolicy = "strict-origin-when-cross-origin",
    permissionsPolicy = "camera=(), microphone=(), geolocation=()",
  } = options;

  const headers: Record<string, string> = {
    "Content-Security-Policy": contentSecurityPolicy,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": referrerPolicy,
    "Permissions-Policy": permissionsPolicy,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };

  if (hsts) {
    if (!Number.isFinite(hstsMaxAge) || hstsMaxAge <= 0) {
      throw new Error("hstsMaxAge must be a positive number of seconds");
    }
    headers["Strict-Transport-Security"] =
      `max-age=${Math.floor(hstsMaxAge)}; includeSubDomains` +
      (hstsPreload ? "; preload" : "");
  }

  return headers;
}

export interface SecureCookieOptions {
  /** Cookie lifetime in seconds. Omit for a session cookie. */
  maxAge?: number;
  /** Path scope. Default: `/`. */
  path?: string;
  /** Domain scope. Omit to bind to the exact host. */
  domain?: string;
  /** SameSite policy. Default: `Strict`. */
  sameSite?: "Strict" | "Lax" | "None";
  /**
   * Mark the cookie `Secure`. Default: true. `SameSite=None` forces this on.
   */
  secure?: boolean;
  /**
   * Mark the cookie `HttpOnly` so it is unreadable from JavaScript.
   * Default: true.
   */
  httpOnly?: boolean;
}

const COOKIE_NAME_RE = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/;

/**
 * Serialize a `Set-Cookie` header value with secure defaults
 * (`Secure; HttpOnly; SameSite=Strict`).
 *
 * @throws if the cookie name or value contains characters that would allow
 *         header/cookie injection.
 */
export function serializeSecureCookie(
  name: string,
  value: string,
  options: SecureCookieOptions = {}
): string {
  if (!COOKIE_NAME_RE.test(name)) {
    throw new Error(`Invalid cookie name: ${JSON.stringify(name)}`);
  }
  if (/[\s;,"\\]/.test(value)) {
    throw new Error("Cookie value contains characters that must be encoded");
  }

  const {
    maxAge,
    path = "/",
    domain,
    sameSite = "Strict",
    httpOnly = true,
  } = options;
  const secure = sameSite === "None" ? true : options.secure ?? true;

  const parts = [`${name}=${value}`, `Path=${path}`];
  if (domain) parts.push(`Domain=${domain}`);
  if (maxAge !== undefined) {
    if (!Number.isInteger(maxAge) || maxAge < 0) {
      throw new Error("maxAge must be a non-negative integer");
    }
    parts.push(`Max-Age=${maxAge}`);
  }
  parts.push(`SameSite=${sameSite}`);
  if (secure) parts.push("Secure");
  if (httpOnly) parts.push("HttpOnly");

  return parts.join("; ");
}
