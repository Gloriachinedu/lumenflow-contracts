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
//
// Privacy note (resolves #354):
//   The receipt page is publicly shareable, so we use `get_payment_summary`
//   (the minimal, non-authenticated public endpoint) instead of
//   `get_payment_by_id`.  This ensures that sensitive fields such as the
//   payer address, memo, and tags are never loaded into the browser at all —
//   not merely omitted at render time.
//
//   Fields fetched and rendered:  order_id, merchant_address (name only),
//                                 amount, token, status, paid_at.
//   Fields intentionally excluded: payer address, memo, tags, signatures.

const CONTRACT_ID = window.LUMENFLOW_CONTRACT_ID || '';
const RPC_URL     = window.LUMENFLOW_RPC_URL     || 'https://soroban-testnet.stellar.org';

/**
 * Extract only the fields the receipt page is allowed to display.
 * Acts as a data-minimisation guard: even if the contract response
 * shape changes, no unexpected sensitive field leaks through.
 *
 * @param {object} raw - raw payment object from the contract or demo data
 * @returns {{ order_id, merchant_address, amount, token, status, paid_at }}
 */
function toPublicPaymentSummary(raw) {
  return {
    order_id:         raw.order_id,
    merchant_address: raw.merchant_address,
    amount:           raw.amount,
    token:            raw.token,
    status:           raw.status,
    paid_at:          raw.paid_at,
    // payer, memo, tags, signature — intentionally omitted
  };
}

async function fetchPayment(orderId) {
  if (!CONTRACT_ID) return getDemoData(orderId);

  const { SorobanRpc, Contract, nativeToScVal, scValToNative } =
    await import('https://cdn.jsdelivr.net/npm/@stellar/stellar-sdk@12/+esm');

  const server   = new SorobanRpc.Server(RPC_URL);
  const contract = new Contract(CONTRACT_ID);

  const idArg = nativeToScVal(orderId, { type: 'string' });

  try {
    // Use get_payment_summary — the public endpoint that returns only
    // non-sensitive metadata.  No caller address required.
    const result = await server.simulateTransaction(
      contract.call('get_payment_summary', idArg)
    );
    if (SorobanRpc.Api.isSimulationError(result)) return null;

    const rawPayment = scValToNative(result.result.retval);
    // Apply allow-list to strip any unexpected fields
    const payment = toPublicPaymentSummary(rawPayment);

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
    // Demo data matches the shape of get_payment_summary (public fields only).
    // Sensitive fields (payer address, memo, tags) are intentionally absent.
    payment: {
      order_id:         orderId,
      merchant_address: 'GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON',
      token:            'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      amount:           50000000n,
      status:           'Completed',
      paid_at:          BigInt(Math.floor(Date.now() / 1000) - 3600),
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
