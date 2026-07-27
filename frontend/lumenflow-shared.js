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
 * Formats a stroop amount into a human-readable XLM string.
 * @param {bigint|number|string} amount - Amount in stroops.
 * @param {number} decimals - Decimal places for the asset (default 7 for XLM).
 * @returns {string}
 */
export function formatAmount(amount, decimals = 7) {
  return (Number(amount) / Math.pow(10, decimals)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  });
}

/**
 * Formats a Unix timestamp (seconds) into a locale date/time string.
 * @param {bigint|number|string} timestamp
 * @returns {string}
 */
export function formatDate(timestamp) {
  return new Date(Number(timestamp) * 1000).toLocaleString();
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
 * Examples: '5.00 USDC', '5.0000000 XLM', '1.2345678 TOKEN'
 * @param {bigint|number|string} amount - Raw integer amount.
 * @param {string} tokenId - Contract/asset ID or 'native'.
 * @returns {string}
 */
export function formatTokenAmount(amount, tokenId) {
  const { symbol, decimals } = getTokenMetadata(tokenId);
  const value = Number(amount) / Math.pow(10, decimals);
  const formatted = value.toLocaleString(undefined, {
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
 * @param {bigint|number|string} amount - Raw integer amount in token's smallest unit.
 * @param {string} tokenId - Contract/asset ID or 'native'.
 * @returns {string} Formatted XLM string, e.g. '40.0000000 XLM'
 */
export function convertToXlm(amount, tokenId) {
  const { symbol, decimals } = getTokenMetadata(tokenId);
  const humanAmount = Number(amount) / Math.pow(10, decimals);
  const rate = XLM_RATES[symbol] ?? 1;
  const xlmAmount = humanAmount * rate;
  const formatted = xlmAmount.toLocaleString(undefined, {
    minimumFractionDigits: 7,
    maximumFractionDigits: 7,
  });
  return `${formatted} XLM`;
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
