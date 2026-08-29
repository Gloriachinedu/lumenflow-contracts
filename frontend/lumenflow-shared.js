/**
feat/stellar-address-validation
 * LumenFlow Shared Utilities
 * Common validation and helper functions for LumenFlow frontend applications
 */

/**
 * Validates a Stellar public key (G-address)
 * 
 * Stellar public keys are 56 characters long, start with 'G',
 * and use base32 encoding with a checksum.
 * 
 * @param {string} value - The address to validate
 * @returns {boolean} True if valid Stellar public key, false otherwise
 */
export function isValidStellarAddress(value) {
  if (!value || typeof value !== 'string') {
    return false;
  }
  
  const trimmed = value.trim();
  
  // Basic format check: must start with 'G' and be 56 characters
  if (trimmed.length !== 56 || trimmed[0] !== 'G') {
    return false;
  }
  
  // Base32 character set (A-Z and 2-7)
  const base32Regex = /^[A-Z2-7]+$/;
  if (!base32Regex.test(trimmed)) {
    return false;
  }
  
  // Note: For full checksum validation, you would use @stellar/stellar-sdk's StrKey.decodeEd25519PublicKey
  // This regex-based validation is a lightweight first-pass check
  // For production use with the SDK, consider using:
  // import { StrKey } from '@stellar/stellar-sdk';
  // try { StrKey.decodeEd25519PublicKey(trimmed); return true; } catch { return false; }
  
  return true;
}

/**
 * Validates a Stellar contract ID (C-address)
 * 
 * Stellar contract IDs are 56 characters long, start with 'C',
 * and use base32 encoding with a checksum.
 * 
 * @param {string} value - The contract ID to validate
 * @returns {boolean} True if valid Stellar contract ID, false otherwise
 */
