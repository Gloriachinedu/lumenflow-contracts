/**
 * Webhook signature verification helper.
 *
 * Provides constant-time HMAC-SHA256 signature verification to prevent
 * timing attacks when validating incoming webhook payloads.
 *
 * @see docs/webhook-integration.md
 */

import * as crypto from 'crypto';

/**
 * Verify a webhook payload's HMAC-SHA256 signature using a constant-time
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
  const expected = Buffer.from(expectedHmac, 'utf8');
  const received = Buffer.from(signature, 'utf8');

  // Constant-time comparison to prevent timing attacks
  if (expected.length !== received.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, received);
}
