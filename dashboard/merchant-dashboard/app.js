/* Merchant refunds dashboard
   - Connects to LumenFlowClient SDK in live mode
   - Falls back to mock data in demo mode (no CONTRACT_ID configured)
   - Tabs for Pending / Approved / Rejected / Completed
   - Approve / Reject / Execute wired to real contract calls via Freighter
   - Errors mapped to human-readable messages via ERROR_MESSAGES
   - Dark mode toggle synced with localStorage key 'lumenflow_theme'
   - CSV export of the current filtered view
*/

// ── SDK imports (resolved at runtime via importmap or bundler) ────────────────
import { LumenFlowClient }          from '../../sdk/src/client.ts';
import { ERROR_MESSAGES, LumenFlowError } from '../../sdk/src/errors.ts';
import { RefundStatus }             from '../../sdk/src/types.ts';

// ── Config ────────────────────────────────────────────────────────────────────
const CONTRACT_ID = window.LUMENFLOW_CONTRACT_ID || '';
const RPC_URL     = window.LUMENFLOW_RPC_URL     || 'https://soroban-testnet.stellar.org';
const NETWORK     = window.LUMENFLOW_NETWORK     || 'testnet';
const DEMO_MODE   = !CONTRACT_ID;

// Network passphrase map
const NETWORK_PASSPHRASES = {
  mainnet:  'Public Global Stellar Network ; September 2015',
  testnet:  'Test SDF Network ; September 2015',
  local:    'Standalone Network ; February 2017',
};
const NETWORK_PASSPHRASE = NETWORK_PASSPHRASES[NETWORK] || NETWORK_PASSPHRASES.testnet;

// ── Demo mock data ────────────────────────────────────────────────────────────
function buildMockRefunds() {
  const now = Math.floor(Date.now() / 1000);
  return [
    {
      refundId: 'REFUND_001', orderId: 'ORDER_001',
      initiator: 'GALIC3...ALICE', amount: BigInt(10_000_000),
      reason: 'Customer request', status: RefundStatus.Pending,
      createdAt: BigInt(now - 86400 * 2), token: 'native',
    },
    {
      refundId: 'REFUND_002', orderId: 'ORDER_002',
      initiator: 'GBOB4...BOB', amount: BigInt(5_000_000),
      reason: 'Duplicate charge', status: RefundStatus.Approved,
      createdAt: BigInt(now - 86400), token: 'native',
    },
    {
      refundId: 'REFUND_003', orderId: 'ORDER_003',
      initiator: 'GCARO...CAROL', amount: BigInt(20_000_000),
      reason: 'Item not received', status: RefundStatus.Completed,
      createdAt: BigInt(now - 86400 * 5), token: 'native',
    },
    {
      refundId: 'REFUND_004', orderId: 'ORDER_004',
      initiator: 'GDAVE...DAVE', amount: BigInt(3_000_000),
      reason: 'Changed mind', status: RefundStatus.Rejected,
      createdAt: BigInt(now - 86400 * 3), token: 'native',
    },
  ];
}

// ── Application state ─────────────────────────────────────────────────────────
const state = {
  status: 'pending',  // lowercase to match tab data-status; comparisons are case-insensitive
  refunds: [],        // RefundRecord[]
  wallet: null,  // { type: 'freighter', account: string }
  client: null,  // LumenFlowClient | null
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const accountEl  = document.getElementById('account');
const tableBody  = document.querySelector('#refundsTable tbody');
const emptyEl    = document.getElementById('empty');
const tableEl    = document.getElementById('refundsTable');

// ── Error helpers ─────────────────────────────────────────────────────────────
/**
 * Returns a human-readable message for any error.
 * LumenFlowError codes are mapped via ERROR_MESSAGES; others use message text.
 */
function friendlyError(err) {
  if (err instanceof LumenFlowError) {
    return ERROR_MESSAGES[err.code] || err.message;
  }
  return err?.message || 'An unexpected error occurred.';
}

/** Show an inline error banner below the tab bar. Clears after 8 s. */
function showError(msg) {
  let banner = document.getElementById('errorBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'errorBanner';
    banner.setAttribute('role', 'alert');
    banner.style.cssText = [
      'padding:0.6rem 1rem', 'margin:0.5rem 0',
      'background:#f8d7da', 'color:#58151c',
      'border:1px solid #f1aeb5', 'border-radius:4px',
      'font-size:0.9rem',
    ].join(';');
    const content = document.getElementById('content');
    content.parentNode.insertBefore(banner, content);
  }
  banner.textContent = `⚠ ${msg}`;
  banner.style.display = 'block';
  clearTimeout(banner._timer);
  banner._timer = setTimeout(() => { banner.style.display = 'none'; }, 8000);
}

// ── Formatting ────────────────────────────────────────────────────────────────
function formatAmount(amount, token) {
  // Use 7 decimals for XLM / native; 6 for USDC; 7 as default
  const isUsdc = typeof token === 'string' && token.length > 10;
  const decimals = isUsdc ? 6 : 7;
  const symbol   = isUsdc ? 'USDC' : 'XLM';
  const value    = Number(amount) / Math.pow(10, decimals);
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  }) + ` ${symbol}`;
}

