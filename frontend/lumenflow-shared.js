/**
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

// ── Mode banner ───────────────────────────────────────────────────────────────

/**
 * Injects a sticky demo/live mode banner at the top of <body>.
 * Includes a toggle button that lets the user switch between demo and live mode
 * by setting/clearing the LUMENFLOW_CONTRACT_ID in sessionStorage.
 * Call once per page after DOMContentLoaded.
 */
export function renderModeBanner() {
  const banner = document.createElement('div');
  banner.id = 'lf-mode-banner';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-label', DEMO_MODE ? 'Demo mode active' : 'Live mode active');
  banner.style.cssText = [
    'position:sticky', 'top:0', 'z-index:1000',
    'padding:0.4rem 1rem', 'font-size:0.8rem', 'font-weight:600',
    'display:flex', 'align-items:center', 'justify-content:center', 'gap:0.75rem',
    'flex-wrap:wrap',
    DEMO_MODE
      ? 'background:#fff3cd;color:#856404;'
      : 'background:#d1f3e0;color:#1a5e37;',
  ].join(';');

  const modeIndicator = document.createElement('span');
  modeIndicator.id = 'lf-mode-indicator';
  modeIndicator.setAttribute('aria-live', 'polite');
  modeIndicator.textContent = DEMO_MODE
    ? '⚠ Demo mode – displaying mock data.'
    : `✔ Live mode – connected to contract ${CONTRACT_ID.slice(0, 8)}… on ${NETWORK}.`;

  // Toggle button
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'lf-mode-toggle';
  toggleBtn.setAttribute('aria-label', DEMO_MODE ? 'Switch to live mode' : 'Switch to demo mode');
  toggleBtn.style.cssText = [
    'border:1.5px solid currentColor',
    'background:transparent',
    'color:inherit',
    'font-size:0.75rem',
    'font-weight:700',
    'padding:0.15rem 0.6rem',
    'border-radius:4px',
    'cursor:pointer',
    'white-space:nowrap',
  ].join(';');
  toggleBtn.textContent = DEMO_MODE ? 'Switch to Live' : 'Switch to Demo';

  toggleBtn.addEventListener('click', () => {
    if (DEMO_MODE) {
      // Prompt for contract ID to switch to live mode
      const id = window.prompt(
        'Enter your contract ID to switch to live mode:\n(e.g. CABC…XYZ)',
        window.sessionStorage.getItem('LUMENFLOW_CONTRACT_ID') || '',
      );
      if (id && id.trim()) {
        window.sessionStorage.setItem('LUMENFLOW_CONTRACT_ID', id.trim());
        window.location.reload();
      }
    } else {
      // Clear stored contract ID to return to demo mode
      window.sessionStorage.removeItem('LUMENFLOW_CONTRACT_ID');
      window.location.reload();
    }
  });

  // Apply sessionStorage overrides on load (allows toggle to persist across page
  // navigations without a server rebuild step)
  const stored = window.sessionStorage.getItem('LUMENFLOW_CONTRACT_ID');
  if (stored && !window.LUMENFLOW_CONTRACT_ID) {
    window.LUMENFLOW_CONTRACT_ID = stored;
  }

  banner.appendChild(modeIndicator);
  banner.appendChild(toggleBtn);
  document.body.prepend(banner);
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
