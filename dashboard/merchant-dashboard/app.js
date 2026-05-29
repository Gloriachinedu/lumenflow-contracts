/* Minimal merchant refunds UI logic
   - Tabs for statuses
   - Approve / Reject with confirm modal
   - Execute (calls wallet if connected)
   - Wallet modal with Freighter / Albedo handlers
   - Polling for updates (mocked fetch)
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

// Mock fetch — in real app call backend API or use streaming (EventSource)
async function fetchRefunds() {
  // placeholder: generate some items
  const now = Date.now();
  state.refunds = [
    {id: 'r1', customer: 'Alice', amount: '10 XLM', status: 'pending'},
    {id: 'r2', customer: 'Bob', amount: '5 XLM', status: 'approved'},
  ];
  render();
}

// Poll every 10s
fetchRefunds();
setInterval(fetchRefunds, 10000);

// Restore wallet state
const saved = localStorage.getItem('wallet');
if (saved) {
  try { state.wallet = JSON.parse(saved); accountEl.textContent = shorten(state.wallet.account); } catch(e){}
}
