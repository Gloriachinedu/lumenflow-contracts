/**
 * errorMessages.js
 * Human-readable messages for all LumenFlow contract PaymentError codes.
 *
 * Usage:
 *   import { getErrorMessage, showErrorToast } from './errorMessages.js';
 *
 *   try { ... } catch (e) {
 *     const { message, hint } = getErrorMessage(e);
 *     showErrorToast(message, hint);
 *   }
 */

/**
 * Maps every PaymentError code (from error.rs) to a plain-English message
 * and a short remediation hint the user can act on.
 *
 * @type {Record<number, { message: string, hint: string }>}
 */
export const ERROR_MESSAGES = {
  // ── Auth ──────────────────────────────────────────────────────────────────
  1: {
    message: 'You are not authorised to perform this action.',
    hint: 'Make sure your wallet is connected and you have the correct role (admin, merchant, or payer).',
  },
  2: {
    message: 'An admin has already been set for this contract.',
    hint: 'Admin setup can only happen once. No further action is needed.',
  },
  3: {
    message: 'The admin address you provided is not valid.',
    hint: 'Use a valid Stellar address starting with G.',
  },
  4: {
    message: 'The security nonce is incorrect.',
    hint: 'Fetch the current nonce and increment it by 1 before retrying.',
  },

  // ── Merchant ──────────────────────────────────────────────────────────────
  10: {
    message: 'Merchant not found.',
    hint: 'Double-check the merchant address and make sure the merchant is registered.',
  },
  11: {
    message: 'This address is already registered as a merchant.',
    hint: 'Use the existing merchant profile or choose a different address.',
  },
  12: {
    message: 'This merchant account has been deactivated.',
    hint: 'Contact an admin to reactivate the merchant profile.',
  },

  // ── Payment ───────────────────────────────────────────────────────────────
  20: {
    message: 'Payment not found.',
    hint: 'Check that the order ID is correct.',
  },
  21: {
    message: 'A payment with this order ID already exists.',
    hint: 'Use a unique order ID for each new payment.',
  },
  22: {
    message: 'The payment amount must be greater than zero.',
    hint: 'Enter a positive, non-zero amount and try again.',
  },
  23: {
    message: 'The payment signature is invalid.',
    hint: 'Rebuild the signed payload and re-sign it with the correct private key.',
  },
  24: {
    message: 'This payment request has expired.',
    hint: 'Create a new payment request and try again.',
  },
  25: {
    message: 'Insufficient balance to complete this payment.',
    hint: 'Add more funds to your wallet and try again.',
  },
  26: {
    message: 'This token is not accepted by the merchant.',
    hint: 'Switch to a supported token such as XLM or USDC.',
  },

  // ── Refund ────────────────────────────────────────────────────────────────
  30: {
    message: 'Refund not found.',
    hint: 'Verify the refund ID and try again.',
  },
  31: {
    message: 'A refund with this ID already exists.',
    hint: 'Use a unique refund ID.',
  },
  32: {
    message: 'The refund window has closed.',
    hint: 'Refunds must be requested within 30 days of the original payment.',
  },
  33: {
    message: 'The refund amount exceeds the original payment.',
    hint: 'Reduce the refund amount so the total does not exceed what was paid.',
  },
  34: {
    message: 'This refund has not been approved yet.',
    hint: 'The merchant or admin must approve the refund before it can be processed.',
  },
  35: {
    message: 'This refund has already been completed.',
    hint: 'No further action is needed — the refund was already processed.',
  },
  36: {
    message: 'The refund amount is below the minimum allowed.',
    hint: 'Increase the refund amount to meet the minimum threshold and try again.',
  },
  37: {
    message: 'The maximum number of refunds for this payment has been reached.',
    hint: 'No further refunds can be created for this payment.',
  },

  // ── Multisig ──────────────────────────────────────────────────────────────
  40: {
    message: 'Multi-signature payment not found.',
    hint: 'Verify the payment ID.',
  },
  41: {
    message: 'You have already signed this multi-signature payment.',
    hint: 'Wait for the remaining signers to add their approvals.',
  },
  42: {
    message: 'This multi-signature payment has already been executed.',
    hint: 'No further action is needed.',
  },
  43: {
    message: 'Not enough signatures to execute this payment yet.',
    hint: 'Collect more approvals from the authorised signers.',
  },
  44: {
    message: 'This multi-signature payment has already been cancelled.',
    hint: 'No further action is needed.',
  },
  45: {
    message: 'This multi-signature payment was cancelled.',
    hint: 'Create a new multisig payment if needed.',
  },
  46: {
    message: 'This multi-signature payment has expired.',
    hint: 'Create a new multisig payment request.',
  },

  // ── General ───────────────────────────────────────────────────────────────
  50: {
    message: 'One or more input values are invalid.',
    hint: 'Check that all fields are correctly filled in and try again.',
  },
  51: {
    message: 'The requested page size is too large.',
    hint: 'Use a limit of 100 or less per page.',
  },
  52: {
    message: 'Too many items in this batch.',
    hint: 'Split the batch into smaller groups (maximum 10 items) and retry.',
  },
  53: {
    message: 'One or more tags are invalid.',
    hint: 'Use at most 5 tags, each no longer than 20 characters.',
  },

  // ── Subscriptions ─────────────────────────────────────────────────────────
  60: {
    message: 'A subscription plan with this ID already exists.',
    hint: 'Use a unique plan ID.',
  },
  61: {
    message: 'A subscription with this ID already exists.',
    hint: 'Use a unique subscription ID.',
  },
  62: {
    message: 'Subscription plan not found.',
    hint: 'Check that the plan ID is correct.',
  },
  63: {
    message: 'Subscription not found.',
    hint: 'Verify the subscription ID.',
  },
  64: {
    message: 'This subscription is not active.',
    hint: 'Check whether the subscription has been cancelled or has already ended.',
  },
  65: {
    message: 'This subscription has reached its maximum billing cycles.',
    hint: 'Create a new subscription if you want to continue.',
  },
  66: {
    message: 'It is too soon to charge this subscription.',
    hint: 'Wait for the next billing cycle before retrying.',
  },

  // ── Contract state ────────────────────────────────────────────────────────
  70: {
    message: 'The contract is currently paused.',
    hint: 'An admin must unpause the contract before any transactions can proceed.',
  },
  71: {
    message: 'Payment history limit reached for this account.',
    hint: 'Ask an admin to archive old payment records.',
  },
  80: {
    message: 'Contract version mismatch detected.',
    hint: 'Call set_contract_version after upgrading the contract.',
  },

  // ── Rate limiting ─────────────────────────────────────────────────────────
  90: {
    message: 'Too many payments submitted too quickly.',
    hint: 'Wait about 25 minutes before submitting more payments.',
  },

  // ── Escrow ────────────────────────────────────────────────────────────────
  100: {
    message: 'Escrow record not found.',
    hint: 'Verify the order ID associated with the escrow.',
  },
  101: {
    message: 'An escrow record with this order ID already exists.',
    hint: 'Use a unique order ID.',
  },
  102: {
    message: 'The escrow cannot be released yet — the unlock time has not passed.',
    hint: 'Wait until the scheduled unlock time and try again.',
  },
  103: {
    message: 'This escrow has already been released or cancelled.',
    hint: 'No further action is needed.',
  },
  104: {
    message: 'Only the original payer can cancel this escrow.',
    hint: 'Sign the transaction with the payer wallet that created the escrow.',
  },
  105: {
    message: 'The escrow lock period has already passed — it can no longer be cancelled.',
    hint: 'Call release escrow instead.',
  },
};

