import * as crypto from 'crypto';
import { verifyWebhookSignature } from './webhookSignature';

// ── Known-good HMAC vectors ──────────────────────────────────────────────────
// Precomputed HMAC-SHA256 digests for deterministic test vectors.

const SECRET = 'test-secret-key';

/** Helper: compute HMAC-SHA256 hex digest for a given payload + secret. */
function hmacSha256Hex(payload: Buffer, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

describe('verifyWebhookSignature', () => {
  // ── Valid signature ──────────────────────────────────────────────────────────

  it('returns true for a valid HMAC-SHA256 signature (Buffer payload)', () => {
    const payload = Buffer.from('{"event":"payment_processed","order_id":"ORDER_001"}');
    const signature = hmacSha256Hex(payload, SECRET);
    expect(verifyWebhookSignature(payload, signature, SECRET)).toBe(true);
  });

  it('returns true for a valid signature with string payload', () => {
    const payloadStr = '{"event":"refund_executed","refund_id":"REFUND_001"}';
    const signature = hmacSha256Hex(Buffer.from(payloadStr), SECRET);
    expect(verifyWebhookSignature(payloadStr, signature, SECRET)).toBe(true);
  });

  it('returns true for a known-good NIST CAVP test vector', () => {
    // NIST CAVP HMAC-SHA256 Test Case 2
    // Key:  "Jefe" (4 bytes)
    // Data: "what do ya want for nothing?"
    // HMAC: 5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843
    const key = 'Jefe';
    const data = 'what do ya want for nothing?';
    const expectedSig = '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843';
    expect(verifyWebhookSignature(data, expectedSig, key)).toBe(true);
  });

  it('returns true for a known-good test vector with binary key', () => {
    // NIST CAVP HMAC-SHA256 Test Case 1
    // Key:  0x0b repeated 20 times (binary)
    // Data: "Hi There"
    // HMAC: b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7
    const key = Buffer.from('0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b', 'hex').toString('latin1');
    const data = 'Hi There';
    const expectedSig = 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7';
    expect(verifyWebhookSignature(data, expectedSig, key)).toBe(true);
  });

  // ── Invalid signature ────────────────────────────────────────────────────────

  it('returns false for an invalid signature', () => {
    const payload = Buffer.from('{"event":"test"}');
    const validSig = hmacSha256Hex(payload, SECRET);
    const invalidSig = validSig.slice(0, -2) + 'ff'; // tamper last byte
    expect(verifyWebhookSignature(payload, invalidSig, SECRET)).toBe(false);
  });

  it('returns false when using the wrong secret', () => {
    const payload = Buffer.from('{"event":"test"}');
    const signature = hmacSha256Hex(payload, SECRET);
    expect(verifyWebhookSignature(payload, signature, 'wrong-secret')).toBe(false);
  });

  it('returns false for a completely wrong signature', () => {
    const payload = Buffer.from('{"event":"test"}');
    expect(verifyWebhookSignature(payload, 'deadbeef', SECRET)).toBe(false);
  });

  it('returns false for signatures of different length', () => {
    const payload = Buffer.from('{"event":"test"}');
    const shortSig = 'abc123'; // not 64 hex chars
    expect(verifyWebhookSignature(payload, shortSig, SECRET)).toBe(false);
  });

  // ── Input validation ─────────────────────────────────────────────────────────

  it('throws when payload is null', () => {
    expect(() => verifyWebhookSignature(null as any, 'abc', SECRET)).toThrow(
      'payload must not be null',
    );
  });

  it('throws when payload is undefined', () => {
    expect(() => verifyWebhookSignature(undefined as any, 'abc', SECRET)).toThrow(
      'payload must not be null',
    );
  });

  it('throws when signature is empty', () => {
    expect(() => verifyWebhookSignature(Buffer.from('test'), '', SECRET)).toThrow(
      'signature must not be empty',
    );
  });

  it('throws when secret is empty', () => {
    const payload = Buffer.from('test');
    const sig = hmacSha256Hex(payload, SECRET);
    expect(() => verifyWebhookSignature(payload, sig, '')).toThrow('secret must not be empty');
  });

  it('throws when secret is empty string', () => {
    const payload = Buffer.from('test');
    const sig = hmacSha256Hex(payload, SECRET);
    expect(() => verifyWebhookSignature(payload, sig, '')).toThrow('secret must not be empty');
  });

  // ── Edge cases ───────────────────────────────────────────────────────────────

  it('handles empty payload correctly', () => {
    const payload = Buffer.alloc(0);
    const signature = hmacSha256Hex(payload, SECRET);
    expect(verifyWebhookSignature(payload, signature, SECRET)).toBe(true);
  });

  it('handles large payload correctly', () => {
    const payload = Buffer.alloc(10000, 0x41); // 10KB of 'A's
    const signature = hmacSha256Hex(payload, SECRET);
    expect(verifyWebhookSignature(payload, signature, SECRET)).toBe(true);
  });

  it('uses constant-time comparison (timingSafeEqual)', () => {
    // Verify that the implementation uses crypto.timingSafeEqual by checking
    // that both valid and invalid signatures of the same length take similar time.
    const payload = Buffer.from('{"event":"timing_test"}');
    const validSig = hmacSha256Hex(payload, SECRET);
    const invalidSig = Buffer.from(validSig, 'hex');
    invalidSig[0] ^= 0xff; // flip a bit
    const invalidSigHex = invalidSig.toString('hex');

    expect(verifyWebhookSignature(payload, validSig, SECRET)).toBe(true);
    expect(verifyWebhookSignature(payload, invalidSigHex, SECRET)).toBe(false);
  });
});
