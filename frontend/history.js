import { validateAddress, validateAmount } from './validation.js';
import {
  DEMO_MODE, CONTRACT_ID, NETWORK,
  renderModeBanner, copyButtonHtml, initCopyButtons,
  formatTokenAmount, convertToXlm, getTokenMetadata,
} from './lumenflow-shared.js';

// ── State Management ────────────────────────────────────────────────────────

const filters = {
  merchant_address: '',
  date_start: '',
  date_end: '',
  amount_min: '',
  amount_max: '',
  token: '',
  status: 'Any'
};

// ── Initialize from URL ─────────────────────────────────────────────────────

// Dates must be YYYY-MM-DD and parseable; buildFilterArg converts them to
// BigInt, which throws on anything else.
function isValidDateParam(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

function initFromUrl() {
  const params = new URLSearchParams(window.location.search);
  inputBindings.forEach(({ id, key }) => {
    if (!params.has(key)) return;
    const value = params.get(key);
    const validator = filterValidators[id];
    if (validator) {
      const message = validator(value);
      showFilterError(id, message);
      if (message) return; // invalid URL params are dropped, never sent to the contract
    } else if ((key === 'date_start' || key === 'date_end') && value && !isValidDateParam(value)) {
      return;
    }
    filters[key] = value;
    document.getElementById(id).value = value;
  });
  renderActiveFilters();
  updateResults();
}

function updateUrl() {
  const params = new URLSearchParams();
  for (const key in filters) {
    if (filters[key] && filters[key] !== 'Any') params.set(key, filters[key]);
  }
  const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
  window.history.pushState({}, '', newUrl);
}

// ── Render Helpers ──────────────────────────────────────────────────────────

function renderActiveFilters() {
  const container = document.getElementById('active-filters');
  container.innerHTML = '';
  const labels = { merchant_address: 'Merchant: ', date_start: 'From ', date_end: 'To ', amount_min: 'Min ', amount_max: 'Max ', token: 'Token: ', status: 'Status: ' };
  for (const key in filters) {
    const val = filters[key];
    if (val && val !== 'Any') {
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.innerHTML = `<span>${labels[key]}${val}</span><button onclick="removeFilter('${key}')" aria-label="Remove filter ${labels[key]}${val}">&times;</button>`;
      container.appendChild(chip);
    }
  }
}

function removeFilter(key) {
  filters[key] = key === 'status' ? 'Any' : '';
  const idMap = { merchant_address: 'merchant-address', date_start: 'date-start', date_end: 'date-end', amount_min: 'amount-min', amount_max: 'amount-max', token: 'token-selector', status: 'status-selector' };
  const el = document.getElementById(idMap[key]);
  if (el) el.value = filters[key];
  updateUrl();
  renderActiveFilters();
  updateResults();
}

// ── Status badge ────────────────────────────────────────────────────────────
const STATUS_MAP = {
  Completed:         { label: '✔ Completed',          cls: 'status-completed'         },
  PartiallyRefunded: { label: '↩ Partially Refunded', cls: 'status-partiallyrefunded' },
  FullyRefunded:     { label: '↩ Fully Refunded',     cls: 'status-fullyrefunded'     },
};
function statusBadgeHtml(status) {
  const entry = STATUS_MAP[status] || { label: status || 'Unknown', cls: 'status-unknown' };
  return `<span class="status-badge ${entry.cls}">${entry.label}</span>`;
}

function formatAmount(amount) {
  return (Number(amount) / 1e7).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 7 }) + ' XLM';
}
function formatDate(ts) { return new Date(Number(ts) * 1000).toLocaleString(); }

// ── Mock data (demo mode) ───────────────────────────────────────────────────
const MOCK_DATA = [
  { paid_at: BigInt(Math.floor(Date.now()/1000) - 86400),  order_id: 'ORD-9921', merchant_address: 'GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON', amount: BigInt(1245000000), status: 'Completed',         merchant_verified: true  },
  { paid_at: BigInt(Math.floor(Date.now()/1000) - 172800), order_id: 'ORD-8832', merchant_address: 'GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON', amount: BigInt(120000000),  status: 'Completed',         merchant_verified: true  },
  { paid_at: BigInt(Math.floor(Date.now()/1000) - 259200), order_id: 'ORD-7712', merchant_address: 'GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON', amount: BigInt(159900000),  status: 'PartiallyRefunded', merchant_verified: false },
  { paid_at: BigInt(Math.floor(Date.now()/1000) - 604800), order_id: 'ORD-6601', merchant_address: 'GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON', amount: BigInt(99900000),   status: 'FullyRefunded',     merchant_verified: false },
];

