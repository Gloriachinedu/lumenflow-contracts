// ── State ─────────────────────────────────────────────────────────────────────
let state = null; // { paymentId, merchantAddress, tokenAddress, amount, signers, required, signatures: Set }

// ── Signer management ─────────────────────────────────────────────────────────

function addSigner() {
  const row = document.createElement('div');
  row.className = 'signer-row';
  row.innerHTML = `
    <input type="text" placeholder="G… signer address" class="signer-input" oninput="updateThresholdLabel()" />
    <button class="btn-icon" onclick="removeSigner(this)" title="Remove">✕</button>`;
  document.getElementById('signers-list').appendChild(row);
  updateThresholdLabel();
}

function removeSigner(btn) {
  const rows = document.querySelectorAll('.signer-row');
  if (rows.length <= 1) return; // keep at least one
  btn.closest('.signer-row').remove();
  updateThresholdLabel();
}

function getSignerValues() {
  return Array.from(document.querySelectorAll('.signer-input'))
    .map(i => i.value.trim())
    .filter(Boolean);
}

function updateThresholdLabel() {
  const count = document.querySelectorAll('.signer-input').length;
  document.getElementById('signer-count').textContent = count;
  validateThreshold();
}

function validateThreshold() {
  const required = parseInt(document.getElementById('required-sigs').value, 10);
  const count    = document.querySelectorAll('.signer-input').length;
  const msg      = document.getElementById('threshold-msg');

  if (!required || required < 1) {
    msg.textContent = 'Required signatures must be at least 1.';
    msg.className   = 'validation-msg bad';
    return false;
  }
  if (required > count) {
    msg.textContent = `Required (${required}) cannot exceed signer count (${count}).`;
    msg.className   = 'validation-msg bad';
    return false;
  }
  msg.textContent = `✔ Valid: ${required} of ${count} signatures required.`;
  msg.className   = 'validation-msg ok';
  return true;
}

// ── Form validation ───────────────────────────────────────────────────────────

function showErr(id, show) {
  const el = document.getElementById(id);
  el.style.display = show ? 'block' : 'none';
  el.classList.toggle('visible', show);
}

function validateForm() {
  let ok = true;

  const paymentId = document.getElementById('payment-id').value.trim();
  showErr('err-payment-id', !paymentId);
  if (!paymentId) ok = false;

  const merchant = document.getElementById('merchant-address').value.trim();
  showErr('err-merchant', !merchant);
  if (!merchant) ok = false;

  const token = document.getElementById('token-address').value.trim();
  showErr('err-token', !token);
  if (!token) ok = false;

  const amount = parseInt(document.getElementById('amount').value, 10);
  showErr('err-amount', !amount || amount < 1);
  if (!amount || amount < 1) ok = false;

  const signers = getSignerValues();
  showErr('err-signers', signers.length === 0);
  if (signers.length === 0) ok = false;

  if (!validateThreshold()) ok = false;

  return ok;
}

// ── Contract interaction ──────────────────────────────────────────────────────

const CONTRACT_ID = window.LUMENFLOW_CONTRACT_ID || '';
const RPC_URL     = window.LUMENFLOW_RPC_URL     || 'https://soroban-testnet.stellar.org';

