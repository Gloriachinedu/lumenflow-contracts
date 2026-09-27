/**
 * Unit tests for frontend/validation.js.
 *
 * Focus: edge and boundary cases — non-string inputs, length boundaries,
 * whitespace trimming, base32 alphabet enforcement, and the option flags on
 * validateAmount / validateAddress.
 *
 * Run with:  npm run test:unit   (from the frontend/ directory)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ORDER_ID_MAX_LENGTH,
  isValidStellarKey,
  validateOrderId,
  validateAmount,
  validateAddress,
} from '../../validation.js';

// A syntactically valid 56-char Stellar key: 1-char prefix + 55 base32 chars.
const G_KEY = 'G' + 'A'.repeat(55);
const C_KEY = 'C' + 'B'.repeat(55);

// ── isValidStellarKey ────────────────────────────────────────────────────────

test('isValidStellarKey: accepts a well-formed G key', () => {
  assert.equal(isValidStellarKey(G_KEY), true);
});

test('isValidStellarKey: accepts a C key only when C is in the prefix list', () => {
  assert.equal(isValidStellarKey(C_KEY, ['C']), true);
  assert.equal(isValidStellarKey(C_KEY), false); // default prefixes = ['G']
  assert.equal(isValidStellarKey(C_KEY, ['G', 'C']), true);
});

test('isValidStellarKey: rejects non-string input', () => {
  for (const value of [null, undefined, 42, {}, [], true]) {
    assert.equal(isValidStellarKey(value), false);
  }
});

test('isValidStellarKey: rejects wrong length (55 and 57 chars)', () => {
  assert.equal(isValidStellarKey('G' + 'A'.repeat(54)), false);
  assert.equal(isValidStellarKey('G' + 'A'.repeat(56)), false);
});

test('isValidStellarKey: rejects the empty string', () => {
  assert.equal(isValidStellarKey(''), false);
});

test('isValidStellarKey: rejects characters outside the base32 alphabet', () => {
  // 0, 1, 8, 9 are not part of RFC 4648 base32 (A-Z, 2-7).
  assert.equal(isValidStellarKey('G' + '0'.repeat(55)), false);
  assert.equal(isValidStellarKey('G1' + 'A'.repeat(53)), false);
  assert.equal(isValidStellarKey('G8' + 'A'.repeat(53)), false);
  // lowercase is rejected
  assert.equal(isValidStellarKey('G' + 'a'.repeat(55)), false);
});

test('isValidStellarKey: does not trim — surrounding whitespace fails', () => {
  assert.equal(isValidStellarKey(` ${G_KEY} `), false);
});

// ── validateOrderId ──────────────────────────────────────────────────────────

test('validateOrderId: required-field message for empty / whitespace / nullish', () => {
  assert.equal(validateOrderId(''), 'Order ID is required.');
  assert.equal(validateOrderId('   '), 'Order ID is required.');
  assert.equal(validateOrderId(null), 'Order ID is required.');
  assert.equal(validateOrderId(undefined), 'Order ID is required.');
});

test('validateOrderId: accepts a value exactly at the max length boundary', () => {
  assert.equal(validateOrderId('x'.repeat(ORDER_ID_MAX_LENGTH)), '');
});

test('validateOrderId: rejects a value one character over the max length', () => {
  assert.equal(
    validateOrderId('x'.repeat(ORDER_ID_MAX_LENGTH + 1)),
    `Order ID must be ${ORDER_ID_MAX_LENGTH} characters or fewer.`,
  );
});

test('validateOrderId: trims before length check and before emptiness check', () => {
  assert.equal(validateOrderId('  ORDER-1  '), '');
  // 64 non-space chars padded with spaces still passes (spaces are trimmed).
  assert.equal(validateOrderId(`  ${'y'.repeat(ORDER_ID_MAX_LENGTH)}  `), '');
});

test('validateOrderId: custom label is reflected in the message', () => {
  assert.equal(validateOrderId('', 'Invoice reference'), 'Invoice reference is required.');
});

// ── validateAmount ───────────────────────────────────────────────────────────

test('validateAmount: required by default, optional when required:false', () => {
  assert.equal(validateAmount(''), 'Amount is required.');
  assert.equal(validateAmount('', { required: false }), '');
  assert.equal(validateAmount(null, { required: false }), '');
});

test('validateAmount: rejects non-numeric strings and non-finite values', () => {
  assert.equal(validateAmount('abc'), 'Amount must be a number.');
  assert.equal(validateAmount('Infinity'), 'Amount must be a number.');
  assert.equal(validateAmount('NaN'), 'Amount must be a number.');
  assert.equal(validateAmount('1,000'), 'Amount must be a number.');
});

test('validateAmount: accepts numeric (non-string) input and scientific notation', () => {
  assert.equal(validateAmount(5), '');
  assert.equal(validateAmount('1e3'), '');
});

test('validateAmount: integer flag rejects fractional values', () => {
  assert.equal(validateAmount('10.5', { integer: true }), 'Amount must be a whole number.');
  assert.equal(validateAmount('10', { integer: true }), '');
});

test('validateAmount: zero handling depends on allowZero', () => {
  assert.equal(validateAmount('0'), 'Amount must be greater than zero.');
  assert.equal(validateAmount('0', { allowZero: true }), '');
});

test('validateAmount: negative handling depends on allowZero', () => {
  assert.equal(validateAmount('-5'), 'Amount must be greater than zero.');
  assert.equal(validateAmount('-5', { allowZero: true }), 'Amount cannot be negative.');
});

test('validateAmount: trims surrounding whitespace', () => {
  assert.equal(validateAmount('  42  '), '');
});

test('validateAmount: custom label is reflected in every branch', () => {
  assert.equal(validateAmount('', { label: 'Refund' }), 'Refund is required.');
  assert.equal(validateAmount('x', { label: 'Refund' }), 'Refund must be a number.');
  assert.equal(validateAmount('0', { label: 'Refund' }), 'Refund must be greater than zero.');
});

// ── validateAddress ──────────────────────────────────────────────────────────

test('validateAddress: required by default, optional when required:false', () => {
  assert.equal(validateAddress(''), 'Address is required.');
  assert.equal(validateAddress('   '), 'Address is required.');
  assert.equal(validateAddress('', { required: false }), '');
});

test('validateAddress: accepts a valid key and trims whitespace first', () => {
  assert.equal(validateAddress(G_KEY), '');
  assert.equal(validateAddress(`  ${G_KEY}  `), '');
});

test('validateAddress: rejects malformed keys with a prefix-aware message', () => {
  assert.equal(
    validateAddress('not-a-key'),
    'Address must be a valid Stellar address (starts with G, 56 characters).',
  );
  assert.equal(
    validateAddress('X'.repeat(56), { prefixes: ['G', 'M'] }),
    'Address must be a valid Stellar address (starts with G or M, 56 characters).',
  );
});

test('validateAddress: honours a custom prefix list', () => {
  assert.equal(validateAddress(C_KEY, { prefixes: ['C'] }), '');
  assert.equal(
    validateAddress(C_KEY),
    'Address must be a valid Stellar address (starts with G, 56 characters).',
  );
});

test('validateAddress: custom label is reflected in the message', () => {
  assert.equal(validateAddress('', { label: 'Merchant address' }), 'Merchant address is required.');
});