export function isValidStellarContractId(value) {
  if (!value || typeof value !== 'string') {
    return false;
  }
  
  const trimmed = value.trim();
  
  // Basic format check: must start with 'C' and be 56 characters
  if (trimmed.length !== 56 || trimmed[0] !== 'C') {
    return false;
  }
  
  // Base32 character set (A-Z and 2-7)
  const base32Regex = /^[A-Z2-7]+$/;
  if (!base32Regex.test(trimmed)) {
    return false;
  }
  
  return true;
 * lumenflow-shared.js
 * Shared utilities for LumenFlow frontend pages.
 * Import via: <script type="module" src="lumenflow-shared.js"></script>
 */

// ── Config ────────────────────────────────────────────────────────────────────
// Pages can override these by setting window.LUMENFLOW_CONTRACT_ID etc. before
// loading this module, or by injecting them at build/serve time.

export const CONTRACT_ID = window.LUMENFLOW_CONTRACT_ID || '';
export const RPC_URL     = window.LUMENFLOW_RPC_URL     || 'https://soroban-testnet.stellar.org';
export const NETWORK     = window.LUMENFLOW_NETWORK     || 'testnet';

/** True when no live contract is configured; pages render with mock data. */
export const DEMO_MODE = !CONTRACT_ID;

// ── Status helpers ────────────────────────────────────────────────────────────

/** Maps contract PaymentStatus enum values to UI labels and CSS class suffixes. */
export const STATUS_MAP = {
  Completed:         { label: '✔ Completed',          cls: 'status-completed'         },
  PartiallyRefunded: { label: '↩ Partially Refunded', cls: 'status-partiallyrefunded' },
  FullyRefunded:     { label: '↩ Fully Refunded',     cls: 'status-fullyrefunded'     },
};

/**
 * Returns an HTML string for a status badge.
 * @param {string} status - Contract PaymentStatus value.
 * @returns {string}
 */
export function statusBadgeHtml(status) {
  const entry = STATUS_MAP[status] || { label: status || 'Unknown', cls: 'status-unknown' };
  return `<span class="status-badge ${entry.cls}">${entry.label}</span>`;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

/**
 * Formats a raw integer amount (e.g. stroops) into a human-readable string
 * with the token symbol appended.
 *
 * Satisfies issue #553: formatAmount(amount, decimals, symbol) utility.
 *
 * @param {bigint|number|string} amount  - Raw integer amount in smallest unit.
 * @param {number}               decimals - Decimal precision (default 7 for XLM).
 * @param {string}               [symbol] - Token symbol to append (e.g. 'XLM').
 *                                          When omitted no symbol is appended.
 * @returns {string}  e.g. '1,234.5670000 XLM'
 */
export function formatAmount(amount, decimals = 7, symbol) {
  const value = Number(amount) / Math.pow(10, decimals);
  const formatted = formatNumber(value, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return symbol ? `${formatted} ${symbol}` : formatted;
}

/**
 * Formats a Unix timestamp (seconds) into a locale-aware date/time string
 * using the user's browser locale and local timezone.
 *
 * Satisfies issue #555: Intl.DateTimeFormat with the user's browser locale.
 * Timestamps are stored as UTC Unix seconds; display timezone is local.
 *
 * @param {bigint|number|string} timestamp - Unix seconds (UTC).
 * @returns {string}
 */
export function formatDate(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    year:   'numeric',
    month:  'short',
    day:    'numeric',
    hour:   '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(Number(timestamp) * 1000));
}

/**
 * Formats a numeric value using the user's browser locale.
 *
 * Satisfies issue #555: Intl.NumberFormat with the user's browser locale.
 *
 * @param {number}  value   - The number to format.
 * @param {Intl.NumberFormatOptions} [options] - Optional Intl.NumberFormat options.
 * @returns {string}
 */
export function formatNumber(value, options = {}) {
  return new Intl.NumberFormat(undefined, options).format(value);
}

// ── Token metadata ────────────────────────────────────────────────────────────

/**
 * Registry of known token contract IDs mapped to display metadata.
 * Keys are Stellar contract/asset IDs; the 'native' key covers XLM.
 * Add entries here as new tokens are supported by LumenFlow.
 */
export const TOKEN_METADATA = {
  // Native XLM (stroop-based, 7 decimal places)
  native: { symbol: 'XLM', decimals: 7, name: 'Stellar Lumens' },
  // USDC on Stellar testnet (Circle)
  CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC: { symbol: 'USDC', decimals: 6, name: 'USD Coin' },
  // USDC on Stellar mainnet (Circle)
  CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75: { symbol: 'USDC', decimals: 6, name: 'USD Coin' },
  // Generic fallback is handled in getTokenMetadata()
};

/** Fallback metadata returned for unrecognised token IDs. */
const FALLBACK_METADATA = { symbol: 'TOKEN', decimals: 7, name: 'Unknown Token' };

/**
 * Looks up token metadata from the TOKEN_METADATA registry.
 * Returns a fallback object when the token is not found.
 * @param {string} tokenId - Contract/asset ID or 'native'.
 * @returns {{ symbol: string, decimals: number, name: string }}
 */
export function getTokenMetadata(tokenId) {
  if (!tokenId) return FALLBACK_METADATA;
  return TOKEN_METADATA[tokenId] || FALLBACK_METADATA;
}

/**
 * Formats a raw integer amount (e.g. stroops) into a human-readable string
 * using the correct decimal precision and symbol for the given token.
 * Uses the user's browser locale for number formatting (issue #555).
 * Examples: '5.00 USDC', '5.0000000 XLM', '1.2345678 TOKEN'
 * @param {bigint|number|string} amount - Raw integer amount.
 * @param {string} tokenId - Contract/asset ID or 'native'.
 * @returns {string}
 */
export function formatTokenAmount(amount, tokenId) {
  const { symbol, decimals } = getTokenMetadata(tokenId);
  const value = Number(amount) / Math.pow(10, decimals);
  const formatted = formatNumber(value, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${formatted} ${symbol}`;
}

/**
 * Hardcoded exchange rate table for demo purposes.
 * Maps token symbol to its XLM equivalent rate (1 token = N XLM).
 */
const XLM_RATES = {
  XLM:   1,
  USDC:  8,     // 1 USDC ≈ 8 XLM (demo rate)
  TOKEN: 1,     // unknown tokens default 1:1
};

/**
 * Converts a raw token amount to an approximate XLM equivalent.
 * Uses a hardcoded demo rate table — not suitable for production pricing.
 * Uses the user's browser locale for number formatting (issue #555).
 * @param {bigint|number|string} amount - Raw integer amount in token's smallest unit.
 * @param {string} tokenId - Contract/asset ID or 'native'.
 * @returns {string} Formatted XLM string, e.g. '40.0000000 XLM'
 */
export function convertToXlm(amount, tokenId) {
  const { symbol, decimals } = getTokenMetadata(tokenId);
  const humanAmount = Number(amount) / Math.pow(10, decimals);
  const rate = XLM_RATES[symbol] ?? 1;
  const xlmAmount = humanAmount * rate;
  const formatted = formatNumber(xlmAmount, {
    minimumFractionDigits: 7,
    maximumFractionDigits: 7,
  });
  return `${formatted} XLM`;
}

// ── Global loading overlay (#556) ────────────────────────────────────────────

/**
 * Injects the CSS for the global loading overlay once per page.
 * The overlay is a full-page semi-transparent backdrop that blocks all input
 * while a contract transaction is pending.
 */
function ensureOverlayStyles() {
  if (document.getElementById('lf-overlay-styles')) return;
  const style = document.createElement('style');
  style.id = 'lf-overlay-styles';
  style.textContent = `
    #lf-loading-overlay {
      position: fixed;
      inset: 0;
      background: rgba(26, 26, 46, 0.6);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1.25rem;
      z-index: 99999;
      /* Overlay cannot be dismissed by pointer events on the backdrop */
      pointer-events: all;
    }
    #lf-loading-overlay[hidden] { display: none; }

    #lf-loading-overlay .lf-overlay-box {
      background: #fff;
      border-radius: 14px;
      padding: 2rem 2.5rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
      box-shadow: 0 8px 32px rgba(0,0,0,0.18);
      max-width: 320px;
      width: 90vw;
      text-align: center;
      pointer-events: all;
    }

    #lf-loading-overlay .lf-overlay-spinner {
      width: 48px;
      height: 48px;
      border: 4px solid #e0d9ff;
      border-top-color: #6c47ff;
      border-radius: 50%;
      animation: lf-spin 0.8s linear infinite;
      flex-shrink: 0;
    }
    @keyframes lf-spin {
      to { transform: rotate(360deg); }
    }

    #lf-loading-overlay .lf-overlay-msg {
      font-size: 0.95rem;
      font-weight: 600;
      color: #1a1a2e;
      line-height: 1.45;
    }

    /* Disable all interactive elements while overlay is visible */
    body.lf-tx-pending button,
    body.lf-tx-pending input,
    body.lf-tx-pending select,
    body.lf-tx-pending textarea,
    body.lf-tx-pending a[href] {
      pointer-events: none;
      opacity: 0.5;
    }
    /* Re-enable the overlay box itself so it is never dimmed */
    body.lf-tx-pending #lf-loading-overlay,
    body.lf-tx-pending #lf-loading-overlay * {
      pointer-events: all;
      opacity: 1;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Shows the global transaction loading overlay.
 *
 * - Renders a full-page semi-transparent backdrop with a spinner.
 * - Disables all form inputs and buttons via the `lf-tx-pending` class.
 * - The overlay has role="dialog" aria-modal="true" and a descriptive label
 *   so screen readers announce the pending state (issue #556 accessibility).
 * - Cannot be dismissed by clicking outside (pointer-events block the backdrop).
 *
 * Call `hideLoadingOverlay()` when the transaction settles (success or failure).
 *
 * @param {string} [message] - Optional custom message. Defaults to
 *   "Waiting for transaction confirmation…".
 */
export function showLoadingOverlay(message = 'Waiting for transaction confirmation…') {
  ensureOverlayStyles();

  let overlay = document.getElementById('lf-loading-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'lf-loading-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Transaction pending');
    overlay.setAttribute('aria-live', 'assertive');
    overlay.innerHTML = `
      <div class="lf-overlay-box">
        <div class="lf-overlay-spinner" aria-hidden="true"></div>
        <p class="lf-overlay-msg" id="lf-overlay-msg-text"></p>
      </div>`;
    document.body.appendChild(overlay);
  }

  document.getElementById('lf-overlay-msg-text').textContent = message;
  overlay.removeAttribute('hidden');
  document.body.classList.add('lf-tx-pending');

  // Trap focus inside the overlay so keyboard users cannot reach disabled controls
  overlay.focus && overlay.setAttribute('tabindex', '-1');
  overlay.focus({ preventScroll: true });
}

/**
 * Hides the global transaction loading overlay and re-enables all inputs.
 */
export function hideLoadingOverlay() {
  const overlay = document.getElementById('lf-loading-overlay');
  if (overlay) overlay.setAttribute('hidden', '');
  document.body.classList.remove('lf-tx-pending');
}

// ── Copy-to-clipboard ────────────────────────────────────────────────────────

/**
 * Copies `text` to the clipboard using navigator.clipboard with a textarea
 * fallback for older browsers.
 *
 * @param {string} text - The full untruncated value to copy.
 * @returns {Promise<boolean>} Resolves true on success, false on failure.
 */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // Fallback for non-HTTPS or older browsers
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Returns an HTML string for a copy-icon button.
 * Attach a click handler that calls `copyToClipboard(fullValue)`.
 *
 * @param {string} fullValue   - The complete string to copy (stored in data-copy).
 * @param {string} [ariaLabel] - Accessible label, e.g. "Copy address".
 * @returns {string} HTML string.
 */
export function copyButtonHtml(fullValue, ariaLabel = 'Copy') {
  const escaped = fullValue.replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  return `<button
    class="lf-copy-btn"
    type="button"
    data-copy="${escaped}"
    aria-label="${ariaLabel}"
    title="${ariaLabel}"
  ><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>`;
}

/**
 * Injects copy-button CSS once and wires up click delegation on a root element.
 * Shows a brief "Copied!" tooltip on success.
 *
 * Call once per page: `initCopyButtons(document.body)`.
 *
 * @param {Element} [root=document.body]
 */
export function initCopyButtons(root = document.body) {
  // Styles
  if (!document.getElementById('lf-copy-styles')) {
    const style = document.createElement('style');
    style.id = 'lf-copy-styles';
    style.textContent = `
      .lf-copy-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: none;
        border: 1px solid transparent;
        border-radius: 5px;
        padding: 2px 4px;
        cursor: pointer;
        color: #6c47ff;
        vertical-align: middle;
        margin-left: 4px;
        min-height: unset;
        min-width: unset;
        transition: background 0.15s, border-color 0.15s, color 0.15s;
        position: relative;
      }
      .lf-copy-btn:hover {
        background: #f0ecff;
        border-color: #6c47ff;
      }
      .lf-copy-btn:focus-visible {
        outline: 3px solid #6c47ff;
        outline-offset: 2px;
      }
      .lf-copy-btn--success {
        color: #1a9e5c !important;
        border-color: #1a9e5c !important;
        background: #e6f9f0 !important;
      }
      .lf-copy-tooltip {
        position: absolute;
        bottom: calc(100% + 6px);
        left: 50%;
        transform: translateX(-50%);
        background: #1a1a2e;
        color: #fff;
        font-size: 0.7rem;
        font-weight: 600;
        padding: 3px 7px;
        border-radius: 5px;
        white-space: nowrap;
        pointer-events: none;
        z-index: 9999;
        animation: lf-tooltip-in 0.15s ease forwards;
      }
      .lf-copy-tooltip::after {
        content: '';
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        border: 4px solid transparent;
        border-top-color: #1a1a2e;
      }
      @keyframes lf-tooltip-in {
        from { opacity: 0; transform: translateX(-50%) translateY(3px); }
        to   { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }

  // Click delegation
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('.lf-copy-btn');
    if (!btn) return;
    const text = btn.dataset.copy;
    if (!text) return;

    const ok = await copyToClipboard(text);
    if (ok) {
      btn.classList.add('lf-copy-btn--success');
      // Tooltip
      const tip = document.createElement('span');
      tip.className = 'lf-copy-tooltip';
      tip.textContent = 'Copied!';
      tip.setAttribute('role', 'tooltip');
      btn.appendChild(tip);
      setTimeout(() => {
        btn.classList.remove('lf-copy-btn--success');
        tip.remove();
      }, 1800);
    }
  });
}

// ── Mode banner / toggle ──────────────────────────────────────────────────────

/**
 * CSS for the mode toggle banner.  Injected once per page load.
 */
function ensureModeBannerStyles() {
  if (document.getElementById('lf-mode-banner-styles')) return;
  const style = document.createElement('style');
  style.id = 'lf-mode-banner-styles';
  style.textContent = `
    #lf-mode-banner {
      position: sticky;
      top: 0;
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      padding: 0.45rem 1rem;
      font-size: 0.8rem;
      font-weight: 600;
      transition: background 0.25s, color 0.25s;
    }
    #lf-mode-banner.lf-mode--demo {
      background: #fff3cd;
      color: #856404;
      border-bottom: 1px solid #fde08b;
    }
    #lf-mode-banner.lf-mode--live {
      background: #d1f3e0;
      color: #1a5e37;
      border-bottom: 1px solid #a8e6c3;
    }
    #lf-mode-banner .lf-mode-label { flex: 1; text-align: center; }

    /* Toggle pill */
    .lf-mode-toggle {
      position: relative;
      display: inline-flex;
      align-items: center;
      cursor: pointer;
      user-select: none;
      flex-shrink: 0;
    }
    .lf-mode-toggle input {
      position: absolute;
      opacity: 0;
      width: 0;
      height: 0;
      min-height: unset;
      min-width: unset;
    }
    .lf-mode-toggle__track {
      width: 40px;
      height: 22px;
      background: #d6a800;
      border-radius: 999px;
      transition: background 0.2s;
      position: relative;
      flex-shrink: 0;
    }
    .lf-mode-toggle input:checked + .lf-mode-toggle__track {
      background: #1a9e5c;
    }
    .lf-mode-toggle__thumb {
      position: absolute;
      top: 3px;
      left: 3px;
      width: 16px;
      height: 16px;
      background: #fff;
      border-radius: 50%;
      transition: transform 0.2s;
      box-shadow: 0 1px 4px rgba(0,0,0,0.25);
    }
    .lf-mode-toggle input:checked ~ .lf-mode-toggle__track .lf-mode-toggle__thumb,
    .lf-mode-toggle input:checked + .lf-mode-toggle__track .lf-mode-toggle__thumb {
      transform: translateX(18px);
    }
    .lf-mode-toggle__text {
      margin-left: 0.45rem;
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .lf-mode-toggle:focus-within .lf-mode-toggle__track {
      outline: 3px solid #6c47ff;
      outline-offset: 2px;
    }
    /* Badge pill beside contract info */
    .lf-mode-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.72rem;
      font-weight: 700;
      padding: 0.15rem 0.5rem;
      border-radius: 999px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .lf-mode-badge--demo { background: #fde08b; color: #7a5500; }
    .lf-mode-badge--live { background: #a8e6c3; color: #0e5e35; }
    .lf-mode-badge__dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
      display: inline-block;
    }
    .lf-mode-badge--live .lf-mode-badge__dot {
      animation: lf-pulse 1.4s infinite;
    }
    @keyframes lf-pulse {
      0%,100% { opacity: 1; }
      50%      { opacity: 0.35; }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Injects a sticky demo/live mode banner at the top of <body>.
 * Includes a toggle switch so users can switch between demo and live mode
 * at runtime (live mode requires LUMENFLOW_CONTRACT_ID to be set).
 *
 * Emits a custom 'lf:modechange' event on window when the mode changes.
 *
 * Call once per page after DOMContentLoaded.
 */
export function renderModeBanner() {
  ensureModeBannerStyles();

  const isLive = !DEMO_MODE;
  const canGoLive = Boolean(window.LUMENFLOW_CONTRACT_ID);

  const banner = document.createElement('div');
  banner.id = 'lf-mode-banner';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  banner.classList.add(isLive ? 'lf-mode--live' : 'lf-mode--demo');

  // Build badge
  const badgeCls  = isLive ? 'lf-mode-badge--live'  : 'lf-mode-badge--demo';
  const badgeText = isLive ? 'Live'                  : 'Demo';

  // Build descriptive text
  const labelText = isLive
    ? `Connected to contract <code>${CONTRACT_ID.slice(0, 8)}…</code> on <strong>${NETWORK}</strong>.`
    : 'Displaying mock data. Set <code>LUMENFLOW_CONTRACT_ID</code> to connect to a live contract.';

  banner.innerHTML = `
    <span class="lf-mode-badge ${badgeCls}" aria-hidden="true">
      <span class="lf-mode-badge__dot"></span>${badgeText}
    </span>
    <span class="lf-mode-label">${labelText}</span>
    <label class="lf-mode-toggle" title="${canGoLive ? 'Switch between demo and live mode' : 'Set LUMENFLOW_CONTRACT_ID to enable live mode'}">
      <input
        type="checkbox"
        id="lf-mode-checkbox"
        role="switch"
        aria-label="Live mode"
        aria-checked="${isLive}"
        ${isLive ? 'checked' : ''}
        ${canGoLive ? '' : 'disabled'}
      />
      <span class="lf-mode-toggle__track">
        <span class="lf-mode-toggle__thumb"></span>
      </span>
      <span class="lf-mode-toggle__text" aria-hidden="true">${isLive ? 'Live' : 'Demo'}</span>
    </label>
  `;

  document.body.prepend(banner);

  // Toggle handler – switches visual state and emits event.
  // Actual data reload is the responsibility of each page's 'lf:modechange' listener.
  const checkbox = banner.querySelector('#lf-mode-checkbox');
  checkbox.addEventListener('change', () => {
    const nowLive = checkbox.checked;
    checkbox.setAttribute('aria-checked', String(nowLive));

    banner.classList.toggle('lf-mode--live', nowLive);
    banner.classList.toggle('lf-mode--demo', !nowLive);

    const badge    = banner.querySelector('.lf-mode-badge');
    const labelEl  = banner.querySelector('.lf-mode-label');
    const textEl   = banner.querySelector('.lf-mode-toggle__text');

    badge.className = `lf-mode-badge ${nowLive ? 'lf-mode-badge--live' : 'lf-mode-badge--demo'}`;
    badge.innerHTML = `<span class="lf-mode-badge__dot"></span>${nowLive ? 'Live' : 'Demo'}`;
    textEl.textContent = nowLive ? 'Live' : 'Demo';
    labelEl.innerHTML = nowLive
      ? `Connected to contract <code>${CONTRACT_ID.slice(0, 8)}…</code> on <strong>${NETWORK}</strong>.`
      : 'Displaying mock data. Set <code>LUMENFLOW_CONTRACT_ID</code> to connect to a live contract.';

    window.dispatchEvent(new CustomEvent('lf:modechange', { detail: { live: nowLive } }));
}

// ── Copy to clipboard ─────────────────────────────────────────────────────────

/**
 * Copies `text` to the clipboard using navigator.clipboard when available,
 * falling back to a legacy execCommand approach for older browsers.
 *
 * @param {string} text - The full, untruncated value to copy.
 * @returns {Promise<void>}
 */
export async function copyToClipboard(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Legacy fallback
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}

/**
 * Builds an inline copy-to-clipboard button element.
 *
 * @param {string} value    - The full value to copy (untruncated).
 * @param {string} [label]  - Accessible label. Defaults to "Copy value".
 * @returns {HTMLButtonElement}
 */
export function makeCopyButton(value, label = 'Copy value') {
  const btn = document.createElement('button');
  btn.className = 'lf-copy-btn';
  btn.setAttribute('aria-label', label);
  btn.setAttribute('type', 'button');
  btn.title = 'Copy to clipboard';
  btn.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'justify-content:center',
    'background:none',
    'border:1px solid #d0d5dd',
    'border-radius:5px',
    'cursor:pointer',
    'padding:0.15rem 0.35rem',
    'margin-left:0.35rem',
    'color:#666',
    'font-size:0.85rem',
    'vertical-align:middle',
    'transition:background 0.15s,color 0.15s,border-color 0.15s',
    'line-height:1',
  ].join(';');

  // Clipboard SVG icon (accessible, 16×16)
  btn.innerHTML = `<svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
  </svg>`;

  let resetTimer = null;

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await copyToClipboard(value);
      // Success: swap icon to checkmark and show tooltip
      btn.innerHTML = `<svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24"
        fill="none" stroke="#1a9e5c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>`;
      btn.style.borderColor = '#1a9e5c';
      btn.style.color = '#1a9e5c';
      btn.setAttribute('aria-label', 'Copied!');

      // Show "Copied!" tooltip
      _showCopiedTooltip(btn);

      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        btn.innerHTML = `<svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>`;
        btn.style.borderColor = '#d0d5dd';
        btn.style.color = '#666';
        btn.setAttribute('aria-label', label);
      }, 2000);
    } catch {
      btn.setAttribute('aria-label', 'Copy failed');
      setTimeout(() => btn.setAttribute('aria-label', label), 2000);
    }
  });

  return btn;
}

