/**
 * wallet-status.js
 * Wallet connection status utilities for LumenFlow frontend.
 *
 * Provides user-friendly, i18n-ready error messages for common Freighter
 * wallet connection errors, replacing raw JavaScript error strings with
 * actionable guidance.
 *
 * Import via: <script type="module" src="wallet-status.js"></script>
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** Freighter browser extension install URL */
export const FREIGHTER_INSTALL_URL = 'https://www.freighter.app/';

/** Freighter troubleshooting guide URL */
export const FREIGHTER_TROUBLESHOOT_URL =
  'https://docs.freighter.app/docs/guide/introduction';

/**
 * Expected Stellar network passphrase for this deployment.
 * Pages can override via window.LUMENFLOW_NETWORK_PASSPHRASE.
 */
export const EXPECTED_NETWORK =
  window.LUMENFLOW_NETWORK || 'testnet';

// ── Error code constants ──────────────────────────────────────────────────────

/**
 * Canonical wallet error codes used internally.
 * @enum {string}
 */
export const WalletErrorCode = {
  NOT_FOUND:        'WALLET_NOT_FOUND',
  REJECTED:         'WALLET_REJECTED',
  WRONG_NETWORK:    'WALLET_WRONG_NETWORK',
  UNAUTHORIZED:     'WALLET_UNAUTHORIZED',
  TIMEOUT:          'WALLET_TIMEOUT',
  UNKNOWN:          'WALLET_UNKNOWN',
};

// ── i18n message catalogue ────────────────────────────────────────────────────

/**
 * Default English message catalogue.
 * Replace or extend via {@link setMessages} for i18n.
 *
 * Each entry has:
 *   - `title`  — short headline shown in UI
 *   - `detail` — longer explanation with actionable guidance (may contain HTML)
 *
 * @type {Record<string, {title: string, detail: string}>}
 */
export const DEFAULT_MESSAGES = {
  [WalletErrorCode.NOT_FOUND]: {
    title: 'Freighter wallet not found',
    detail:
      `The Freighter browser extension is not installed or not active. ` +
      `<a href="${FREIGHTER_INSTALL_URL}" target="_blank" rel="noopener noreferrer">` +
      `Install Freighter</a> and reload this page.`,
  },
  [WalletErrorCode.REJECTED]: {
    title: 'Connection request rejected',
    detail:
      `You declined the connection in Freighter. ` +
      `Please click <strong>Connect</strong> again and approve the request in the ` +
      `Freighter extension popup. ` +
      `<a href="${FREIGHTER_TROUBLESHOOT_URL}" target="_blank" rel="noopener noreferrer">` +
      `Troubleshooting guide</a>.`,
  },
  [WalletErrorCode.WRONG_NETWORK]: {
    title: 'Wrong network selected',
    detail: (currentNetwork) =>
      `Your Freighter wallet is connected to <strong>${currentNetwork || 'an unknown network'}</strong>, ` +
      `but this app requires <strong>${EXPECTED_NETWORK}</strong>. ` +
      `Please switch the network in Freighter settings and reconnect.`,
  },
  [WalletErrorCode.UNAUTHORIZED]: {
    title: 'Wallet not authorized',
    detail:
      `LumenFlow does not have permission to access your wallet. ` +
      `Open Freighter, go to <em>Connected Sites</em>, and grant access to this site.`,
  },
  [WalletErrorCode.TIMEOUT]: {
    title: 'Connection timed out',
    detail:
      `The wallet connection request timed out. ` +
      `Please ensure Freighter is open and responsive, then try again.`,
  },
  [WalletErrorCode.UNKNOWN]: {
    title: 'Wallet connection error',
    detail:
      `An unexpected error occurred while connecting your wallet. ` +
      `Please refresh the page or check the ` +
      `<a href="${FREIGHTER_TROUBLESHOOT_URL}" target="_blank" rel="noopener noreferrer">` +
      `Freighter troubleshooting guide</a>.`,
  },
};

/** Currently active message catalogue (starts with DEFAULT_MESSAGES). */
let _messages = { ...DEFAULT_MESSAGES };

/**
 * Override or extend the message catalogue for i18n.
 *
 * @param {Record<string, {title: string, detail: string|Function}>} overrides
 *   Partial or full replacement of the default catalogue.
 *
 * @example
 * // French locale
 * setMessages({
 *   [WalletErrorCode.NOT_FOUND]: {
 *     title: 'Extension Freighter introuvable',
 *     detail: `L'extension Freighter n'est pas installée. <a href="${FREIGHTER_INSTALL_URL}">Installer Freighter</a>.`,
 *   },
 * });
 */
export function setMessages(overrides) {
  _messages = { ..._messages, ...overrides };
}

