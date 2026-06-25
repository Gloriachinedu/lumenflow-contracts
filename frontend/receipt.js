// ── Routing ──────────────────────────────────────────────────────────────────
// Supports both:
//   /receipt/ORDER_001          (path-based, requires server routing)
//   /receipt.html?orderId=ORDER_001  (query-param fallback)

function getOrderId() {
  const path = window.location.pathname;
  const match = path.match(/\/receipt\/([^/?#]+)/);
  if (match) return decodeURIComponent(match[1]);
  return new URLSearchParams(window.location.search).get('orderId');
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatAmount(amount, decimals = 7) {
  return (Number(amount) / Math.pow(10, decimals)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  });
}

function formatDate(timestamp) {
  return new Date(Number(timestamp) * 1000).toLocaleString();
}

function statusBadge(status) {
  const map = {
    Completed:         { label: '✔ Completed',          cls: 'badge-completed' },
    PartiallyRefunded: { label: '↩ Partially Refunded', cls: 'badge-partial'   },
    FullyRefunded:     { label: '↩ Fully Refunded',     cls: 'badge-refunded'  },
  };
  return map[status] || { label: status, cls: '' };
}

function refundStatusLabel(status) {
  const map = {
    Pending:   '⏳ Pending review',
    Approved:  '✔ Approved',
    Rejected:  '✗ Rejected',
    Completed: '✔ Refunded',
  };
  return map[status] || status;
}

// ── Data fetching ─────────────────────────────────────────────────────────────

const CONTRACT_ID = window.LUMENFLOW_CONTRACT_ID || '';
const RPC_URL     = window.LUMENFLOW_RPC_URL     || 'https://soroban-testnet.stellar.org';

async function fetchPayment(orderId) {
  if (!CONTRACT_ID) return getDemoData(orderId);

  const { SorobanRpc, Contract, nativeToScVal, scValToNative } =
    await import('https://cdn.jsdelivr.net/npm/@stellar/stellar-sdk@12/+esm');

  const server   = new SorobanRpc.Server(RPC_URL);
  const contract = new Contract(CONTRACT_ID);

  const callerArg = nativeToScVal('GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN', { type: 'address' });
  const idArg     = nativeToScVal(orderId, { type: 'string' });

  try {
    const result = await server.simulateTransaction(
      contract.call('get_payment_by_id', callerArg, idArg)
    );
    if (SorobanRpc.Api.isSimulationError(result)) return null;
    const payment = scValToNative(result.result.retval);

    const merchantArg = nativeToScVal(payment.merchant_address, { type: 'address' });
    const mResult = await server.simulateTransaction(
      contract.call('get_merchant', merchantArg)
    );
    const merchant = SorobanRpc.Api.isSimulationError(mResult)
      ? { name: payment.merchant_address, verified: false }
      : scValToNative(mResult.result.retval);

    return { payment, merchant, refunds: [] };
  } catch {
    return null;
  }
}

function getDemoData(orderId) {
  if (orderId === 'NOT_FOUND') return null;
  return {
    payment: {
      order_id:         orderId,
      merchant_address: 'GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON',
      payer:            'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
      token:            'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      amount:           50000000n,
      status:           'Completed',
      paid_at:          BigInt(Math.floor(Date.now() / 1000) - 3600),
      refunded_amount:  0n,
      memo:             'Invoice #001',
    },
    merchant: { name: 'Demo Store', verified: true },
    refunds: [
      {
        refund_id: 'REFUND_001',
        amount: 10000000n,
        reason: 'Item out of stock',
        status: 'Completed',
        created_at: BigInt(Math.floor(Date.now() / 1000) - 1800),
        executed_at: BigInt(Math.floor(Date.now() / 1000) - 900),
      },
    ],
  };
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderReceipt({ payment, merchant, refunds }) {
  document.getElementById('field-order-id').textContent      = payment.order_id;
  document.getElementById('field-merchant-name').textContent = merchant.name || payment.merchant_address;
  document.getElementById('field-amount').textContent        = formatAmount(payment.amount) + ' XLM';
  document.getElementById('field-token').textContent         = payment.token;
  document.getElementById('field-date').textContent          = formatDate(payment.paid_at);

  if (merchant.verified) {
    document.getElementById('verified-badge').style.display = 'inline-flex';
  }

  const { label, cls } = statusBadge(payment.status);
  const badge = document.getElementById('status-badge');
  badge.textContent = label;
  badge.className   = 'badge ' + cls;

  if (refunds && refunds.length > 0) {
    const list = document.getElementById('refunds-list');
    refunds.forEach(r => {
      const item = document.createElement('div');
      item.className = 'refund-item';
      item.innerHTML = `
        <div class="refund-row">
          <span><strong>${r.refund_id}</strong></span>
          <span><strong>${formatAmount(r.amount)} XLM</strong></span>
        </div>
        <div class="refund-row">
          <span>${refundStatusLabel(r.status)}</span>
        </div>
        <div class="refund-meta">
          <div><strong>Reason:</strong> ${r.reason || '—'}</div>
          ${r.executed_at ? `<div><strong>Processed:</strong> ${formatDate(r.executed_at)}</div>` : ''}
        </div>`;
      list.appendChild(item);
    });
    document.getElementById('refunds-section').style.display = 'block';
  }

  document.getElementById('receipt-content').style.display = 'block';
}

function copyLink() {
  navigator.clipboard.writeText(window.location.href)
    .then(() => alert('Link copied!'))
    .catch(() => prompt('Copy this link:', window.location.href));
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

(async () => {
  const orderId = getOrderId();
  if (!orderId) {
    document.getElementById('missing-id').textContent = '(none)';
    document.getElementById('not-found').style.display = 'block';
    return;
  }

  document.title = `Receipt ${orderId} – LumenFlow`;
  document.getElementById('loading').style.display = 'block';

  const data = await fetchPayment(orderId);

  document.getElementById('loading').style.display = 'none';

  if (!data) {
    document.getElementById('missing-id').textContent = orderId;
    document.getElementById('not-found').style.display = 'block';
  } else {
    renderReceipt(data);
  }
})();