// ── Soroban fetch ───────────────────────────────────────────────────────────
async function fetchFromContract(merchantAddress) {
  const { SorobanRpc, Contract, nativeToScVal, scValToNative } =
    await import('https://cdn.jsdelivr.net/npm/@stellar/stellar-sdk@12/+esm');
  const server   = new SorobanRpc.Server(RPC_URL);
  const contract = new Contract(CONTRACT_ID);

  const filterArg = buildFilterArg(nativeToScVal);

  const result = await server.simulateTransaction(
    contract.call(
      'get_merchant_payment_history',
      nativeToScVal(merchantAddress, { type: 'address' }),
      nativeToScVal(null),           // cursor
      nativeToScVal(50, { type: 'u32' }), // limit
      filterArg,
      nativeToScVal('Date',       { type: 'symbol' }),
      nativeToScVal('Descending', { type: 'symbol' }),
    )
  );
  if (SorobanRpc.Api.isSimulationError(result)) {
    throw new Error(result.error || 'Contract call failed');
  }
  const page = scValToNative(result.result.retval);
  const payments = page.payments || [];

  // Enrich each payment with merchant verified status
  const uniqueAddresses = [...new Set(payments.map(p => p.merchant_address))];
  const verifiedMap = await fetchMerchantVerified(uniqueAddresses, { server, contract, nativeToScVal, scValToNative });
  return payments.map(p => ({
    ...p,
    merchant_verified: verifiedMap[p.merchant_address] ?? false,
  }));
}

// ── Batch-fetch merchant verified status ────────────────────────────────────
async function fetchMerchantVerified(addresses, { server, contract, nativeToScVal, scValToNative }) {
  const verifiedMap = {};
  await Promise.all(addresses.map(async (addr) => {
    try {
      const res = await server.simulateTransaction(
        contract.call('get_merchant', nativeToScVal(addr, { type: 'address' }))
      );
      if (!res.error && res.result) {
        const merchant = scValToNative(res.result.retval);
        verifiedMap[addr] = merchant.verified === true;
      } else {
        verifiedMap[addr] = false;
      }
    } catch {
      verifiedMap[addr] = false;
    }
  }));
  return verifiedMap;
}

function buildFilterArg(nativeToScVal) {
  const hasFilter = filters.date_start || filters.date_end || filters.amount_min || filters.amount_max || filters.token || filters.status !== 'Any';
  if (!hasFilter) return nativeToScVal(null);
  return nativeToScVal({
    date_start:  filters.date_start  ? BigInt(new Date(filters.date_start).getTime() / 1000)  : null,
    date_end:    filters.date_end    ? BigInt(new Date(filters.date_end).getTime()   / 1000)  : null,
    amount_min:  filters.amount_min  ? BigInt(Math.round(Number(filters.amount_min) * 1e7))  : null,
    amount_max:  filters.amount_max  ? BigInt(Math.round(Number(filters.amount_max) * 1e7))  : null,
    token:       filters.token       || null,
    status:      filters.status !== 'Any' ? filters.status : null,
  });
}

// ── Skeleton rows ────────────────────────────────────────────────────────────
const SKELETON_ROW_COUNT = 5;
const SKELETON_WIDTHS = [
  ['w-date', 'w-id', 'w-addr', 'w-amount', 'w-status'],
  ['w-date', 'w-id', 'w-addr', 'w-amount', 'w-status'],
  ['w-date', 'w-id', 'w-addr', 'w-amount', 'w-status'],
  ['w-date', 'w-id', 'w-addr', 'w-amount', 'w-status'],
  ['w-date', 'w-id', 'w-addr', 'w-amount', 'w-status'],
];

function renderSkeletonRows() {
  const body = document.getElementById('history-body');
  body.innerHTML = '';
  body.className = 'skeleton-body';
  for (let i = 0; i < SKELETON_ROW_COUNT; i++) {
    const tr = document.createElement('tr');
    // aria-busy and aria-hidden keep skeleton rows out of AT reading order
    tr.setAttribute('aria-busy', 'true');
    tr.setAttribute('aria-hidden', 'true');
    SKELETON_WIDTHS[i].forEach(cls => {
      const td = document.createElement('td');
      td.innerHTML = `<span class="skeleton-cell ${cls}"></span>`;
      tr.appendChild(td);
    });
    body.appendChild(tr);
  }
}

// ── UI state helpers ────────────────────────────────────────────────────────
function showLoading() {
  // Hide prose loading indicator — skeletons inside the table give visual feedback
  document.getElementById('loading-state').style.display = 'none';
  document.getElementById('error-state').style.display   = 'none';
  document.getElementById('history-table').style.display = '';
  document.getElementById('empty-state').style.display   = 'none';
  renderSkeletonRows();
}
function showError(msg) {
  document.getElementById('loading-state').style.display = 'none';
  document.getElementById('error-state').style.display   = 'block';
  document.getElementById('error-msg').textContent       = msg;
  document.getElementById('history-table').style.display = 'none';
  document.getElementById('empty-state').style.display   = 'none';
  // Clear skeleton rows so they are not present in the DOM while error shows
  const body = document.getElementById('history-body');
  body.innerHTML = '';
  body.className = '';
}
function showTable() {
  document.getElementById('loading-state').style.display = 'none';
  document.getElementById('error-state').style.display   = 'none';
  document.getElementById('history-table').style.display = '';
  // skeleton rows are cleared by renderRows()
}

