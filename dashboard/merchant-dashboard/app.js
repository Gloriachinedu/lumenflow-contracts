/* Minimal merchant refunds UI logic
   - Tabs for statuses
   - Approve / Reject with confirm modal
   - Execute (calls wallet if connected)
   - Wallet modal with Freighter / Albedo handlers
   - Polling for updates (mocked fetch)
   - Dark mode toggle synced with localStorage key 'lumenflow_theme'
*/

const state = {
  status: 'pending',
  refunds: [],
  wallet: null,
};

const accountEl = document.getElementById('account');
const tableBody = document.querySelector('#refundsTable tbody');
const emptyEl = document.getElementById('empty');

function setStatus(status) {
  state.status = status;
  document.querySelectorAll('.tabs .tab').forEach(btn => {
    const s = btn.dataset.status;
    btn.setAttribute('aria-selected', s === status);
  });
  render();
}

function render() {
  const rows = state.refunds.filter(r => r.status === state.status);
  tableBody.innerHTML = '';
  if (!rows.length) {
    emptyEl.style.display = 'block';
    document.getElementById('refundsTable').style.display = 'none';
    return;
  }
  emptyEl.style.display = 'none';
  document.getElementById('refundsTable').style.display = 'table';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.id}</td>
      <td>${r.customer}</td>
      <td>${r.amount}</td>
      <td>${r.status}</td>
      <td></td>
    `;
    const actions = tr.querySelector('td:last-child');
    if (r.status === 'pending') {
      const approve = document.createElement('button'); approve.textContent = 'Approve';
      const reject = document.createElement('button'); reject.textContent = 'Reject';
      approve.addEventListener('click', () => confirmAction('approve', r.id));
      reject.addEventListener('click', () => confirmAction('reject', r.id));
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
  const text = document.getElementById('confirmText');
  text.textContent = `Confirm ${action} for refund ${id}?`;
  openModal(modal);
  document.getElementById('confirmYes').onclick = async () => {
    closeModal(modal);
    if (action === 'approve') updateStatus(id, 'approved');
    if (action === 'reject') updateStatus(id, 'rejected');
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
  // Attempt to sign using wallet adapters (Freighter/Albedo)
  try {
    if (state.wallet.type === 'freighter' && window.freighter) {
      await window.freighter.signTransaction({memo: `refund:${id}`});
    } else if (state.wallet.type === 'albedo') {
      await window.albedo.sign({memo: `refund:${id}`});
    } else {
      console.warn('No wallet adapter present, simulate execute');
    }
    updateStatus(id, 'completed');
  } catch (e) {
    console.error(e);
    alert('Failed to execute refund');
  }
}

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

// Simple focus trap implementation
let lastFocused = null;
let trapListener = null;
function trapFocus(modal) {
  lastFocused = document.activeElement;
  const focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
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
  lastFocused && lastFocused.focus();
}

// Wallet connect handlers
document.getElementById('connectWallet').addEventListener('click', () => openModal(document.getElementById('walletModal')));
document.getElementById('walletClose').addEventListener('click', () => closeModal(document.getElementById('walletModal')));
document.getElementById('freighter').addEventListener('click', async () => {
  closeModal(document.getElementById('walletModal'));
  // Attempt Freighter connection
  if (window.freighter) {
    try {
      const resp = await window.freighter.getConnectedAccount();
      state.wallet = {type: 'freighter', account: resp.publicKey};
      localStorage.setItem('wallet', JSON.stringify(state.wallet));
      accountEl.textContent = shorten(resp.publicKey);
    } catch (e) { alert('Freighter not available'); }
  } else { alert('Freighter not installed'); }
});
document.getElementById('albedo').addEventListener('click', async () => {
  closeModal(document.getElementById('walletModal'));
  if (window.albedo) {
    try {
      const resp = await window.albedo.publicKey();
      state.wallet = {type: 'albedo', account: resp};
      localStorage.setItem('wallet', JSON.stringify(state.wallet));
      accountEl.textContent = shorten(resp);
    } catch (e) { alert('Albedo connect failed'); }
  } else { alert('Albedo not available'); }
});

function shorten(a) { return a ? a.slice(0,6)+'…'+a.slice(-4) : '—'; }

// Tabs
document.querySelectorAll('.tabs .tab').forEach(btn => btn.addEventListener('click', () => setStatus(btn.dataset.status)));

// Export CSV
document.getElementById('exportCsv').addEventListener('click', exportToCsv);

// Mock fetch — in real app call backend API or use streaming (EventSource)
async function fetchRefunds() {
  // placeholder: generate some items
  const now = Date.now();
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

/**
 * Escape a field value for CSV output.
 * Wraps the value in double-quotes and escapes any existing double-quotes
 * by doubling them, per RFC 4180.
 */
function csvEscape(value) {
  const str = value == null ? '' : String(value);
  // Always quote the field so commas and newlines in memos are safe
  return '"' + str.replace(/"/g, '""') + '"';
}

/**
 * Export the currently filtered refund list to a CSV file and trigger a download.
 * Filename: lumenflow-{addrPrefix}-{from}-{to}.csv
 */
function exportToCsv() {
  const rows = state.refunds.filter(r => r.status === state.status);

  // Determine date range from the filtered rows
  const dates = rows.map(r => r.date).filter(Boolean).sort();
  const from = dates.length ? dates[0].slice(0, 10) : 'unknown';
  const to   = dates.length ? dates[dates.length - 1].slice(0, 10) : 'unknown';

  const addrPrefix = state.wallet ? state.wallet.account.slice(0, 6) : 'noaddr';
  const filename = `lumenflow-${addrPrefix}-${from}-${to}.csv`;

  const header = ['order_id', 'date', 'amount', 'token', 'status', 'refunded_amount', 'platform_fee', 'memo'];
  const lines = [header.join(',')];

  rows.forEach(r => {
    const line = [
      csvEscape(r.order_id),
      csvEscape(r.date),
      csvEscape(r.amount),
      csvEscape(r.token),
      csvEscape(r.status),
      csvEscape(r.refunded_amount),
      csvEscape(r.platform_fee),
      csvEscape(r.memo),
    ].join(',');
    lines.push(line);
  });

  const csvContent = lines.join('\r\n');
  const blob = new Blob([csvContent], {type: 'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Poll every 10s
fetchRefunds();
setInterval(fetchRefunds, 10000);

// Restore wallet state
const saved = localStorage.getItem('wallet');
if (saved) {
  try { state.wallet = JSON.parse(saved); accountEl.textContent = shorten(state.wallet.account); } catch(e){}
}

// ── Dark mode ─────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  // Use the same key as the main frontend so preferences are shared
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

  // Sync button label with initial theme set by the inline script
  const initialTheme = document.documentElement.getAttribute('data-theme') || 'light';
  themeToggleBtn.textContent = initialTheme === 'dark' ? '☀️ Light' : '🌙 Dark';
}