/**
 * Returns an HTML string containing a truncated address/ID plus an inline
 * copy button. Safe to inject via innerHTML.
 *
 * @param {string} value         - Full untruncated value.
 * @param {number} [truncate=8]  - Characters to show before the ellipsis (0 = no truncation).
 * @param {string} [type='address'] - Used for the aria-label: "Copy address" or "Copy order ID".
 * @returns {string}             - HTML string with a data-copy-value attribute the button reads.
 */
export function copyableHtml(value, truncate = 8, type = 'address') {
  const display = truncate > 0 && value.length > truncate + 1
    ? `${value.slice(0, truncate)}…`
    : value;
  const label = type === 'order' ? 'Copy order ID' : `Copy address`;
  // The button is rendered client-side via attachCopyButtons(); this HTML acts
  // as a placeholder that attachCopyButtons() upgrades.
  return `<span class="lf-copyable" data-copy-value="${value}" data-copy-label="${label}" title="${value}"><code>${display}</code></span>`;
}

/**
 * Finds every .lf-copyable element in `root` and appends a live copy button
 * to each one. Call after injecting dynamic HTML.
 *
 * @param {Element} [root=document] - The element to search within.
 */
export function attachCopyButtons(root = document) {
  root.querySelectorAll('.lf-copyable:not([data-copy-attached])').forEach(el => {
    const value = el.getAttribute('data-copy-value') || '';
    const label = el.getAttribute('data-copy-label') || 'Copy value';
    el.setAttribute('data-copy-attached', '1');
    const btn = makeCopyButton(value, label);
    el.appendChild(btn);
  });
}

/** Shows a short "Copied!" tooltip above the copy button. */
function _showCopiedTooltip(btn) {
  const tip = document.createElement('span');
  tip.textContent = 'Copied!';
  tip.setAttribute('aria-hidden', 'true');
  tip.style.cssText = [
    'position:absolute',
    'bottom:calc(100% + 6px)',
    'left:50%',
    'transform:translateX(-50%)',
    'background:#1a1a2e',
    'color:#fff',
    'font-size:0.72rem',
    'font-weight:600',
    'padding:0.2rem 0.5rem',
    'border-radius:4px',
    'white-space:nowrap',
    'pointer-events:none',
    'z-index:10000',
    'opacity:0',
    'transition:opacity 0.15s',
  ].join(';');

  // Button needs relative positioning for the tooltip
  const prevPosition = btn.style.position;
  btn.style.position = 'relative';
  btn.appendChild(tip);

  requestAnimationFrame(() => {
    tip.style.opacity = '1';
    setTimeout(() => {
      tip.style.opacity = '0';
      setTimeout(() => {
        tip.remove();
        btn.style.position = prevPosition;
      }, 160);
    }, 1400);
  });
}
