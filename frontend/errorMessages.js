/**
 * errorMessages.js
 * Human-readable messages for all LumenFlow contract error codes.
 *
 * Usage:
 *   import { getErrorMessage, showToast } from './errorMessages.js';
 *
 *   // Map a raw error code to a user-friendly message + hint
 *   const { message, hint } = getErrorMessage(23);
 *
 *   // Show a toast notification
 *   showToast('error', 'Invalid signature', 'Rebuild the payload and re-sign with the correct key.');
 *   showToast('success', 'Copied!');
 */

// ── Error message map ─────────────────────────────────────────────────────────
// Keys are the numeric PaymentError codes from error.rs.
// Each entry has:
//   message    – plain-English summary shown as the primary toast line
//   hint       – actionable remediation shown as a secondary line (matches docs/errors.md)
//   retryable  – whether retrying the same operation may succeed (drives the Retry button)

/** @type {Record<number, { message: string, hint: string, retryable: boolean }>} */
export const ERROR_MESSAGES = {
  // Auth (1–4)
  1: {
    message: 'You are not authorised to perform this action.',
    hint: 'Make sure your wallet is connected and you have the required role (admin or merchant).',
    retryable: false,
  },
  2: {
    message: 'An admin has already been set for this contract.',
    hint: 'Admin initialisation can only happen once.',
    retryable: false,
  },
  3: {
    message: 'The admin address you provided is not valid.',
    hint: 'Check that the address starts with G and is exactly 56 characters long.',
    retryable: false,
  },
  4: {
    message: 'The nonce you supplied does not match.',
    hint: 'Fetch the current nonce and increment it by 1 before retrying.',
    retryable: true,
  },

  // Merchant (10–12)
  10: {
    message: 'Merchant not found.',
    hint: 'Double-check the merchant address and make sure the merchant is registered.',
    retryable: false,
  },
  11: {
    message: 'This address is already registered as a merchant.',
    hint: 'Use the existing merchant profile or register with a different address.',
    retryable: false,
  },
  12: {
    message: 'This merchant account is currently deactivated.',
    hint: 'An admin must reactivate the merchant before payments can be processed.',
    retryable: false,
  },

  // Payment (20–26)
  20: {
    message: 'Payment not found.',
    hint: 'Check the order ID or payment ID and try again.',
    retryable: false,
  },
  21: {
    message: 'A payment with this order ID already exists.',
    hint: 'Use a unique order ID for each new payment.',
    retryable: false,
  },
  22: {
    message: 'The payment amount must be greater than zero.',
    hint: 'Enter a positive, non-zero amount and retry.',
    retryable: false,
  },
  23: {
    message: 'The payment signature is invalid.',
    hint: 'Rebuild the signed payload and re-sign it with the correct merchant private key.',
    retryable: true,
  },
  24: {
    message: 'This payment request has expired.',
    hint: 'Create a new payment request and try again.',
    retryable: false,
  },
  25: {
    message: 'Insufficient funds to complete this payment.',
    hint: 'Top up your account balance in the specified token before retrying.',
    retryable: true,
  },
  26: {
    message: 'This token is not accepted by the contract.',
    hint: 'Switch to a supported token (e.g. XLM or USDC).',
    retryable: false,
  },

  // Refund (30–37)
  30: {
    message: 'Refund not found.',
    hint: 'Verify the refund ID and try again.',
    retryable: false,
  },
  31: {
    message: 'A refund with this ID already exists.',
    hint: 'Use a unique refund ID for each request.',
    retryable: false,
  },
  32: {
    message: 'The refund window for this payment has closed.',
    hint: 'Refunds must be requested within 30 days of the original payment.',
    retryable: false,
  },
  33: {
    message: 'Refund amount exceeds the original payment.',
    hint: 'Reduce the refund amount so the total does not exceed what was originally paid.',
    retryable: false,
  },
  34: {
    message: 'This refund has not been approved yet.',
    hint: 'The merchant or admin must approve the refund before it can be executed.',
    retryable: true,
  },
  35: {
    message: 'This refund has already been completed.',
    hint: 'No further action is needed; the refund is done.',
    retryable: false,
  },
  36: {
    message: 'The refund amount is below the minimum allowed.',
    hint: 'Increase the refund amount to meet the minimum threshold.',
    retryable: false,
  },
  37: {
    message: 'This payment has reached the maximum number of refunds.',
    hint: 'No further refunds can be initiated for this payment.',
    retryable: false,
  },

  // Multisig (40–46)
  40: {
    message: 'Multi-signature payment not found.',
    hint: 'Verify the payment ID and try again.',
    retryable: false,
  },
  41: {
    message: 'You have already signed this multi-signature payment.',
    hint: 'Wait for the remaining required signers to sign.',
    retryable: false,
  },
  42: {
    message: 'This multi-signature payment has already been executed.',
    hint: 'No further action is needed.',
    retryable: false,
  },
  43: {
    message: 'Not enough signatures to execute this payment.',
    hint: 'Collect the required number of signatures from authorised signers.',
    retryable: true,
  },
  44: {
    message: 'This multi-signature payment has already been cancelled.',
    hint: 'Create a new multisig payment if needed.',
    retryable: false,
  },
  45: {
    message: 'This multi-signature payment was cancelled.',
    hint: 'Create a new multisig payment to proceed.',
    retryable: false,
  },
  46: {
    message: 'This multi-signature payment has expired.',
    hint: 'Create a new multisig payment.',
    retryable: false,
  },

  // General (50–53)
  50: {
    message: 'One or more input values are invalid.',
    hint: 'Check that all fields are filled in correctly and within the allowed limits.',
    retryable: false,
  },
  51: {
    message: 'The page size you requested exceeds the maximum of 100.',
    hint: 'Use a limit of 100 or fewer results per page.',
    retryable: false,
  },
  52: {
    message: 'Too many items in this batch — the maximum is 10.',
    hint: 'Split your request into smaller batches and retry.',
    retryable: false,
  },
  53: {
    message: 'One or more tags are invalid.',
    hint: 'Keep tags to a maximum of 5 entries, each no longer than 20 characters.',
    retryable: false,
  },

  // Subscriptions (60–66)
  60: {
    message: 'A subscription plan with this ID already exists.',
    hint: 'Use a unique plan ID.',
    retryable: false,
  },
  61: {
    message: 'A subscription with this ID already exists.',
    hint: 'Use a unique subscription ID.',
    retryable: false,
  },
  62: {
    message: 'Subscription plan not found.',
    hint: 'Check the plan ID and try again.',
    retryable: false,
  },
  63: {
    message: 'Subscription not found.',
    hint: 'Check the subscription ID and try again.',
    retryable: false,
  },
  64: {
    message: 'This subscription is not active.',
    hint: 'Check that the subscription has not been cancelled or completed.',
    retryable: false,
  },
  65: {
    message: 'This subscription has reached its maximum billing cycles.',
    hint: 'Create a new subscription if you need to continue charging.',
    retryable: false,
  },
  66: {
    message: 'It is too early to charge this subscription.',
    hint: 'Wait for the next billing interval before retrying.',
    retryable: true,
  },

  // Contract state (70–80)
  70: {
    message: 'The contract is currently paused.',
    hint: 'Contact the platform admin to unpause the contract.',
    retryable: true,
  },
  71: {
    message: 'Payment history storage limit reached for this account.',
    hint: 'Ask an admin to archive old payments to free up space.',
    retryable: false,
  },
  80: {
    message: 'Contract version mismatch.',
    hint: 'Call set_contract_version after upgrading the contract.',
    retryable: false,
  },

  // Rate limiting (90)
  90: {
    message: 'Too many payments submitted in a short time.',
    hint: 'Wait roughly 25 minutes before sending more payments.',
    retryable: true,
  },

  // Escrow (100–105)
  100: {
    message: 'Escrow record not found.',
    hint: 'Verify the order ID and try again.',
    retryable: false,
  },
  101: {
    message: 'An escrow with this order ID already exists.',
    hint: 'Use a unique order ID for each escrow.',
    retryable: false,
  },
  102: {
    message: 'The escrow has not reached its unlock time yet.',
    hint: 'Wait until the unlock_at timestamp before releasing the escrow.',
    retryable: true,
  },
  103: {
    message: 'This escrow has already been released or cancelled.',
    hint: 'No further action is needed.',
    retryable: false,
  },
  104: {
    message: 'Only the original payer can cancel this escrow.',
    hint: 'Connect the wallet that created the escrow and try again.',
    retryable: false,
  },
  105: {
    message: 'The escrow unlock time has already passed — it can no longer be cancelled.',
    hint: 'Call release_escrow instead to finalise the payment.',
    retryable: false,
  },
};

