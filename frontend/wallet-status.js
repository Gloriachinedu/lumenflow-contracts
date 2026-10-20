/**
 * wallet-status.js
 *
 * Real-time wallet connection status chip for LumenFlow navigation bar.
 *
 * Usage:
 *   import { initWalletStatus } from './wallet-status.js';
 *   initWalletStatus(document.getElementById('wallet-status-container'));
 *
 * The chip polls Freighter every 1 500 ms and emits a 'lf:walletchange'
 * CustomEvent on window whenever the connection state changes.
 *
 * In demo mode (no window.freighter present) the chip simulates a connect /
 * disconnect flow so the UI is usable during static preview.
 */

// ── CSS (injected once) ───────────────────────────────────────────────────────

const STYLE_ID = 'lf-wallet-status-styles';

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* ── Wallet chip ─────────────────────────────────────────────────────── */
    .wallet-chip {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.3rem 0.75rem;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 600;
      cursor: pointer;
      border: 1.5px solid;
      transition: all 0.2s;
      user-select: none;
      white-space: nowrap;
    }

    .wallet-chip:focus-visible {
      outline: 3px solid #6c47ff;
      outline-offset: 2px;
    }

    .wallet-chip.connected {
      border-color: #1a9e5c;
      background: #e6f9f0;
      color: #0e7a45;
    }

    .wallet-chip.disconnected {
      border-color: #dde1e7;
      background: #f5f5f5;
      color: #666;
    }

    .wallet-chip__dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
      flex-shrink: 0;
    }

    .wallet-chip.connected .wallet-chip__dot {
      animation: lf-pulse 1.4s infinite;
    }

    @keyframes lf-pulse {
      0%   { opacity: 1;   transform: scale(1);    }
      50%  { opacity: 0.5; transform: scale(1.25); }
      100% { opacity: 1;   transform: scale(1);    }
    }

    /* ── Dropdown ────────────────────────────────────────────────────────── */
    .wallet-dropdown {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      background: #fff;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.12);
      min-width: 160px;
      z-index: 999;
      overflow: hidden;
    }

    .wallet-dropdown button {
      display: block;
      width: 100%;
      padding: 0.6rem 1rem;
      text-align: left;
      border: none;
      background: none;
      cursor: pointer;
      font-size: 0.875rem;
      color: #1a1a2e;
    }

    .wallet-dropdown button:hover {
      background: #f5f7fa;
    }

    .wallet-dropdown button:focus-visible {
      outline: 3px solid #6c47ff;
      outline-offset: -2px;
    }

    /* ── Nav bar ─────────────────────────────────────────────────────────── */
    .lf-nav {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem 1.5rem;
      background: #fff;
      border-bottom: 1px solid #eee;
      margin-bottom: 1.5rem;
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .lf-nav__brand {
      font-size: 1rem;
      font-weight: 700;
      color: #6c47ff;
      letter-spacing: -0.01em;
    }
  `;
  document.head.appendChild(style);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Truncate a Stellar public key to "XXXX…XXXX" format (first 4 + last 4 chars).
 * @param {string} key
 * @returns {string}
 */
function truncateKey(key) {
  if (!key || key.length < 8) return key;
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/**
 * Dispatch the 'lf:walletchange' custom event on window.
 * @param {boolean} connected
 * @param {string|null} publicKey
 */
function emitWalletChange(connected, publicKey) {
  window.dispatchEvent(
    new CustomEvent('lf:walletchange', {
      bubbles: true,
      detail: { connected, publicKey: connected ? publicKey : null },
    })
  );
}

// ── Demo mode (no Freighter) ──────────────────────────────────────────────────

/**
 * Creates a simulated Freighter adapter for demo mode.
 * Toggling the chip cycles between connected and disconnected states.
 */
function createDemoAdapter() {
  const DEMO_KEY = 'GDEMO1UMENFLOW4EXAMPLE5ADDRESS6STELLAR7PUBKEY8DEMOKEY9ABCD';
  let _connected = false;
  let _key = null;

  return {
    isDemo: true,
    async isConnected() { return _connected; },
    async getPublicKey() { return _key; },
    async requestAccess() {
      await new Promise(r => setTimeout(r, 600)); // simulate async
      _connected = true;
      _key = DEMO_KEY;
      return _key;
    },
    disconnect() {
      _connected = false;
      _key = null;
    },
  };
}

// ── Freighter adapter ─────────────────────────────────────────────────────────

/**
 * Wraps the real window.freighter API.
 */
function createFreighterAdapter() {
  return {
    isDemo: false,
    async isConnected() {
      try {
        return Boolean(await window.freighter.isConnected());
      } catch {
        return false;
      }
    },
    async getPublicKey() {
      try {
        return await window.freighter.getPublicKey();
      } catch {
        return null;
      }
    },
    async requestAccess() {
      try {
        // Newer versions of Freighter expose requestAccess; fall back to getPublicKey.
        if (typeof window.freighter.requestAccess === 'function') {
          await window.freighter.requestAccess();
        }
        return await window.freighter.getPublicKey();
      } catch {
        return null;
      }
    },
    disconnect() {
      // Freighter does not expose a programmatic disconnect; we just clear local state.
    },
  };
}

// ── Core chip logic ───────────────────────────────────────────────────────────

/**
 * Insert a wallet status chip into `container` and start polling Freighter.
 *
 * @param {HTMLElement} container - The element that will receive the chip.
 */
export function initWalletStatus(container) {
  if (!container) return;

  ensureStyles();

  const adapter = window.freighter ? createFreighterAdapter() : createDemoAdapter();

  // ── Build chip DOM ──────────────────────────────────────────────────────────
  const chip = document.createElement('div');
  chip.className = 'wallet-chip disconnected';
  chip.setAttribute('role', 'button');
  chip.setAttribute('tabindex', '0');
  chip.setAttribute('aria-label', 'Wallet status: Disconnected');
  chip.innerHTML = `
    <span class="wallet-chip__dot" aria-hidden="true"></span>
    <span class="wallet-chip__label">Disconnected</span>
  `;

  container.appendChild(chip);

  // ── Internal state ──────────────────────────────────────────────────────────
  let _isConnected = false;
  let _publicKey = null;
  let _dropdownOpen = false;

  // ── Dropdown ────────────────────────────────────────────────────────────────
  function openDropdown() {
    if (_dropdownOpen) return;
    _dropdownOpen = true;

    const dropdown = document.createElement('div');
    dropdown.className = 'wallet-dropdown';
    dropdown.setAttribute('role', 'menu');

    const disconnectBtn = document.createElement('button');
    disconnectBtn.textContent = 'Disconnect';
    disconnectBtn.setAttribute('role', 'menuitem');
    disconnectBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      closeDropdown();
      adapter.disconnect();
      // Force state refresh immediately
      _isConnected = false;
      _publicKey = null;
      updateChipUI(false, null);
      emitWalletChange(false, null);
    });

    dropdown.appendChild(disconnectBtn);
    chip.appendChild(dropdown);

    // Close on outside click
    const onOutsideClick = (e) => {
      if (!chip.contains(e.target)) {
        closeDropdown();
        document.removeEventListener('click', onOutsideClick);
      }
    };
    // Use setTimeout to avoid the current click event triggering an immediate close
    setTimeout(() => document.addEventListener('click', onOutsideClick), 0);
  }

  function closeDropdown() {
    if (!_dropdownOpen) return;
    _dropdownOpen = false;
    const existing = chip.querySelector('.wallet-dropdown');
    if (existing) existing.remove();
  }

  // ── UI update ───────────────────────────────────────────────────────────────
  function updateChipUI(connected, publicKey) {
    const label = chip.querySelector('.wallet-chip__label');
    if (connected && publicKey) {
      chip.className = 'wallet-chip connected';
      chip.setAttribute('aria-label', `Wallet status: Connected`);
      label.textContent = `Connected: ${truncateKey(publicKey)}`;
    } else {
      chip.className = 'wallet-chip disconnected';
      chip.setAttribute('aria-label', 'Wallet status: Disconnected');
      label.textContent = 'Disconnected';
    }
  }

  // ── Polling ─────────────────────────────────────────────────────────────────
  async function poll() {
    try {
      const connected = await adapter.isConnected();
      const key = connected ? await adapter.getPublicKey() : null;

      // Only update and emit if state actually changed
      if (connected !== _isConnected || key !== _publicKey) {
        _isConnected = connected;
        _publicKey = key;
        updateChipUI(connected, key);
        emitWalletChange(connected, key);

        // If disconnected externally, close any open dropdown
        if (!connected) closeDropdown();
      }
    } catch {
      // Silently ignore polling errors (e.g. extension not responding)
    }
  }

  // Start polling immediately, then every 1 500 ms
  poll();
  setInterval(poll, 1500);

  // ── Click / keyboard handler ────────────────────────────────────────────────
  async function handleActivation() {
    if (_isConnected) {
      // Toggle dropdown
      if (_dropdownOpen) {
        closeDropdown();
      } else {
        openDropdown();
      }
    } else {
      // Trigger connect flow
      chip.setAttribute('aria-label', 'Wallet status: Connecting…');
      chip.querySelector('.wallet-chip__label').textContent = 'Connecting…';
      chip.style.pointerEvents = 'none';

      try {
        const key = await adapter.requestAccess();
        if (key) {
          _isConnected = true;
          _publicKey = key;
          updateChipUI(true, key);
          emitWalletChange(true, key);
        } else {
          updateChipUI(false, null);
        }
      } catch {
        updateChipUI(false, null);
      } finally {
        chip.style.pointerEvents = '';
      }
    }
  }

  chip.addEventListener('click', handleActivation);
  chip.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleActivation();
    }
    if (e.key === 'Escape') {
      closeDropdown();
    }
  });
}
