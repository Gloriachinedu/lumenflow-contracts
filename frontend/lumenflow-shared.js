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
 * Call once per page after DOMContentLoaded.
 */
export function renderModeBanner() {
  const banner = document.createElement('div');
  banner.id = 'lf-mode-banner';
  banner.setAttribute('role', 'status');
  banner.style.cssText = [
    'position:sticky', 'top:0', 'z-index:1000',
    'padding:0.4rem 1rem', 'font-size:0.8rem', 'font-weight:600',
    'text-align:center',
    DEMO_MODE
      ? 'background:#fff3cd;color:#856404;'
      : 'background:#d1f3e0;color:#1a5e37;',
  ].join(';');
  banner.textContent = DEMO_MODE
    ? '⚠ Demo mode – displaying mock data. Set LUMENFLOW_CONTRACT_ID to connect to a live contract.'
    : `✔ Live mode – connected to contract ${CONTRACT_ID.slice(0, 8)}… on ${NETWORK}.`;
  document.body.prepend(banner);
}