async function callInitiateMultisig({ paymentId, merchantAddress, tokenAddress, amount, signers, required }) {
  if (!CONTRACT_ID) {
    await new Promise(r => setTimeout(r, 600));
    return { success: true };
  }
  try {
    await import('https://cdn.jsdelivr.net/npm/@stellar/stellar-sdk@12/+esm');
    throw new Error('Connect a wallet to sign transactions. Set window.LUMENFLOW_CONTRACT_ID and integrate Freighter.');
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function callSignMultisig(paymentId, signerAddress) {
  if (!CONTRACT_ID) {
    await new Promise(r => setTimeout(r, 400));
    return { success: true };
  }
  return { success: false, error: 'Wallet integration required.' };
}

async function callExecuteMultisig(paymentId) {
  if (!CONTRACT_ID) {
    await new Promise(r => setTimeout(r, 500));
    return { success: true };
  }
  return { success: false, error: 'Wallet integration required.' };
}

// ── Submit ────────────────────────────────────────────────────────────────────

async function submitForm() {
  if (!validateForm()) return;

  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  btn.textContent = 'Initiating…';

  const paymentId       = document.getElementById('payment-id').value.trim();
  const merchantAddress = document.getElementById('merchant-address').value.trim();
  const tokenAddress    = document.getElementById('token-address').value.trim();
  const amount          = parseInt(document.getElementById('amount').value, 10);
  const signers         = getSignerValues();
  const required        = parseInt(document.getElementById('required-sigs').value, 10);

  const result = await callInitiateMultisig({ paymentId, merchantAddress, tokenAddress, amount, signers, required });

  if (!result.success) {
    const alertEl = document.getElementById('form-alert');
    alertEl.textContent  = result.error || 'Failed to initiate payment.';
    alertEl.className    = 'alert alert-error';
    alertEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Initiate Payment';
    return;
  }

  state = { paymentId, merchantAddress, tokenAddress, amount, signers, required, signatures: new Set() };
  document.getElementById('form-panel').style.display = 'none';
  renderProgress();
  document.getElementById('progress-panel').style.display = 'block';
}

// ── Progress ──────────────────────────────────────────────────────────────────

function renderProgress() {
  const { signers, required, signatures } = state;
  const signed = signatures.size;
  const pct    = Math.round((signed / signers.length) * 100);

  document.getElementById('progress-bar').style.width = pct + '%';
  document.getElementById('progress-fraction').textContent = `${signed} / ${signers.length} signed`;
  document.getElementById('progress-label').textContent =
    signed >= required
      ? `✔ Threshold met (${required} required). Ready to execute.`
      : `${required - signed} more signature(s) needed to reach threshold.`;

  const list = document.getElementById('signer-status-list');
  list.innerHTML = '';
  signers.forEach(addr => {
    const isSigned = signatures.has(addr);
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="sig-icon">${isSigned ? '✅' : '⬜'}</span>
      <span class="sig-addr">${addr}</span>
      <span class="sig-status ${isSigned ? 'signed' : 'pending'}">${isSigned ? 'Signed' : 'Pending'}</span>
      <button class="sign-btn" onclick="signPayment('${addr}')" ${isSigned ? 'disabled' : ''}>
        ${isSigned ? 'Signed' : 'Sign'}
      </button>`;
    list.appendChild(li);
  });

  document.getElementById('execute-btn').disabled = signed < required;
}

async function signPayment(signerAddress) {
  const btn = [...document.querySelectorAll('.sign-btn')]
    .find(b => b.closest('li').querySelector('.sig-addr').textContent === signerAddress);
  if (btn) { btn.disabled = true; btn.textContent = 'Signing…'; }

  const result = await callSignMultisig(state.paymentId, signerAddress);

  if (result.success) {
    state.signatures.add(signerAddress);
    renderProgress();
  } else {
    if (btn) { btn.disabled = false; btn.textContent = 'Sign'; }
    showExecuteAlert(result.error || 'Signing failed.', false);
  }
}

async function executePayment() {
  const btn = document.getElementById('execute-btn');
  btn.disabled = true;
  btn.textContent = 'Executing…';

  const result = await callExecuteMultisig(state.paymentId);

  if (result.success) {
    showExecuteAlert('✔ Payment executed successfully!', true);
    btn.textContent = 'Executed';
  } else {
    btn.disabled = false;
    btn.textContent = 'Execute Payment';
    showExecuteAlert(result.error || 'Execution failed.', false);
  }
}

function showExecuteAlert(msg, success) {
  const el = document.getElementById('execute-alert');
  el.textContent    = msg;
  el.className      = 'alert ' + (success ? 'alert-success' : 'alert-error');
  el.style.display  = 'block';
}

// ── Init ──────────────────────────────────────────────────────────────────────
updateThresholdLabel();
