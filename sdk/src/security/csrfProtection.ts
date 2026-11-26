/**
 * CSRF protection for cookie-authenticated browser endpoints (issue #896).
 *
 * LumenFlow's dashboard and payment-link pages authenticate browsers with a
 * `Secure; HttpOnly; SameSite` session cookie. `SameSite` alone is not a
 * complete defence (older browsers, `SameSite=None` embeds, same-site
 * subdomain takeover), so state-changing requests must also carry an
 * unforgeable CSRF token.
 *
 * This implements the signed double-submit-cookie pattern: a token is minted
 * from the session id and a server-side secret, sent both as a non-HttpOnly
 * cookie and echoed back by the page in a header/form field, and verified with
 * a constant-time comparison. No server-side token store is required.
 */

import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/** HTTP methods that never mutate state and are exempt from CSRF checks. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

export interface CsrfTokenOptions {
  /** Token lifetime in seconds. Default: 43_200 (12 hours). */
  ttlSeconds?: number;
  /** Injectable clock (ms) for testing. Default: `Date.now`. */
  now?: () => number;
}

export interface CsrfVerifyOptions extends CsrfTokenOptions {
  /** Request method; safe methods short-circuit to `valid`. */
  method?: string;
}

export interface CsrfResult {
  valid: boolean;
  /** Reason for rejection, empty when `valid`. */
  error: string;
}

const OK: CsrfResult = { valid: true, error: "" };
const fail = (error: string): CsrfResult => ({ valid: false, error });

/** True for methods that are safe to serve without a CSRF token. */
export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(String(method).toUpperCase());
}