function formatDate(ts) {
  return new Date(Number(ts) * 1000).toLocaleString();
}

function shorten(addr) {
  return addr ? addr.slice(0, 6) + '…' + addr.slice(-4) : '—';
}

// ── Render ────────────────────────────────────────────────────────────────────
function setStatus(status) {
  state.status = status;
  document.querySelectorAll('.tabs .tab').forEach(btn => {
    btn.setAttribute('aria-selected', btn.dataset.status === status);
  });
  render();
}

function render() {
  // Normalise to lowercase for comparison because demo data uses RefundStatus
  // enum strings (capitalised) and the contract returns the same strings.
  const rows = state.refunds.filter(
    r => (r.status || '').toLowerCase() === (state.status || '').toLowerCase()
  );
  tableBody.innerHTML = '';

  if (!rows.length) {
    emptyEl.style.display = 'block';
    tableEl.style.display = 'none';
    return;
  }
  emptyEl.style.display = 'none';
  tableEl.style.display = 'table';

  rows.forEach(r => {
    const tr = document.createElement('tr');
    const dateStr = r.createdAt ? formatDate(r.createdAt) : '—';
    const amtStr  = formatAmount(r.amount, r.token || 'native');
    tr.innerHTML = `
      <td>${r.refundId}</td>
      <td title="${r.initiator || ''}">${shorten(r.initiator)}</td>
      <td>${amtStr}</td>
      <td>${r.status}</td>
      <td>${dateStr}</td>
      <td></td>
    `;
    const actions = tr.querySelector('td:last-child');
    const st = (r.status || '').toLowerCase();
    if (st === 'pending') {
      const approve = document.createElement('button');
      approve.textContent = 'Approve';
      approve.addEventListener('click', () => confirmAction('approve', r.refundId));
      const reject = document.createElement('button');
      reject.textContent = 'Reject';
      reject.addEventListener('click', () => confirmAction('reject', r.refundId));
      actions.appendChild(approve);
      actions.appendChild(reject);
    } else if (st === 'approved') {
      const execute = document.createElement('button');
      execute.textContent = 'Execute';
      execute.addEventListener('click', () => confirmAction('execute', r.refundId));
      actions.appendChild(execute);
    }
    tableBody.appendChild(tr);
  });
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
let lastFocused = null;
let trapListener = null;

function openModal(modal) {
  modal.style.display = 'block';
  modal.setAttribute('aria-hidden', 'false');
  trapFocus(modal);
}

function closeModal(modal) {
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
  releaseFocusTrap();
}

function trapFocus(modal) {
  lastFocused = document.activeElement;
  const focusable = modal.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const first = focusable[0];
  const last  = focusable[focusable.length - 1];
  if (first) first.focus();
  trapListener = e => {
    if (e.key === 'Tab') {
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    } else if (e.key === 'Escape') {
      closeModal(modal);
    }
  };
  document.addEventListener('keydown', trapListener);
}

function releaseFocusTrap() {
  document.removeEventListener('keydown', trapListener);
  trapListener = null;
  if (lastFocused) lastFocused.focus();
}

function confirmAction(action, refundId) {
  const modal  = document.getElementById('confirmModal');
  const textEl = document.getElementById('confirmText');
  textEl.textContent = `Confirm ${action} for refund ${refundId}?`;
  openModal(modal);
  document.getElementById('confirmYes').onclick = async () => {
    closeModal(modal);
    await dispatchAction(action, refundId);
  };
  document.getElementById('confirmNo').onclick = () => closeModal(modal);
}

// ── SDK action dispatch ───────────────────────────────────────────────────────
/**
 * Route approve / reject / execute to the real SDK or the demo in-memory stub.
 */
async function dispatchAction(action, refundId) {
  if (DEMO_MODE || !state.client) {
    // Demo mode: mutate local state only
    const r = state.refunds.find(x => x.refundId === refundId);
    if (r) {
      if (action === 'approve')  r.status = RefundStatus.Approved;
      if (action === 'reject')   r.status = RefundStatus.Rejected;
      if (action === 'execute')  r.status = RefundStatus.Completed;
    }
    render();
    return;
  }

  // Live mode — require a connected wallet
  if (!state.wallet) {
    showError('Please connect a wallet before performing this action.');
    return;
  }

  const caller = state.wallet.account;

  try {
    if (action === 'approve') {
      await state.client.approveRefund(caller, refundId);
    } else if (action === 'reject') {
      await state.client.rejectRefund(caller, refundId);
    } else if (action === 'execute') {
      await state.client.executeRefund(refundId);
    }
    // Refresh refund list after a successful action
    await fetchRefunds();
  } catch (err) {
    showError(friendlyError(err));
  }
}

// ── Freighter signer factory ──────────────────────────────────────────────────
/**
 * Wraps window.freighter.signTransaction into the SDK Signer shape:
 *   (tx: Transaction) => Promise<Transaction>
 *
 * Freighter's signTransaction accepts an XDR string and returns a signed XDR
 * string, so we serialise / deserialise around the call.
 */
function buildFreighterSigner() {
  return async (tx) => {
    const freighter = window.freighter;
    if (!freighter) throw new Error('Freighter extension is not installed.');
    // freighter.signTransaction expects the XDR envelope string
    const signedXdr = await freighter.signTransaction(tx.toEnvelope().toXDR('base64'), {
      network: NETWORK,
      networkPassphrase: NETWORK_PASSPHRASE,
    });
    // Re-hydrate the signed transaction from XDR
    // Using stellar-sdk TransactionBuilder.fromXDR via dynamic import
    const { TransactionBuilder } = await import('https://cdn.jsdelivr.net/npm/@stellar/stellar-sdk@12/dist/stellar-sdk.min.js');
    return TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  };
}

// ── Data fetching ─────────────────────────────────────────────────────────────
/**
 * Fetch pending refunds for the connected merchant.
 *
 * Strategy:
 *  1. Demo mode → use local mock data.
 *  2. Live mode, wallet connected → call getMerchantPaymentHistory to get
 *     orders, then getRefundsForOrder on each to collect all refund records.
 *  3. Live mode, no wallet → show empty list.
 */
async function fetchRefunds() {
  if (DEMO_MODE || !state.client) {
    if (!state.refunds.length) {
      // Populate mock data once
      state.refunds = buildMockRefunds();
    }
    render();
    return;
  }

  if (!state.wallet) {
    render();
    return;
  }

  const merchant = state.wallet.account;

  try {
    // 1. Fetch recent orders for this merchant
    const page = await state.client.getMerchantPaymentHistory(
      merchant,
      null,   // cursor — start from beginning
      50,     // limit
      null,   // filter — all statuses
      'Date',
      'Descending'
    );

    const orders = page.payments || [];

    // 2. For each order, fetch its associated refunds
    const refundLists = await Promise.all(
      orders.map(order =>
        state.client.getRefundsForOrder(merchant, order.orderId).catch(() => [])
      )
    );

    // Flatten and deduplicate by refundId
    const seen = new Set();
    const all = [];
    for (const list of refundLists) {
      for (const r of list) {
        if (!seen.has(r.refundId)) {
          seen.add(r.refundId);
          all.push(r);
        }
      }
    }

    state.refunds = all;
    render();
  } catch (err) {
    showError(friendlyError(err));
  }
}

// ── Wallet connect handlers ───────────────────────────────────────────────────
function applyWallet(info) {
  state.wallet = info;
  localStorage.setItem('wallet', JSON.stringify(info));
  accountEl.textContent = shorten(info.account);

  // Build SDK client with the Freighter signer
  if (!DEMO_MODE) {
    const signer = info.type === 'freighter' ? buildFreighterSigner() : null;
    state.client = new LumenFlowClient({
      contractId: CONTRACT_ID,
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
      signer,
    });
  }

  // Refresh data for the newly connected wallet
  fetchRefunds();
}

document.getElementById('connectWallet').addEventListener('click', () =>
  openModal(document.getElementById('walletModal'))
);
document.getElementById('walletClose').addEventListener('click', () =>
  closeModal(document.getElementById('walletModal'))
);

document.getElementById('freighter').addEventListener('click', async () => {
  closeModal(document.getElementById('walletModal'));
  if (!window.freighter) {
    showError('Freighter extension is not installed. Visit https://www.freighter.app/');
    return;
  }
  try {
    const resp = await window.freighter.getConnectedAccount();
    applyWallet({ type: 'freighter', account: resp.publicKey });
  } catch (e) {
    showError(`Freighter connection failed: ${friendlyError(e)}`);
  }
});

document.getElementById('albedo').addEventListener('click', async () => {
  closeModal(document.getElementById('walletModal'));
  if (!window.albedo) {
    showError('Albedo is not available. Please install or enable it.');
    return;
  }
  try {
    const resp = await window.albedo.publicKey();
    applyWallet({ type: 'albedo', account: resp.publicKey || resp });
  } catch (e) {
    showError(`Albedo connection failed: ${friendlyError(e)}`);
  }
});

// ── Tabs ──────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tabs .tab').forEach(btn =>
  btn.addEventListener('click', () => setStatus(btn.dataset.status))
);

