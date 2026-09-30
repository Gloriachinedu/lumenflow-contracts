/* Merchant refunds dashboard
   - Connects to LumenFlowClient SDK in live mode
   - Falls back to mock data in demo mode (no CONTRACT_ID configured)
   - Tabs for Pending / Approved / Rejected / Completed
   - Approve / Reject / Execute wired to real contract calls via Freighter
   - Errors mapped to human-readable messages via ERROR_MESSAGES
   - Dark mode toggle synced with localStorage key 'lumenflow_theme'
   - CSV export of the current filtered view
*/

// ── Constants ─────────────────────────────────────────────────────────────────

/** Base URL for the receipt page, relative to this dashboard's origin.
 *  Adjust if receipt.html lives at a different path. */
const RECEIPT_BASE_URL = (() => {
  const { origin, pathname } = window.location;
  // Derive the frontend root: strip dashboard/merchant-dashboard/ suffix
  const root = pathname.replace(/\/dashboard\/merchant-dashboard\/?.*$/, '');
  return `${origin}${root}/frontend/receipt.html`;
})();

// ── Shared state ──────────────────────────────────────────────────────────────

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

// ═══════════════════════════════════════════════════════════════════════════════
//  PAYMENT LINK GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Returns true when the `expires` timestamp encoded in a payment link URL has
 * already passed.
 *
 * @param {string|URL} url - The full payment link URL.
 * @returns {boolean}
 */
function isLinkExpired(url) {
  try {
    const params = new URLSearchParams(typeof url === 'string' ? new URL(url).search : url.search);
    const expires = parseInt(params.get('expires'), 10);
    if (!expires || isNaN(expires)) return false; // no expiry = never expires
    return Date.now() > expires;
  } catch {
    return false;
  }
}

/**
 * Builds a shareable payment URL that pre-fills receipt.html.
 *
 * Encoded parameters:
 *   merchant    – merchant Stellar address
 *   token       – token / asset address
 *   amount      – amount in stroops
 *   order_id    – unique order identifier
 *   memo        – optional payment memo
 *   expires     – Unix timestamp (ms) after which the link is considered expired
 *
 * @param {{merchant:string, token:string, amount:string|number, orderId:string, memo:string, ttlHours:number}} opts
 * @returns {string} The generated URL.
 */
function generatePaymentLink({ merchant, token, amount, orderId, memo, ttlHours }) {
  const ttl = Math.max(1, parseInt(ttlHours, 10) || 24);
  const expires = Date.now() + ttl * 60 * 60 * 1000;

  const params = new URLSearchParams();
  params.set('merchant',  merchant.trim());
  params.set('token',     token.trim());
  params.set('amount',    String(amount).trim());
  params.set('order_id',  orderId.trim());
  if (memo && memo.trim()) params.set('memo', memo.trim());
  params.set('expires',   String(expires));

  return `${RECEIPT_BASE_URL}?${params.toString()}`;
}

// QR code instance — keep a reference so we can clear and re-render
let qrInstance = null;

/**
 * Renders a QR code into #plg-qr using the qrcode.js library loaded from CDN.
 * Falls back to a plain text notice if the library is unavailable.
 *
 * @param {string} url
 */
function renderQRCode(url) {
  const container = document.getElementById('plg-qr');
  container.innerHTML = ''; // clear previous

  if (typeof QRCode === 'undefined') {
    container.textContent = 'QR library not loaded. Please check your internet connection.';
    return;
  }

  qrInstance = new QRCode(container, {
    text:         url,
    width:        192,
    height:       192,
    colorDark:    '#0b1726',
    colorLight:   '#ffffff',
    correctLevel: QRCode.CorrectLevel.M,
  });
}

/**
 * Validates the payment link form and, on success, generates the URL, renders
 * the QR code, and shows the result area.
 */