// ── Render rows ─────────────────────────────────────────────────────────────
function renderRows(payments) {
  const body  = document.getElementById('history-body');
  const empty = document.getElementById('empty-state');
  body.innerHTML = '';
  body.className = ''; // clear skeleton-body class
  if (!payments.length) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  const currencyMode = document.getElementById('currency-display-toggle')
    ? document.getElementById('currency-display-toggle').value
    : 'native';
  payments.forEach(p => {
    const amountDisplay = currencyMode === 'xlm'
      ? convertToXlm(p.amount, p.token)
      : formatTokenAmount(p.amount, p.token);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="Date">${formatDate(p.paid_at)}</td>
      <td data-label="Order ID"><code>${p.order_id}</code>${copyButtonHtml(p.order_id, 'Copy order ID')}</td>
      <td data-label="Merchant"><code title="${p.merchant_address}">${p.merchant_address.slice(0,8)}…</code>${copyButtonHtml(p.merchant_address, 'Copy address')}</td>
      <td data-label="Amount" class="amount-cell">${amountDisplay}</td>
      <td data-label="Status">${statusBadgeHtml(p.status)}</td>`;
    body.appendChild(tr);
  });
}

// ── Main update ─────────────────────────────────────────────────────────────
async function updateResults() {
  if (DEMO_MODE) {
    showTable();
    renderRows(MOCK_DATA);
    return;
  }

  const merchant = filters.merchant_address.trim();
  if (!merchant) {
    showTable();
    renderRows([]);
    document.getElementById('empty-state').style.display = 'block';
    document.getElementById('empty-state').textContent   = 'Enter a merchant address to load payment history.';
    return;
  }

  // Guards against invalid addresses arriving via URL params as well.
  if (validateAddress(merchant, { label: 'Merchant address' })) {
    showTable();
    renderRows([]);
    document.getElementById('empty-state').style.display = 'block';
    document.getElementById('empty-state').textContent   = 'Enter a valid merchant address (starts with G, 56 characters) to load payment history.';
    return;
  }

  showLoading();
  try {
    const payments = await fetchFromContract(merchant);
    showTable();
    renderRows(payments);
  } catch (e) {
    showError(e.message || 'Failed to fetch payment history from contract.');
  }
}

function retryFetch() { updateResults(); }

// ── Event Listeners ─────────────────────────────────────────────────────────
const inputBindings = [
  { id: 'merchant-address', key: 'merchant_address' },
  { id: 'date-start',       key: 'date_start'       },
  { id: 'date-end',         key: 'date_end'         },
  { id: 'amount-min',       key: 'amount_min'       },
  { id: 'amount-max',       key: 'amount_max'       },
  { id: 'token-selector',   key: 'token'            },
  { id: 'status-selector',  key: 'status'           },
];
// Validators for free-text filter inputs; other filters need no validation.
const filterValidators = {
  'merchant-address': v => validateAddress(v, { label: 'Merchant address', required: false }),
  'amount-min':       v => validateAmount(v, { label: 'Min amount', allowZero: true, required: false }),
  'amount-max':       v => validateAmount(v, { label: 'Max amount', allowZero: true, required: false }),
};

function showFilterError(id, message) {
  const errEl = document.getElementById(`${id}-err`);
  errEl.textContent = message;
  errEl.style.display = message ? 'block' : 'none';
  document.getElementById(id).classList.toggle('input-error', !!message);
}

inputBindings.forEach(({ id, key }) => {
  document.getElementById(id).addEventListener('change', e => {
    const validator = filterValidators[id];
    if (validator) {
      const message = validator(e.target.value);
      showFilterError(id, message);
      if (message) return; // invalid values are never applied or sent to the contract
    }
    filters[key] = e.target.value;
    updateUrl();
    renderActiveFilters();
    updateResults();
  });
});

window.removeFilter = removeFilter;
window.retryFetch   = retryFetch;
window.addEventListener('popstate', initFromUrl);
renderModeBanner();
initCopyButtons(document.body);

// ── Currency display toggle ─────────────────────────────────────────────────
const currencyToggleEl = document.getElementById('currency-display-toggle');
if (currencyToggleEl) {
  currencyToggleEl.addEventListener('change', () => updateResults());
}

initFromUrl();