/**
 * Fallback entry returned for unrecognised error codes.
 * @param {number|string} rawCode
 * @returns {{ message: string, hint: string }}
 */
function fallback(rawCode) {
  return {
    message: `Something went wrong (error ${rawCode}).`,
    hint: 'Please try again or contact support if the problem persists.',
  };
}

/**
 * Extracts the numeric error code from a Soroban error string or exception.
 *
 * Soroban surfaces errors in the form:  "Error(Contract, #23)"
 * This function also handles plain numeric codes passed directly.
 *
 * @param {unknown} errorOrCode - An Error object, a string like "Error(Contract, #23)", or a number.
 * @returns {number|null} The numeric code, or null if not parseable.
 */
export function extractErrorCode(errorOrCode) {
  if (typeof errorOrCode === 'number') return errorOrCode;

  const str =
    typeof errorOrCode === 'string'
      ? errorOrCode
      : errorOrCode instanceof Error
        ? errorOrCode.message
        : String(errorOrCode);

  // Match "Error(Contract, #23)" or "Error(Contract, 23)"
  const match = str.match(/Error\s*\([^,]+,\s*#?(\d+)\s*\)/i);
  if (match) return parseInt(match[1], 10);

  // Match a bare number at the end, e.g. "contract error: 23"
  const bareMatch = str.match(/\b(\d{1,3})\b/);
  if (bareMatch) return parseInt(bareMatch[1], 10);

  return null;
}

/**
 * Returns the human-readable message and hint for a given error.
 *
 * @param {unknown} errorOrCode - A Soroban error string, an Error, or a numeric code.
 * @returns {{ message: string, hint: string, code: number|null }}
 */
export function getErrorMessage(errorOrCode) {
  const code = extractErrorCode(errorOrCode);
  if (code !== null && ERROR_MESSAGES[code]) {
    return { ...ERROR_MESSAGES[code], code };
  }
  return { ...fallback(code ?? errorOrCode), code };
}

// ── Toast notification system ─────────────────────────────────────────────────

let _toastContainer = null;

/**
 * Returns (creating on first call) the singleton toast container element.
 * @returns {HTMLElement}
 */
function getToastContainer() {
  if (_toastContainer) return _toastContainer;
  _toastContainer = document.createElement('div');
  _toastContainer.id = 'lf-toast-container';
  _toastContainer.setAttribute('aria-live', 'assertive');
  _toastContainer.setAttribute('aria-atomic', 'false');
  _toastContainer.setAttribute('role', 'status');
  _toastContainer.style.cssText = [
    'position:fixed',
    'bottom:1.5rem',
    'right:1.5rem',
    'z-index:9999',
    'display:flex',
    'flex-direction:column',
    'gap:0.75rem',
    'max-width:360px',
    'width:calc(100vw - 3rem)',
    'pointer-events:none',
  ].join(';');
  document.body.appendChild(_toastContainer);
  return _toastContainer;
}

/**
 * Displays a toast notification with an optional secondary hint line.
 *
 * @param {string} message    - Primary, plain-English error message.
 * @param {string} [hint]     - Optional remediation hint shown in smaller text.
 * @param {'error'|'success'|'info'} [type='error'] - Visual style.
 * @param {number} [duration=6000] - Auto-dismiss after this many milliseconds.
 */
export function showToast(message, hint = '', type = 'error', duration = 6000) {
  const container = getToastContainer();

  const COLORS = {
    error:   { bg: '#fff0f0', border: '#e53e3e', icon: '⚠',  text: '#c0392b' },
    success: { bg: '#f0fdf4', border: '#1a9e5c', icon: '✔',  text: '#1a5e37' },
    info:    { bg: '#eff4ff', border: '#3b5bdb', icon: 'ℹ',  text: '#2c3e9e' },
  };
  const style = COLORS[type] || COLORS.error;

  const toast = document.createElement('div');
  toast.setAttribute('role', 'alert');
  toast.style.cssText = [
    `background:${style.bg}`,
    `border:1.5px solid ${style.border}`,
    `color:${style.text}`,
    'border-radius:10px',
    'padding:0.85rem 1rem',
    'font-size:0.875rem',
    'font-family:system-ui,-apple-system,sans-serif',
    'box-shadow:0 4px 16px rgba(0,0,0,0.12)',
    'pointer-events:auto',
    'opacity:0',
    'transform:translateY(8px)',
    'transition:opacity 0.2s ease,transform 0.2s ease',
    'display:flex',
    'gap:0.6rem',
    'align-items:flex-start',
  ].join(';');

  const hintHtml = hint
    ? `<div style="margin-top:0.35rem;font-size:0.8rem;opacity:0.85;">${hint}</div>`
    : '';

  toast.innerHTML = `
    <span aria-hidden="true" style="font-size:1.1rem;flex-shrink:0;line-height:1.4">${style.icon}</span>
    <div style="flex:1">
      <div style="font-weight:600">${message}</div>
      ${hintHtml}
    </div>
    <button
      onclick="this.closest('[role=alert]').remove()"
      aria-label="Dismiss notification"
      style="background:none;border:none;cursor:pointer;color:inherit;font-size:1.1rem;line-height:1;padding:0;flex-shrink:0;opacity:0.7"
    >×</button>`;

  container.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  // Auto-dismiss
  const timer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    setTimeout(() => toast.remove(), 220);
  }, duration);

  // Pause auto-dismiss on hover
  toast.addEventListener('mouseenter', () => clearTimeout(timer));
  toast.addEventListener('mouseleave', () => {
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      setTimeout(() => toast.remove(), 220);
    }, 2000);
  });
}

/**
 * Convenience wrapper that resolves the error code and shows a toast.
 *
 * @param {unknown} errorOrCode - A Soroban error string, Error object, or numeric code.
 */
export function showErrorToast(errorOrCode) {
  const { message, hint } = getErrorMessage(errorOrCode);
  showToast(message, hint, 'error');
}