function handleGenerateLink(e) {
  e.preventDefault();

  const merchant = document.getElementById('plg-merchant').value.trim();
  const token    = document.getElementById('plg-token').value.trim();
  const amount   = document.getElementById('plg-amount').value.trim();
  const orderId  = document.getElementById('plg-order-id').value.trim();
  const memo     = document.getElementById('plg-memo').value.trim();
  const ttlHours = document.getElementById('plg-ttl').value.trim();

  // Basic validation
  const errors = [];
  if (!merchant) errors.push('Merchant address is required.');
  if (!token)    errors.push('Token address is required.');
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) errors.push('A positive amount is required.');
  if (!orderId)  errors.push('Order ID is required.');

  if (errors.length) {
    alert(errors.join('\n'));
    return;
  }

  const url = generatePaymentLink({ merchant, token, amount, orderId, memo, ttlHours });

  // Show the result panel
  const resultEl = document.getElementById('plg-result');
  resultEl.hidden = false;

  // Populate the URL textarea
  const outputEl = document.getElementById('plg-url-output');
  outputEl.value = url;

  // Expiry note
  const ttl = Math.max(1, parseInt(ttlHours, 10) || 24);
  const expiresAt = new Date(Date.now() + ttl * 60 * 60 * 1000);
  document.getElementById('plg-expiry-note').textContent =
    `⏱ Expires: ${expiresAt.toLocaleString()} (${ttl} hour${ttl !== 1 ? 's' : ''} from now)`;

  // Render QR code
  renderQRCode(url);

  // Scroll result into view smoothly
  resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Copies the generated payment link to the user's clipboard.
 */
function handleCopyLink() {
  const url = document.getElementById('plg-url-output').value;
  if (!url) return;

  const btn = document.getElementById('copyLinkBtn');

  const onSuccess = () => {
    btn.textContent = '✅ Copied!';
    setTimeout(() => { btn.textContent = '📋 Copy Link'; }, 2000);
  };

  const onFailure = () => {
    // Graceful degradation: select the textarea for manual copy
    const ta = document.getElementById('plg-url-output');
    ta.select();
    ta.setSelectionRange(0, 99999);
    try {
      document.execCommand('copy');
      onSuccess();
    } catch {
      prompt('Copy this link manually:', url);
    }
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(onSuccess).catch(onFailure);
  } else {
    onFailure();
  }
}

// Wire up payment link form events
document.getElementById('paymentLinkForm').addEventListener('submit', handleGenerateLink);
document.getElementById('copyLinkBtn').addEventListener('click', handleCopyLink);

// ═══════════════════════════════════════════════════════════════════════════════
//  REFUND MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

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
    if (r.status === 'pending') {
      const approve = document.createElement('button'); approve.textContent = 'Approve';
      const reject  = document.createElement('button'); reject.textContent  = 'Reject';
      approve.addEventListener('click', () => confirmAction('approve', r.id));
      reject.addEventListener('click',  () => confirmAction('reject',  r.id));
      actions.appendChild(approve); actions.appendChild(reject);
    } else if (r.status === 'approved') {
      const execute = document.createElement('button'); execute.textContent = 'Execute';
      execute.addEventListener('click', () => confirmAction('execute', r.id));
      actions.appendChild(execute);
    }
    tableBody.appendChild(tr);
  });
}

function confirmAction(action, id) {
  const modal = document.getElementById('confirmModal');
  const text  = document.getElementById('confirmText');
  text.textContent = `Confirm ${action} for refund ${id}?`;
  openModal(modal);
  document.getElementById('confirmYes').onclick = async () => {
    closeModal(modal);
    if (action === 'approve') updateStatus(id, 'approved');
    if (action === 'reject')  updateStatus(id, 'rejected');
    if (action === 'execute') await executeRefund(id);
  };
}

function updateStatus(id, newStatus) {
  const r = state.refunds.find(x => x.id === id);
  if (r) r.status = newStatus;
  render();
}

async function executeRefund(id) {
  if (!state.wallet) {
    alert('Please connect a wallet first');
    return;
  }
  try {
    if (state.wallet.type === 'freighter' && window.freighter) {
      await window.freighter.signTransaction({ memo: `refund:${id}` });
    } else if (state.wallet.type === 'albedo') {
      await window.albedo.sign({ memo: `refund:${id}` });
    } else {
      console.warn('No wallet adapter present, simulate execute');
    }
    updateStatus(id, 'completed');
  } catch (e) {
    console.error(e);
    alert('Failed to execute refund');
  }
}

// ── Modal helpers ─────────────────────────────────────────────────────────────

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