function sign(sessionId: string, nonce: string, expEpochMs: number, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${sessionId}.${nonce}.${expEpochMs}`)
    .digest("base64url");
}

/**
 * Mint a CSRF token bound to `sessionId` and `secret`.
 *
 * @throws if `sessionId` or `secret` is empty.
 */
export function createCsrfToken(
  sessionId: string,
  secret: string,
  options: CsrfTokenOptions = {}
): string {
  if (typeof sessionId !== "string" || sessionId === "") {
    throw new Error("sessionId must be a non-empty string");
  }
  if (typeof secret !== "string" || secret.length < 16) {
    throw new Error("secret must be at least 16 characters");
  }
  const now = options.now ?? Date.now;
  const ttl = options.ttlSeconds ?? 43_200;
  const exp = now() + ttl * 1000;
  const nonce = randomBytes(16).toString("base64url");
  return `${nonce}.${exp}.${sign(sessionId, nonce, exp, secret)}`;
}

/**
 * Verify a submitted CSRF token against the session and secret.
 *
 * `submittedToken` is the value echoed by the page (header or form field);
 * `cookieToken` is the double-submit cookie value. Both must be present, equal,
 * unexpired and correctly signed for the current session.
 */
export function verifyCsrfToken(
  submittedToken: string | undefined | null,
  cookieToken: string | undefined | null,
  sessionId: string,
  secret: string,
  options: CsrfVerifyOptions = {}
): CsrfResult {
  if (options.method && isSafeMethod(options.method)) return OK;
  if (!sessionId || !secret) return fail("missing session or secret");
  if (!submittedToken) return fail("missing CSRF token in request");
  if (!cookieToken) return fail("missing CSRF cookie");
  if (!constantTimeEqual(submittedToken, cookieToken)) {
    return fail("CSRF token and cookie do not match");
  }

  const parts = submittedToken.split(".");
  if (parts.length !== 3) return fail("malformed CSRF token");
  const [nonce, expRaw, mac] = parts;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp)) return fail("malformed CSRF token");
  const now = options.now ?? Date.now;
  if (now() > exp) return fail("CSRF token expired");
  if (!constantTimeEqual(mac, sign(sessionId, nonce, exp, secret))) {
    return fail("CSRF token signature is invalid");
  }
  return OK;
}

/** Length-safe constant-time string comparison. */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Default name of the double-submit CSRF cookie. */
export const DEFAULT_CSRF_COOKIE_NAME = "csrf_token";

export interface CsrfCookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict";
  path: string;
}

/**
 * Cookie attributes for the double-submit CSRF cookie.
 *
 * `SameSite=Strict` prevents the cookie from being sent on cross-site
 * requests; `Secure` keeps it off plaintext channels. The cookie is
 * `HttpOnly` because the page reads the token from a separate source (e.g.
 * a meta tag or a dedicated endpoint) rather than from `document.cookie`.
 */
export function csrfCookieOptions(): CsrfCookieOptions {
  return { httpOnly: true, secure: true, sameSite: "Strict", path: "/" };
}

/** Minimal request shape accepted by the middleware (framework-agnostic). */
export interface CsrfRequestLike {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

/** Minimal response shape accepted by the middleware (framework-agnostic). */
export interface CsrfResponseLike {
  statusCode?: number;
  setHeader?: (name: string, value: string | string[]) => void;
  end?: (body?: string) => void;
  status?: (code: number) => CsrfResponseLike;
  json?: (body: unknown) => void;
}

export type CsrfNext = (err?: unknown) => void;

export interface CsrfMiddlewareOptions {
  /** Extract the authenticated session id from the request. */
  getSessionId: (req: CsrfRequestLike) => string | undefined | null;
  /** Return the server-side signing secret. */
  getSecret: () => string;
  /** Extract the token echoed by the page. Defaults to header then body. */
  getSubmittedToken?: (req: CsrfRequestLike) => string | undefined | null;
  /** Extract the double-submit cookie value. Defaults to parsing `cookie`. */
  getCookieToken?: (req: CsrfRequestLike) => string | undefined | null;
  /** Name of the double-submit cookie. Default: `csrf_token`. */
  cookieName?: string;
  /** Injectable clock (ms) for testing. */
  now?: () => number;
}

function headerValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string
): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const value = headers[key];
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

/** Parse a `Cookie` header into a name→value map. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (!name) continue;
    out[name] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function defaultSubmittedToken(req: CsrfRequestLike): string | undefined {
  const fromHeader = headerValue(req.headers, "x-csrf-token");
  if (fromHeader) return fromHeader;
  const body = req.body;
  if (body && typeof body === "object") {
    const value = (body as Record<string, unknown>).csrfToken;
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}

function defaultCookieToken(
  req: CsrfRequestLike,
  cookieName: string
): string | undefined {
  return parseCookies(headerValue(req.headers, "cookie"))[cookieName];
}

/**
 * Build a framework-agnostic CSRF middleware.
 *
 * Safe methods (GET/HEAD/OPTIONS/TRACE) pass through untouched. All other
 * methods are validated with {@link verifyCsrfToken}; failures respond with
 * HTTP 403 and a JSON body `{ error, reason }`.
 */
export function csrfMiddleware(
  options: CsrfMiddlewareOptions
): (req: CsrfRequestLike, res: CsrfResponseLike, next: CsrfNext) => void {
  const cookieName = options.cookieName ?? DEFAULT_CSRF_COOKIE_NAME;
  const getSubmittedToken = options.getSubmittedToken ?? defaultSubmittedToken;
  const getCookieToken =
    options.getCookieToken ?? ((req: CsrfRequestLike) => defaultCookieToken(req, cookieName));

  return (req, res, next) => {
    if (isSafeMethod(req.method ?? "GET")) {
      next();
      return;
    }

    const sessionId = options.getSessionId(req) ?? "";
    const secret = options.getSecret();
    const result = verifyCsrfToken(
      getSubmittedToken(req),
      getCookieToken(req),
      sessionId,
      secret,
      { method: req.method, now: options.now }
    );

    if (!result.valid) {
      const payload = JSON.stringify({
        error: "CSRF validation failed",
        reason: result.error,
      });
      if (typeof res.status === "function" && typeof res.json === "function") {
        res.status(403).json({ error: "CSRF validation failed", reason: result.error });
      } else {
        res.statusCode = 403;
        res.setHeader?.("Content-Type", "application/json");
        res.end?.(payload);
      }
      return;
    }

    next();
  };
}

/**
 * Append a `Set-Cookie` header carrying the double-submit CSRF token.
 *
 * Uses {@link csrfCookieOptions} so the cookie is `SameSite=Strict; Secure;
 * HttpOnly; Path=/`.
 */
export function setCsrfCookie(
  res: CsrfResponseLike,
  token: string,
  cookieName: string = DEFAULT_CSRF_COOKIE_NAME
): void {
  const opts = csrfCookieOptions();
  const parts = [
    `${cookieName}=${encodeURIComponent(token)}`,
    `Path=${opts.path}`,
    `SameSite=${opts.sameSite}`,
  ];
  if (opts.secure) parts.push("Secure");
  if (opts.httpOnly) parts.push("HttpOnly");
  const cookie = parts.join("; ");

  const existing = (res as { getHeader?: (name: string) => unknown }).getHeader?.(
    "Set-Cookie"
  );
  const prior = Array.isArray(existing)
    ? (existing as string[])
    : typeof existing === "string"
      ? [existing]
      : [];
  res.setHeader?.("Set-Cookie", [...prior, cookie]);
}
