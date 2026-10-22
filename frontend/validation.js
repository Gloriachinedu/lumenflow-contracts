/**
 * LumenFlow Frontend — Payment Amount Validation
 *
 * Validates that a payment amount is a positive integer before
 * the transaction is submitted to the Soroban contract.
 *
 * Rules (matching contract-side constraints):
 *  - Must be a finite number
 *  - Must be greater than zero
 *  - Must be a whole number (no decimals)
 *
 * Usage:
 *   import { validatePaymentAmount, attachAmountValidation } from './validation.js';
 *
 *   // Programmatic check
 *   const result = validatePaymentAmount(value);
 *   if (!result.valid) showError(result.message);
 *
 *   // Auto-wire blur + submit validation to an <input> element
 *   attachAmountValidation(inputEl, errorEl, formEl);
 */

// ── Core validator ────────────────────────────────────────────────────────────

/**
 * Validates a payment amount value.
 *
 * @param {unknown} value - The raw value from the input field (string or number).
 * @returns {{ valid: boolean, message: string }}
 */
export function validatePaymentAmount(value) {
  // Empty / missing
  if (value === '' || value === null || value === undefined) {
    return { valid: false, message: 'Amount is required.' };
  }

  const num = Number(value);

  // Non-numeric (NaN, Infinity, strings like "abc")
  if (!Number.isFinite(num)) {
    return { valid: false, message: 'Amount must be a valid number.' };
  }

  // Negative
  if (num < 0) {
    return { valid: false, message: 'Amount must be a positive number.' };
  }

  // Zero
  if (num === 0) {
    return { valid: false, message: 'Amount must be greater than zero.' };
  }

  // Decimal / non-integer
  if (!Number.isInteger(num)) {
    return {
      valid: false,
      message: 'Amount must be a whole number (no decimals allowed).',
    };
  }

  return { valid: true, message: '' };
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

/**
 * Displays an inline validation error for a form field.
 *
 * @param {HTMLElement} errorEl - The element used to display the error message.
 * @param {string} message - Error text, or '' to clear the error.
 */
export function showAmountError(errorEl, message) {
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.hidden = message === '';
  errorEl.setAttribute('aria-live', 'polite');
}

/**
 * Wires blur-time and submit-time validation to a payment amount input.
 *
 * @param {HTMLInputElement} inputEl - The amount <input> element.
 * @param {HTMLElement}      errorEl - Element that renders inline error text.
 * @param {HTMLFormElement}  [formEl] - Optional parent form; blocks submit on error.
 * @returns {() => void} Cleanup function that removes the event listeners.
 */
export function attachAmountValidation(inputEl, errorEl, formEl) {
  if (!inputEl) {
    throw new Error('attachAmountValidation: inputEl is required.');
  }

  function handleBlur() {
    const result = validatePaymentAmount(inputEl.value);
    showAmountError(errorEl, result.valid ? '' : result.message);
  }

  function handleSubmit(event) {
    const result = validatePaymentAmount(inputEl.value);
    if (!result.valid) {
      event.preventDefault();
      showAmountError(errorEl, result.message);
      inputEl.focus();
    }
  }

  inputEl.addEventListener('blur', handleBlur);
  if (formEl) {
    formEl.addEventListener('submit', handleSubmit);
  }

  return function cleanup() {
    inputEl.removeEventListener('blur', handleBlur);
    if (formEl) {
      formEl.removeEventListener('submit', handleSubmit);
    }
  };
}
