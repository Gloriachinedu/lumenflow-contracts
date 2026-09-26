  import { CONTRACT_ID, RPC_URL, formatAmount, formatDate, renderModeBanner, formatTokenAmount, convertToXlm, getTokenMetadata, copyButtonHtml, initCopyButtons } from './lumenflow-shared.js';
  import { validateOrderId } from './validation.js';

  // ── Routing ────────────────────────────────────────────────────────────────
  // Supports both:
  //   /receipt/ORDER_001          (path-based, requires server routing)
  //   /receipt.html?orderId=ORDER_001  (query-param fallback)

  function getOrderId() {
    const path = window.location.pathname;
    const match = path.match(/\/receipt\/([^/?#]+)/);
    if (match) return decodeURIComponent(match[1]);
    const params = new URLSearchParams(window.location.search);
    // Support both `orderId` (legacy) and `order_id` (generated payment links)
    return params.get('orderId') || params.get('order_id');
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── Refund helpers ─────────────────────────────────────────────────────────
  function refundStatusIcon(status) {
    return { Pending: '⏳', Approved: '✔', Rejected: '✗', Completed: '✅' }[status] || '•';
  }

  function refundStatusLabel(status) {
    return { Pending: 'Pending Review', Approved: 'Approved', Rejected: 'Rejected', Completed: 'Refunded' }[status] || status;
  }

  function refundStatusClass(status) {
    return { Pending: 'step-status-pending', Approved: 'step-status-approved', Rejected: 'step-status-rejected', Completed: 'step-status-completed' }[status] || '';
  }

  function buildRefundTimeline(r) {
    const steps = [];

    // Step 1 — always present: submitted
    steps.push(`<div class="timeline-step step-status-approved">
      <em class="refund-status-icon">📩</em> Submitted — ${formatDate(r.created_at)}
    </div>`);

    // Step 2 — middle state
    if (r.status === 'Completed' || r.status === 'Approved') {
      steps.push(`<div class="timeline-step step-status-approved">
        <em class="refund-status-icon">✔</em> Approved
      </div>`);
    } else if (r.status === 'Rejected') {
      steps.push(`<div class="timeline-step step-status-rejected">
        <em class="refund-status-icon">✗</em> Rejected
      </div>`);
    } else {
      steps.push(`<div class="timeline-step step-status-pending">
        <em class="refund-status-icon">⏳</em> Awaiting merchant review
      </div>`);
    }

    // Step 3 — completed transfer
    if (r.status === 'Completed' && r.executed_at) {
      steps.push(`<div class="timeline-step step-status-completed">
        <em class="refund-status-icon">✅</em> Refund transferred — ${formatDate(r.executed_at)}
      </div>`);
    }

    return `<div class="refund-timeline">${steps.join('')}</div>`;
  }

  // ── Status badge (local to receipt page) ──────────────────────────────────
  function statusBadge(status) {
    const map = {
      Completed:         { label: '✔ Completed',          cls: 'badge-completed' },
      PartiallyRefunded: { label: '↩ Partially Refunded', cls: 'badge-partial'   },
      FullyRefunded:     { label: '↩ Fully Refunded',     cls: 'badge-refunded'  },
    };
    return map[status] || { label: status || 'Unknown', cls: 'badge-unknown' };
  }

  async function fetchPayment(orderId) {
    // If no contract configured, fall back to demo data so the page is usable
    // in a static preview without a live contract.
    if (!CONTRACT_ID) return getDemoData(orderId);

    const { SorobanRpc, Contract, nativeToScVal, scValToNative, Networks } =
      await import('https://cdn.jsdelivr.net/npm/@stellar/stellar-sdk@12/+esm');

    const server   = new SorobanRpc.Server(RPC_URL);
    const contract = new Contract(CONTRACT_ID);

    // get_payment_by_id requires a caller address; use a well-known testnet address
    // for read-only calls (no auth needed for view functions in practice).
    const callerArg = nativeToScVal('GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN', { type: 'address' });
    const idArg     = nativeToScVal(orderId, { type: 'string' });

    try {
      const result = await server.simulateTransaction(
        contract.call('get_payment_by_id', callerArg, idArg)
      );
      if (SorobanRpc.Api.isSimulationError(result)) return null;
      const payment = scValToNative(result.result.retval);

      // Fetch merchant name
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
    const now = Math.floor(Date.now() / 1000);
    return {
      payment: {
        order_id:         orderId,
        merchant_address: 'GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON',
        payer:            'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
        token:            'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        amount:           50000000n,
        status:           'PartiallyRefunded',
        paid_at:          BigInt(now - 7200),
        refunded_amount:  15000000n,
        memo:             'Invoice #001',
      },
      merchant: { name: 'Demo Store', verified: true },
      refunds: [
        {
          refund_id:   'REFUND_001',
          amount:      5000000n,
          reason:      'Item damaged in transit',
          status:      'Completed',
          created_at:  BigInt(now - 3600),
          executed_at: BigInt(now - 1800),
        },
        {
          refund_id:  'REFUND_002',
          amount:     10000000n,
          reason:     'Wrong size delivered',
          status:     'Pending',
          created_at: BigInt(now - 900),
        },
        {
          refund_id:      'REFUND_003',
          amount:         5000000n,
          reason:         'Change of mind',
          status:         'Rejected',
          created_at:     BigInt(now - 5400),
          dispute_reason: 'Item was used before return request was submitted.',
        },
      ],
    };
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  function renderReceipt({ payment, merchant, refunds }) {
    const orderIdEl = document.getElementById('field-order-id');
    orderIdEl.innerHTML = `<code>${escapeHtml(payment.order_id)}</code>${copyButtonHtml(payment.order_id, 'Copy order ID')}`;

    const merchantEl = document.getElementById('field-merchant-name');
    merchantEl.innerHTML = `${escapeHtml(merchant.name || payment.merchant_address)}${copyButtonHtml(payment.merchant_address, 'Copy merchant address')}`;

    document.getElementById('field-date').textContent        = formatDate(payment.paid_at);
    document.getElementById('field-token').innerHTML         = `<code>${escapeHtml(payment.token)}</code>${copyButtonHtml(payment.token, 'Copy token address')}`;

    if (merchant.verified) {
      document.getElementById('verified-badge').style.display = 'inline-flex';
    }

    const { label, cls } = statusBadge(payment.status);
    const badge = document.getElementById('status-badge');
    badge.textContent = label;
    badge.className   = 'badge ' + cls;

    // ── Amount display (currency-aware) ───────────────────────────────────────
    const amountEl    = document.getElementById('field-amount');
    const xlmEqEl     = document.getElementById('field-amount-xlm-eq');
    const currencyToggle = document.getElementById('currency-display-select');

    function refreshAmount() {
      const mode = currencyToggle ? currencyToggle.value : 'native';
      if (mode === 'xlm') {
        amountEl.textContent = convertToXlm(payment.amount, payment.token);
      } else {
        amountEl.textContent = formatTokenAmount(payment.amount, payment.token);
      }
      // Show XLM equivalent only when the token isn't already XLM
      const isXlm = !payment.token || payment.token === 'native';
      if (xlmEqEl) {
        xlmEqEl.style.display = (!isXlm && mode === 'native') ? 'block' : 'none';
        xlmEqEl.textContent   = '≈ ' + convertToXlm(payment.amount, payment.token);
      }
    }

    refreshAmount();
    if (currencyToggle) {
      currencyToggle.addEventListener('change', refreshAmount);
    }

    if (refunds && refunds.length > 0) {
      const list = document.getElementById('refunds-list');
      refunds.forEach(r => {
        const needsHelp = r.status === 'Pending' || r.status === 'Rejected';
        const disputeHtml = r.dispute_reason
          ? `<div class="dispute-section">
               <strong>⚠ Dispute Note</strong>
               ${escapeHtml(r.dispute_reason)}
             </div>`
          : '';
        const helpHtml = needsHelp
          ? `<a class="help-link" href="mailto:support@lumenflow.io?subject=Refund%20query">Need help? Contact support →</a>`
          : '';

        const item = document.createElement('div');
        item.className = 'refund-item';
        item.innerHTML = `
          <div class="refund-row">
            <span>
              <em class="refund-status-icon">${refundStatusIcon(r.status)}</em>
              <strong>${escapeHtml(refundStatusLabel(r.status))}</strong>
              ${r.dispute_reason ? '<span class="dispute-badge">⚠ Disputed</span>' : ''}
            </span>
            <span><strong>${formatTokenAmount(r.amount, payment.token)}</strong></span>
          </div>
          <div class="refund-row" style="font-size:0.8rem;color:#666;">
            <span><strong>Reason:</strong> ${escapeHtml(r.reason || '—')}</span>
            <span>${formatDate(r.created_at)}</span>
          </div>
          ${disputeHtml}
          ${buildRefundTimeline(r)}
          ${helpHtml}`;
        list.appendChild(item);
      });
      document.getElementById('refunds-section').style.display = 'block';
    }

    document.getElementById('receipt-content').style.display = 'block';
  }

  function copyLink() {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(window.location.href)
        .then(() => alert('Link copied!'))
        .catch(() => prompt('Copy this link:', window.location.href));
      return;
    }
    prompt('Copy this link:', window.location.href);
  }
  window.copyLink = copyLink;

  // ── Payment link pre-fill ──────────────────────────────────────────────────

  /**
   * Returns the payment-link params from the current URL, or null if this is
   * not a generated payment link (i.e. the `merchant` param is absent).
   */
  function getPaymentLinkParams() {
    const p = new URLSearchParams(window.location.search);
    if (!p.get('merchant')) return null;
    return {
      merchant: p.get('merchant'),
      token:    p.get('token') || '',
      amount:   p.get('amount') || '0',
      orderId:  p.get('order_id') || p.get('orderId') || '',
      memo:     p.get('memo') || '',
      expires:  parseInt(p.get('expires') || '0', 10),
    };
  }

  function renderPaymentLinkPrefill(params) {
    const expired = params.expires && Date.now() > params.expires;

    document.getElementById('prefill-merchant').textContent  = params.merchant;
    document.getElementById('prefill-order-id').textContent  = params.orderId;
    document.getElementById('prefill-amount').textContent    = formatAmount(BigInt(params.amount)) + ' XLM';
    document.getElementById('prefill-token').textContent     = params.token;

    if (params.memo) {
      document.getElementById('prefill-memo').textContent    = params.memo;
      document.getElementById('prefill-memo-row').style.display = 'block';
    }

    if (params.expires) {
      document.getElementById('prefill-expiry').textContent  =
        new Date(params.expires).toLocaleString();
    } else {
      document.getElementById('prefill-expiry-row').style.display = 'none';
    }

    if (expired) {
      document.getElementById('prefill-expired-badge').style.display = 'inline-flex';
      document.getElementById('prefill-pay-btn').disabled = true;
      document.getElementById('prefill-pay-note').style.display = 'block';
    }

    document.getElementById('payment-prefill').style.display = 'block';
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  (async () => {
    renderModeBanner();
    initCopyButtons(document.body);

    // Check if this URL was generated by the payment link generator.
    // If `merchant` is in the query string, show the pre-fill form instead of
    // trying to look up a receipt that may not exist yet.
    const linkParams = getPaymentLinkParams();
    if (linkParams) {
      renderPaymentLinkPrefill(linkParams);
      return;
    }

    const orderId = getOrderId();
    if (validateOrderId(orderId)) {
      document.getElementById('missing-id').textContent = orderId || '(none)';
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
