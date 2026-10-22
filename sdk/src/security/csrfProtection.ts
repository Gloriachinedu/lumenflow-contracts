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
