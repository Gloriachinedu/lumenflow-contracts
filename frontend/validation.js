/**
 * validation.js
 * Shared input validators for LumenFlow frontend forms.
 * Every validator returns an error message string, or '' when the value is
 * valid, so pages can render the result directly as an inline field error.
 */

export const ORDER_ID_MAX_LENGTH = 64;

// StrKey format check: 1-char type prefix + 55 base32 chars (A-Z, 2-7).
// G = account/public key, C = contract. The checksum is verified by the
// SDK/contract; the frontend only enforces shape and length.
const STELLAR_KEY_BODY = /^[A-Z2-7]{55}$/;

export function isValidStellarKey(value, prefixes = ['G']) {
  if (typeof value !== 'string' || value.length !== 56) return false;
  if (!prefixes.includes(value[0])) return false;
  return STELLAR_KEY_BODY.test(value.slice(1));
}

export function validateOrderId(value, label = 'Order ID') {
  const v = (value || '').trim();
  if (!v) return `${label} is required.`;
  if (v.length > ORDER_ID_MAX_LENGTH) {
    return `${label} must be ${ORDER_ID_MAX_LENGTH} characters or fewer.`;
  }
  return '';
}

export function validateAmount(value, { label = 'Amount', integer = false, allowZero = false, required = true } = {}) {
  const raw = (value == null ? '' : String(value)).trim();
  if (!raw) return required ? `${label} is required.` : '';
  const num = Number(raw);
  if (!Number.isFinite(num)) return `${label} must be a number.`;
  if (integer && !Number.isInteger(num)) return `${label} must be a whole number.`;
  if (allowZero ? num < 0 : num <= 0) {
    return allowZero ? `${label} cannot be negative.` : `${label} must be greater than zero.`;
  }
  return '';
}

export function validateAddress(value, { label = 'Address', prefixes = ['G'], required = true } = {}) {
  const v = (value || '').trim();
  if (!v) return required ? `${label} is required.` : '';
  if (!isValidStellarKey(v, prefixes)) {
    return `${label} must be a valid Stellar address (starts with ${prefixes.join(' or ')}, 56 characters).`;
  }
  return '';
}
