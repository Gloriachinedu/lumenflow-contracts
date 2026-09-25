/**
 * verify-custom-category.js
 *
 * Client-side validation helper for LumenFlow custom merchant categories.
 *
 * Constraints (issue #1027):
 *   - Non-empty string
 *   - Maximum 64 characters
 *   - Only alphanumeric characters (a-z, A-Z, 0-9) and spaces are allowed
 *
 * The on-chain contract enforces length and non-empty via the
 * `validate_merchant_category` helper. This script provides client-side
 * pre-validation so invalid categories are caught before submitting a
 * transaction, saving network fees.
 *
 * Usage:
 *   const { validateCustomCategory, CUSTOM_CATEGORY_MAX_LENGTH } = require('./verify-custom-category');
 *
 *   const result = validateCustomCategory('Handcraft Goods');
 *   if (!result.valid) {
 *     console.error(result.error);
 *   }
 */

'use strict';

/** Maximum allowed length for a custom merchant category string. */
const CUSTOM_CATEGORY_MAX_LENGTH = 64;

/**
 * Regular expression for allowed characters: alphanumeric and spaces only.
 * @type {RegExp}
 */
const ALLOWED_CHARS_REGEX = /^[a-zA-Z0-9 ]+$/;

/**
 * Validate a custom merchant category string against the contract constraints.
 *
 * @param {string} category - The custom category string to validate.
 * @returns {{ valid: boolean, error: string | null }} Validation result.
 *
 * @example
 * validateCustomCategory('');
 * // => { valid: false, error: 'Custom category must not be empty.' }
 *
 * @example
 * validateCustomCategory('a'.repeat(65));
 * // => { valid: false, error: 'Custom category must not exceed 64 characters.' }
 *
 * @example
 * validateCustomCategory('Special#Category');
 * // => { valid: false, error: 'Custom category may only contain alphanumeric characters and spaces.' }
 *
 * @example
 * validateCustomCategory('Handcraft Goods');
 * // => { valid: true, error: null }
 */
function validateCustomCategory(category) {
  if (typeof category !== 'string') {
    return { valid: false, error: 'Custom category must be a string.' };
  }

  if (category.length === 0) {
    return { valid: false, error: 'Custom category must not be empty.' };
  }

  if (category.length > CUSTOM_CATEGORY_MAX_LENGTH) {
    return {
      valid: false,
      error: `Custom category must not exceed ${CUSTOM_CATEGORY_MAX_LENGTH} characters.`,
    };
  }

  if (!ALLOWED_CHARS_REGEX.test(category)) {
    return {
      valid: false,
      error: 'Custom category may only contain alphanumeric characters and spaces.',
    };
  }

  return { valid: true, error: null };
}

module.exports = {
  validateCustomCategory,
  CUSTOM_CATEGORY_MAX_LENGTH,
  ALLOWED_CHARS_REGEX,
};