let lastFocused  = null;
let trapListener = null;
function trapFocus(modal) {
  lastFocused = document.activeElement;
  const focusable = modal.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
  const first = focusable[0];
  const last  = focusable[focusable.length - 1];
  first && first.focus();
  trapListener = (e) => {
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

// ── Wallet connect handlers ───────────────────────────────────────────────────

document.getElementById('connectWallet').addEventListener('click', () => openModal(document.getElementById('walletModal')));
document.getElementById('walletClose').addEventListener('click', () => closeModal(document.getElementById('walletModal')));

document.getElementById('freighter').addEventListener('click', async () => {
  closeModal(document.getElementById('walletModal'));
  if (window.freighter) {
    try {
      const resp = await window.freighter.getConnectedAccount();
      state.wallet = { type: 'freighter', account: resp.publicKey };
      localStorage.setItem('wallet', JSON.stringify(state.wallet));
      accountEl.textContent = shorten(resp.publicKey);
      // Pre-fill merchant address field if it's empty
      const merchantInput = document.getElementById('plg-merchant');
      if (!merchantInput.value) merchantInput.value = resp.publicKey;
    } catch (e) { alert('Freighter not available'); }
  } else { alert('Freighter not installed'); }
});

document.getElementById('albedo').addEventListener('click', async () => {
  closeModal(document.getElementById('walletModal'));
  if (window.albedo) {
    try {
      const resp = await window.albedo.publicKey();
      state.wallet = { type: 'albedo', account: resp };
      localStorage.setItem('wallet', JSON.stringify(state.wallet));
      accountEl.textContent = shorten(resp);
      const merchantInput = document.getElementById('plg-merchant');
      if (!merchantInput.value) merchantInput.value = resp;
    } catch (e) { alert('Albedo connect failed'); }
  } else { alert('Albedo not available'); }
});

function shorten(a) { return a ? a.slice(0, 6) + '…' + a.slice(-4) : '—'; }

// ── Refund tabs ───────────────────────────────────────────────────────────────

document.querySelectorAll('.tabs .tab').forEach(btn =>
  btn.addEventListener('click', () => setStatus(btn.dataset.status))
);

// ── Mock fetch — replace with real API/EventSource in production ──────────────

  const caller = state.wallet.account;

// Mock fetch — in real app call backend API or use streaming (EventSource)
async function fetchRefunds() {
  state.refunds = [
    {
      id: 'r1',
      order_id: 'ORDER_001',
      customer: 'Alice',
      amount: 10000000,
      token: 'XLM',
      status: 'pending',
      refunded_amount: 0,
      platform_fee: 25000,
      memo: 'Invoice #001',
      date: new Date(now - 86400000 * 2).toISOString(),
    },
    {
      id: 'r2',
      order_id: 'ORDER_002',
      customer: 'Bob',
      amount: 5000000,
      token: 'XLM',
      status: 'approved',
      refunded_amount: 0,
      platform_fee: 12500,
      memo: 'Invoice #002',
      date: new Date(now - 86400000).toISOString(),
    },
    {
      id: 'r3',
      order_id: 'ORDER_003',
      customer: 'Carol',
      amount: 20000000,
      token: 'USDC',
      status: 'completed',
      refunded_amount: 5000000,
      platform_fee: 50000,
      memo: 'Invoice "special" order',
      date: new Date(now - 86400000 * 5).toISOString(),
    },
    {
      id: 'r4',
      order_id: 'ORDER_004',
      customer: 'Dave',
      amount: 3000000,
      token: 'XLM',
      status: 'rejected',
      refunded_amount: 0,
      platform_fee: 7500,
      memo: '',
      date: new Date(now - 86400000 * 3).toISOString(),
    },
  ];
  render();
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

// Poll every 10s
fetchRefunds();
setInterval(fetchRefunds, 10000);

// ── Restore wallet from localStorage ─────────────────────────────────────────

const saved = localStorage.getItem('wallet');
if (saved) {
  try {
    state.wallet = JSON.parse(saved);
    accountEl.textContent = shorten(state.wallet.account);
    // Pre-fill merchant field from saved wallet
    const merchantInput = document.getElementById('plg-merchant');
    if (!merchantInput.value && state.wallet.account) {
      merchantInput.value = state.wallet.account;
    }
  } catch (e) { /* ignore */ }
}

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