// ── CSV export ────────────────────────────────────────────────────────────────
function csvEscape(value) {
  const str = value == null ? '' : String(value);
  return '"' + str.replace(/"/g, '""') + '"';
}

function exportToCsv() {
  const rows = state.refunds.filter(
    r => (r.status || '').toLowerCase() === (state.status || '').toLowerCase()
  );
  const dates  = rows.map(r => r.createdAt ? formatDate(r.createdAt) : '').filter(Boolean).sort();
  const from   = dates.length ? dates[0].slice(0, 10)             : 'unknown';
  const to     = dates.length ? dates[dates.length - 1].slice(0, 10) : 'unknown';
  const prefix = state.wallet ? state.wallet.account.slice(0, 6) : 'noaddr';
  const filename = `lumenflow-${prefix}-${from}-${to}.csv`;

  const header = ['refund_id', 'order_id', 'initiator', 'amount', 'status', 'reason', 'created_at'];
  const lines  = [header.join(',')];
  rows.forEach(r => {
    lines.push([
      csvEscape(r.refundId),
      csvEscape(r.orderId),
      csvEscape(r.initiator),
      csvEscape(r.amount),
      csvEscape(r.status),
      csvEscape(r.reason),
      csvEscape(r.createdAt ? formatDate(r.createdAt) : ''),
    ].join(','));
  });

  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href  = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const exportBtn = document.getElementById('exportCsv');
if (exportBtn) exportBtn.addEventListener('click', exportToCsv);

// ── Dark mode ─────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('lumenflow_theme', theme);
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀️ Light' : '🌙 Dark';
}

const themeToggleBtn = document.getElementById('themeToggle');
if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });
  const initialTheme = document.documentElement.getAttribute('data-theme') || 'light';
  themeToggleBtn.textContent = initialTheme === 'dark' ? '☀️ Light' : '🌙 Dark';
}

