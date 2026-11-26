/**
 * Webhook signature verification helper.
 *
 * Provides constant-time HMAC-SHA256 signature verification to prevent
 * timing attacks when validating incoming webhook payloads.
 *
 * @see docs/webhook-integration.md
 */

import * as crypto from 'crypto';

/** Header name carrying the hex-encoded HMAC-SHA256 signature. */
export const WEBHOOK_SIGNATURE_HEADER = 'x-lumenflow-signature';

/** Environment variable holding the shared webhook secret. */
export const WEBHOOK_SECRET_ENV_VAR = 'LUMENFLOW_WEBHOOK_SECRET';

/**
 * Read the shared webhook secret from the environment.
 *
 * The secret must never be hard-coded; it is supplied via the
 * `LUMENFLOW_WEBHOOK_SECRET` environment variable.
 *
 * @param env - Environment object to read from (defaults to `process.env`).
 * @returns The shared secret.
 * @throws {Error} If the environment variable is unset or empty.
 */
export function getWebhookSecret(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const secret = env[WEBHOOK_SECRET_ENV_VAR];
  if (!secret || secret.trim() === '') {
    throw new Error(
      `getWebhookSecret: environment variable ${WEBHOOK_SECRET_ENV_VAR} must be set`,
    );
  }
  return secret;
}

/**
 * Extract the `X-LumenFlow-Signature` header from incoming request headers.
 *
 * Header lookup is case-insensitive. If the header appears multiple times,
 * the first value is used.
 *
 * @param headers - Request headers (Node `IncomingHttpHeaders`-like object).
 * @returns The signature string, or `undefined` if the header is absent.
 */
export function extractWebhookSignature(
  headers: Record<string, string | string[] | undefined> | undefined | null,
): string | undefined {
  if (!headers) {
    return undefined;
  }
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === WEBHOOK_SIGNATURE_HEADER) {
      const value = headers[key];
      const raw = Array.isArray(value) ? value[0] : value;
      if (typeof raw !== 'string' || raw.trim() === '') {
        return undefined;
      }
      return raw.trim();
    }
  }
  return undefined;
}

/**
 * Verify an incoming webhook request using its headers and raw body.
 *
 * Rejects requests missing the `X-LumenFlow-Signature` header. The HMAC is
 * computed over the raw request body (never the parsed JSON) so that any
 * byte-level tampering invalidates the signature.
 *
 * @param headers - Request headers.
 * @param rawBody - Raw request body as received (Buffer or string).
 * @param secret  - Shared secret (see {@link getWebhookSecret}).
 * @returns `true` if the request is authentic, `false` otherwise.
 */
export function verifyWebhookRequest(
  headers: Record<string, string | string[] | undefined> | undefined | null,
  rawBody: Buffer | string,
  secret: string,
): boolean {
  const signature = extractWebhookSignature(headers);
  if (!signature) {
    return false;
  }
  return verifyWebhookSignature(rawBody, signature, secret);
}

/** Default replay-protection window (5 minutes). */
export const DEFAULT_REPLAY_WINDOW_MS = 5 * 60 * 1000;

/**
 * Tracks recently seen webhook signatures to reject replays.
 *
 * A signature is considered a replay if it was already accepted within the
 * configured time window. Entries older than the window are pruned lazily.
 */
export class WebhookReplayGuard {
  private readonly seen = new Map<string, number>();
  private readonly windowMs: number;
  private readonly now: () => number;

  /**
   * @param windowMs - How long (ms) a signature is remembered. Defaults to 5 minutes.
   * @param now      - Clock function (injectable for tests). Defaults to `Date.now`.
   */
  constructor(windowMs: number = DEFAULT_REPLAY_WINDOW_MS, now: () => number = Date.now) {
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new Error('WebhookReplayGuard: windowMs must be a positive number');
    }
    this.windowMs = windowMs;
    this.now = now;
  }

  /**
   * Check whether a signature has already been seen within the window.
   *
   * @param signature - Hex-encoded signature from the request header.
   * @returns `true` if the signature is a replay.
   */
  isReplay(signature: string): boolean {
    this.prune();
    return this.seen.has(signature);
  }

  /**
   * Record a signature as seen. Call this only after the signature has been
   * verified, so unauthenticated requests cannot poison the cache.
   *
   * @param signature - Hex-encoded signature from the request header.
   */
  record(signature: string): void {
    this.prune();
    this.seen.set(signature, this.now());
  }

  /**
   * Verify a request and enforce replay protection in one step.
   *
   * @param headers - Request headers.
   * @param rawBody - Raw request body as received.
   * @param secret  - Shared secret.
   * @returns `true` if the request is authentic and not a replay.
   */
  verify(
    headers: Record<string, string | string[] | undefined> | undefined | null,
    rawBody: Buffer | string,
    secret: string,
  ): boolean {
    const signature = extractWebhookSignature(headers);
    if (!signature) {
      return false;
    }
    if (!verifyWebhookSignature(rawBody, signature, secret)) {
      return false;
    }
    if (this.isReplay(signature)) {
      return false;
    }
    this.record(signature);
    return true;
  }

  /** Remove entries older than the replay window. */
  private prune(): void {
    const cutoff = this.now() - this.windowMs;
    for (const [signature, timestamp] of this.seen) {
      if (timestamp < cutoff) {
        this.seen.delete(signature);
      }
    }
  }
}

/**
 * Verify a webhook payload's HMAC-SHA256 signature using a constant-time
=======
 * comparison to prevent timing attacks.
 *
 * @param payload  - Raw webhook body as a Buffer (or string converted to Buffer).
 * @param signature - Hex-encoded HMAC-SHA256 signature sent by the webhook source.
 * @param secret   - Shared secret used to compute the expected HMAC.
 * @returns `true` if the signature matches, `false` otherwise.
 * @throws {Error} If `payload` is null/undefined, `signature` is empty, or `secret` is empty.
 *
 * @example
 * ```ts
 * import { verifyWebhookSignature } from '@lumenflow/sdk';
 *
 * const rawBody = Buffer.from(JSON.stringify(event));
 * const valid = verifyWebhookSignature(rawBody, req.headers['x-lumenflow-signature'], process.env.WEBHOOK_SECRET);
 * if (!valid) {
 *   return res.status(401).send('Invalid signature');
 * }
 * ```
 */
export function verifyWebhookSignature(
  payload: Buffer | string,
  signature: string,
  secret: string,
): boolean {
  // ── Input validation ──────────────────────────────────────────────────────
  if (payload === null || payload === undefined) {
    throw new Error('verifyWebhookSignature: payload must not be null or undefined');
  }
  if (!signature || signature.trim() === '') {
    throw new Error('verifyWebhookSignature: signature must not be empty');
  }
  if (!secret || secret.length === 0) {
    throw new Error('verifyWebhookSignature: secret must not be empty');
  }

  // Normalise payload to Buffer
  const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);

  // Compute expected HMAC-SHA256
  const expectedHmac = crypto.createHmac('sha256', secret).update(payloadBuffer).digest('hex');

  // Normalise both to the same case before comparison
  const expected = Buffer.from(expectedHmac.toLowerCase(), 'utf8');
  const received = Buffer.from(signature.trim().toLowerCase(), 'utf8');

  // Constant-time comparison to prevent timing attacks
  if (expected.length !== received.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, received);
}