/**
 * Returns the current message catalogue (after any i18n overrides).
 * @returns {Record<string, {title: string, detail: string|Function}>}
 */
export function getMessages() {
  return _messages;
}

// ── Error classification ──────────────────────────────────────────────────────

/**
 * Maps a raw wallet error (thrown by Freighter or internal code) to a
 * canonical {@link WalletErrorCode}.
 *
 * @param {Error|string|unknown} rawError - The raw error caught during wallet connection.
 * @param {object}  [context]               - Optional context hints.
 * @param {string}  [context.currentNetwork] - Network currently selected in the wallet.
 * @returns {{ code: string, currentNetwork?: string }}
 */
export function classifyWalletError(rawError, context = {}) {
  const message = rawError instanceof Error
    ? rawError.message.toLowerCase()
    : String(rawError).toLowerCase();

  // "Not found / not installed" patterns
  if (
    message.includes('not available') ||
    message.includes('not found') ||
    message.includes('not installed') ||
    message.includes('freighter is not') ||
    message.includes('no wallet') ||
    message.includes('extension not')
  ) {
    return { code: WalletErrorCode.NOT_FOUND };
  }

  // "Unauthorized / permission" patterns — check before "rejected/denied" to
  // avoid "permission denied" being caught by the REJECTED branch below.
  if (
    message.includes('unauthorized') ||
    message.includes('permission') ||
    message.includes('not allowed') ||
    message.includes('access denied')
  ) {
    return { code: WalletErrorCode.UNAUTHORIZED };
  }

  // "User rejected" patterns
  if (
    message.includes('rejected') ||
    message.includes('denied') ||
    message.includes('user declined') ||
    message.includes('user refused') ||
    message.includes('cancelled') ||
    message.includes('canceled')
  ) {
    return { code: WalletErrorCode.REJECTED };
  }

  // "Wrong network" patterns
  if (
    message.includes('network') ||
    message.includes('passphrase') ||
    message.includes('wrong chain') ||
    message.includes('mainnet') && EXPECTED_NETWORK !== 'mainnet' ||
    message.includes('testnet') && EXPECTED_NETWORK !== 'testnet'
  ) {
    return {
      code: WalletErrorCode.WRONG_NETWORK,
      currentNetwork: context.currentNetwork,
    };
  }

  // Timeout
  if (message.includes('timeout') || message.includes('timed out')) {
    return { code: WalletErrorCode.TIMEOUT };
  }

  return { code: WalletErrorCode.UNKNOWN };
}

// ── User-friendly message resolution ─────────────────────────────────────────

/**
 * Resolves a raw wallet error into a user-friendly message object.
 *
 * @param {Error|string|unknown} rawError
 * @param {object}  [context]
 * @param {string}  [context.currentNetwork] - Network currently selected in the wallet.
 * @returns {{ code: string, title: string, detail: string }}
 *
 * @example
 * try {
 *   await connectFreighter();
 * } catch (err) {
 *   const msg = resolveWalletError(err);
 *   showError(msg.title, msg.detail);
 * }
 */
export function resolveWalletError(rawError, context = {}) {
  const { code, currentNetwork } = classifyWalletError(rawError, context);
  const entry = _messages[code] || _messages[WalletErrorCode.UNKNOWN];

  const detail = typeof entry.detail === 'function'
    ? entry.detail(currentNetwork)
    : entry.detail;

  return { code, title: entry.title, detail };
}

// ── DOM helper ────────────────────────────────────────────────────────────────

/**
 * Renders a wallet error into a DOM element.
 *
 * @param {HTMLElement} container - Element to render the error into.
 * @param {Error|string|unknown} rawError - Raw error to display.
 * @param {object}  [context]
 * @param {string}  [context.currentNetwork]
 *
 * @example
 * const errorBox = document.getElementById('wallet-error');
 * renderWalletError(errorBox, err, { currentNetwork: 'mainnet' });
 */
export function renderWalletError(container, rawError, context = {}) {
  const { title, detail } = resolveWalletError(rawError, context);

  container.setAttribute('role', 'alert');
  container.setAttribute('aria-live', 'assertive');
  container.innerHTML = `
    <div class="wallet-error">
      <strong class="wallet-error__title">⚠ ${escapeHtml(title)}</strong>
      <p class="wallet-error__detail">${detail}</p>
    </div>
  `.trim();
}

/**
 * Clears a previously rendered wallet error from a container.
 * @param {HTMLElement} container
 */
export function clearWalletError(container) {
  container.removeAttribute('role');
  container.removeAttribute('aria-live');
  container.innerHTML = '';
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Escapes HTML special characters to prevent XSS in title strings.
 * Note: `detail` strings are pre-authored HTML and are trusted.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