/**
 * Extracts a numeric error code from a raw Soroban error string.
 * Handles formats like "Error(Contract, #23)" or plain numbers.
 *
 * @param {string|number|unknown} rawError
 * @returns {number|null} Numeric code, or null if not parseable.
 */
export function parseErrorCode(rawError) {
  if (typeof rawError === 'number') return rawError;
  const str = String(rawError);
  // "Error(Contract, #23)" → 23
  const match = str.match(/#(\d+)/);
  if (match) return parseInt(match[1], 10);
  // plain numeric string
  const num = parseInt(str, 10);
  return Number.isFinite(num) ? num : null;
}

/**
 * Returns a user-friendly message, hint and retryable flag for a given error code.
 * Falls back to a generic message when the code is not recognised.
 *
 * @param {string|number|unknown} rawError - Raw error code or Soroban error string.
 * @returns {{ message: string, hint: string, retryable: boolean }}
 */
export function getErrorMessage(rawError) {
  const code = parseErrorCode(rawError);
  if (code !== null && ERROR_MESSAGES[code]) {
    return ERROR_MESSAGES[code];
  }
  return {
    message: 'Something went wrong.',
    hint: 'Please try again or contact support if the problem persists.',
    retryable: true,
  };
}

// ── Toast notification system ─────────────────────────────────────────────────

let _toastContainer = null;

/**
 * Returns (creating if necessary) the toast container element.
 * @returns {HTMLElement}
 */
function getToastContainer() {
  if (_toastContainer && document.body.contains(_toastContainer)) {
    return _toastContainer;
  }
  _toastContainer = document.createElement('div');
  _toastContainer.id = 'lf-toast-container';
  _toastContainer.setAttribute('role', 'region');
  _toastContainer.setAttribute('aria-label', 'Notifications');
  _toastContainer.setAttribute('aria-live', 'polite');
  _toastContainer.setAttribute('aria-atomic', 'false');
  _toastContainer.style.cssText = [
    'position:fixed',
    'bottom:1.5rem',
    'right:1.5rem',
    'z-index:9999',
    'display:flex',
    'flex-direction:column',
    'gap:0.5rem',
    'max-width:min(360px, calc(100vw - 2rem))',
    'pointer-events:none',
  ].join(';');
  document.body.appendChild(_toastContainer);
  return _toastContainer;
}

/**
 * Injects toast CSS into <head> once per page load.
 */
function ensureToastStyles() {
  if (document.getElementById('lf-toast-styles')) return;
  const style = document.createElement('style');
  style.id = 'lf-toast-styles';
  style.textContent = `
    .lf-toast {
      display: flex;
      align-items: flex-start;
      gap: 0.6rem;
      background: #1a1a2e;
      color: #f5f7fa;
      border-radius: 10px;
      padding: 0.75rem 1rem;
      font-size: 0.875rem;
      line-height: 1.4;
      box-shadow: 0 4px 20px rgba(0,0,0,0.18);
      pointer-events: auto;
      opacity: 0;
      transform: translateY(0.5rem);
      transition: opacity 0.2s ease, transform 0.2s ease;
      max-width: 100%;
      word-break: break-word;
    }
    .lf-toast.lf-toast--visible {
      opacity: 1;
      transform: translateY(0);
    }
    .lf-toast.lf-toast--hiding {
      opacity: 0;
      transform: translateY(0.5rem);
    }
    .lf-toast--success { border-left: 4px solid #1a9e5c; }
    .lf-toast--error   { border-left: 4px solid #c0392b; }
    .lf-toast--info    { border-left: 4px solid #6c47ff; }
    .lf-toast--warning { border-left: 4px solid #e07b00; }
    .lf-toast__icon { font-size: 1.1rem; flex-shrink: 0; margin-top: 0.05rem; }
    .lf-toast__body { flex: 1; }
    .lf-toast__message { font-weight: 600; }
    .lf-toast__hint {
      font-size: 0.8rem;
      color: #b0b8c8;
      margin-top: 0.2rem;
    }
    .lf-toast__close {
      background: none;
      border: none;
      color: #b0b8c8;
      cursor: pointer;
      font-size: 1.1rem;
      line-height: 1;
      padding: 0;
      flex-shrink: 0;
      min-height: unset;
      min-width: unset;
      align-self: flex-start;
      pointer-events: auto;
    }
    .lf-toast__close:hover { color: #f5f7fa; }
    .lf-toast__retry {
      margin-top: 0.4rem;
      background: #6c47ff;
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 0.25rem 0.7rem;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
    }
    .lf-toast__retry:hover { background: #5a37e0; }
    @media (max-width: 480px) {
      #lf-toast-container {
        bottom: 1rem !important;
        right: 1rem !important;
        left: 1rem !important;
        max-width: unset !important;
      }
    }
  `;
  document.head.appendChild(style);
}

const TOAST_ICONS = {
  success: '✓',
  error:   '✕',
  info:    'ℹ',
  warning: '⚠',
};

/**
 * Shows a toast notification.
 *
 * @param {'success'|'error'|'info'|'warning'} type
 * @param {string} message  Primary message line.
 * @param {string} [hint]   Optional secondary hint line.
 * @param {number} [duration=8000]  Auto-dismiss delay in ms. 0 = never auto-dismiss.
 * @param {{ retryable?: boolean, onRetry?: () => void }} [options]
 */
export function showToast(type = 'info', message = '', hint = '', duration = 8000, options = {}) {
  ensureToastStyles();
  const container = getToastContainer();
  const { retryable = false, onRetry } = options;

  const toast = document.createElement('div');
  toast.className = `lf-toast lf-toast--${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.innerHTML = `
    <span class="lf-toast__icon" aria-hidden="true">${TOAST_ICONS[type] ?? 'ℹ'}</span>
    <div class="lf-toast__body">
      <div class="lf-toast__message">${escapeHtml(message)}</div>
      ${hint ? `<div class="lf-toast__hint">${escapeHtml(hint)}</div>` : ''}
      ${retryable ? '<button class="lf-toast__retry" type="button">Retry</button>' : ''}
    </div>
    <button class="lf-toast__close" aria-label="Dismiss notification">×</button>
  `;

  const dismiss = () => {
    toast.classList.add('lf-toast--hiding');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  };

  toast.querySelector('.lf-toast__close').addEventListener('click', dismiss);

  const retryBtn = toast.querySelector('.lf-toast__retry');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      dismiss();
      if (typeof onRetry === 'function') onRetry();
    });
  }

  container.appendChild(toast);
  // Trigger enter animation on next frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('lf-toast--visible'));
  });

  if (duration > 0) {
    setTimeout(dismiss, duration);
  }

  return { dismiss };
}

/**
 * Convenience wrapper: parse a raw contract error and show it as an error toast.
 * The toast always shows the mapped, human-readable message (never the raw code).
 * When the error is retryable, a Retry button is rendered on the toast.
 *
 * @param {string|number|unknown} rawError
 * @param {{ onRetry?: () => void }} [options]
 */
export function showContractError(rawError, options = {}) {
  const { message, hint, retryable } = getErrorMessage(rawError);
  const { onRetry } = options;
  showToast('error', message, hint, 8000, {
    retryable,
    onRetry: retryable ? onRetry : undefined,
  });
}

// ── HTML escape helper ────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
