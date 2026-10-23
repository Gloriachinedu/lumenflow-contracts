/**
 * Unit tests for frontend/validation.js
 *
 * Run with: node --test frontend/validation.test.js
 * (Node 18+ built-in test runner — no extra dependencies required)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validatePaymentAmount } from './validation.js';

// ── Invalid inputs ─────────────────────────────────────────────────────────────

describe('validatePaymentAmount — invalid inputs', () => {
  it('rejects empty string', () => {
    const result = validatePaymentAmount('');
    assert.equal(result.valid, false);
    assert.ok(result.message.length > 0, 'should provide a message');
  });

  it('rejects null', () => {
    const result = validatePaymentAmount(null);
    assert.equal(result.valid, false);
  });

  it('rejects undefined', () => {
    const result = validatePaymentAmount(undefined);
    assert.equal(result.valid, false);
  });

  it('rejects zero (string "0")', () => {
    const result = validatePaymentAmount('0');
    assert.equal(result.valid, false);
    assert.match(result.message, /greater than zero/i);
  });

  it('rejects zero (number 0)', () => {
    const result = validatePaymentAmount(0);
    assert.equal(result.valid, false);
    assert.match(result.message, /greater than zero/i);
  });

  it('rejects negative integer -1', () => {
    const result = validatePaymentAmount(-1);
    assert.equal(result.valid, false);
    assert.match(result.message, /positive/i);
  });

  it('rejects negative string "-100"', () => {
    const result = validatePaymentAmount('-100');
    assert.equal(result.valid, false);
    assert.match(result.message, /positive/i);
  });

  it('rejects decimal 1.5', () => {
    const result = validatePaymentAmount(1.5);
    assert.equal(result.valid, false);
    assert.match(result.message, /whole number/i);
  });

  it('rejects decimal string "0.01"', () => {
    const result = validatePaymentAmount('0.01');
    assert.equal(result.valid, false);
    assert.match(result.message, /whole number/i);
  });

  it('rejects decimal string "100.99"', () => {
    const result = validatePaymentAmount('100.99');
    assert.equal(result.valid, false);
    assert.match(result.message, /whole number/i);
  });

  it('rejects non-numeric string "abc"', () => {
    const result = validatePaymentAmount('abc');
    assert.equal(result.valid, false);
    assert.ok(result.message.length > 0);
  });

  it('rejects mixed string "12abc"', () => {
    const result = validatePaymentAmount('12abc');
    assert.equal(result.valid, false);
  });

  it('rejects Infinity', () => {
    const result = validatePaymentAmount(Infinity);
    assert.equal(result.valid, false);
  });

  it('rejects NaN', () => {
    const result = validatePaymentAmount(NaN);
    assert.equal(result.valid, false);
  });
});

// ── Valid inputs ───────────────────────────────────────────────────────────────

describe('validatePaymentAmount — valid inputs', () => {
  it('accepts positive integer 1', () => {
    const result = validatePaymentAmount(1);
    assert.equal(result.valid, true);
    assert.equal(result.message, '');
  });

  it('accepts positive integer string "100"', () => {
    const result = validatePaymentAmount('100');
    assert.equal(result.valid, true);
  });

  it('accepts large positive integer 1000000', () => {
    const result = validatePaymentAmount(1000000);
    assert.equal(result.valid, true);
  });

  it('accepts string with leading/trailing whitespace trimmed by Number()', () => {
    // Number(' 50 ') === 50 — consistent with standard JS form handling
    const result = validatePaymentAmount(' 50 ');
    assert.equal(result.valid, true);
  });
});