// ── Demo / live mode banner ───────────────────────────────────────────────────
(function renderModeBanner() {
  const banner = document.createElement('div');
  banner.id = 'lf-mode-banner';
  banner.setAttribute('role', 'status');
  banner.style.cssText = [
    'position:sticky', 'top:0', 'z-index:1000',
    'padding:0.4rem 1rem', 'font-size:0.8rem', 'font-weight:600', 'text-align:center',
    DEMO_MODE
      ? 'background:#fff3cd;color:#856404;'
      : 'background:#d1f3e0;color:#1a5e37;',
  ].join(';');
  banner.textContent = DEMO_MODE
    ? '⚠ Demo mode – displaying mock data. Set LUMENFLOW_CONTRACT_ID to connect to a live contract.'
    : `✔ Live mode – connected to contract ${CONTRACT_ID.slice(0, 8)}… on ${NETWORK}.`;
  document.body.prepend(banner);
})();

// ── Initialise ────────────────────────────────────────────────────────────────

// Restore wallet from localStorage (e.g. page refresh)
const savedWallet = localStorage.getItem('wallet');
if (savedWallet) {
  try {
    const info = JSON.parse(savedWallet);
    state.wallet = info;
    accountEl.textContent = shorten(info.account);
    if (!DEMO_MODE && info.type === 'freighter') {
      state.client = new LumenFlowClient({
        contractId: CONTRACT_ID,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: buildFreighterSigner(),
      });
    }
  } catch (e) { /* ignore corrupt storage */ }
}

// Initial fetch + poll every 30 s
fetchRefunds();
setInterval(fetchRefunds, 30_000);
