  import { CONTRACT_ID, RPC_URL, renderModeBanner, copyButtonHtml, initCopyButtons, formatAmount } from './lumenflow-shared.js';
  import { validateOrderId, validateAmount, validateAddress, isValidStellarKey } from './validation.js';

  // ── State ──────────────────────────────────────────────────────────────────

  let state = null; // { paymentId, merchantAddress, tokenAddress, amount, signers, required, signatures: Set }

  // ── Signer management ──────────────────────────────────────────────────────

  function addSigner() {
    const list = document.getElementById('signers-list');
    const index = list.querySelectorAll('.signer-row').length + 1;
    const row = document.createElement('div');
    row.className = 'signer-row';
    row.innerHTML = `
      <input type="text" placeholder="G… signer address" class="signer-input" aria-label="Signer address ${index}" oninput="onSignerInput()" />
      <button type="button" class="btn-icon" onclick="removeSigner(this)" aria-label="Remove signer ${index}">✕</button>`;
    list.appendChild(row);
    updateThresholdLabel();
    // Move focus to the new input for keyboard users
    row.querySelector('.signer-input').focus();
  }

  function removeSigner(btn) {
    const list = document.getElementById('signers-list');
    const rows = list.querySelectorAll('.signer-row');
    if (rows.length <= 1) return; // keep at least one

    const row = btn.closest('.signer-row');
    const rowIndex = Array.from(rows).indexOf(row);

    row.remove();
    updateThresholdLabel();

    // Move focus: try previous row's input, otherwise the "Add signer" button
    const remaining = list.querySelectorAll('.signer-row');
    const focusTarget = remaining[rowIndex - 1]
      ? remaining[rowIndex - 1].querySelector('.signer-input')
      : remaining[0]
        ? remaining[0].querySelector('.signer-input')
        : document.getElementById('add-signer-btn');
    if (focusTarget) focusTarget.focus();
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
    updateSubmitState();
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

  // ── Form validation ────────────────────────────────────────────────────────
  // Field-level rules live in the shared validation.js module.

  function setErr(id, message) {
    const el = document.getElementById(id);
    if (message) el.textContent = message;
    el.style.display = message ? 'block' : 'none';
    el.classList.toggle('visible', !!message);
  }

  function markInput(id, invalid) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('error', invalid);
    if (invalid) {
      el.setAttribute('aria-invalid', 'true');
    } else {
      el.removeAttribute('aria-invalid');
    }
  }

  const FIELD_ERR_IDS = {
    'payment-id':       'err-payment-id',
    'merchant-address': 'err-merchant',
    'token-address':    'err-token',
    'amount':           'err-amount',
  };

  const FIELD_VALIDATORS = {
    'payment-id':       v => validateOrderId(v, 'Payment ID'),
    'merchant-address': v => validateAddress(v, { label: 'Merchant address' }),
    'token-address':    v => validateAddress(v, { label: 'Token address', prefixes: ['C', 'G'] }),
    'amount':           v => validateAmount(v, { integer: true }),
  };

  function validateField(fieldId, show) {
    const message = FIELD_VALIDATORS[fieldId](document.getElementById(fieldId).value);
    if (show) {
      setErr(FIELD_ERR_IDS[fieldId], message);
      markInput(fieldId, !!message);
    }
    return !message;
  }

  function validateSigners(show) {
    const signerInputs = Array.from(document.querySelectorAll('.signer-input'));
    const signers = signerInputs.map(i => i.value.trim()).filter(Boolean);
    let signerErr = '';
    if (signers.length === 0) {
      signerErr = 'At least one signer is required.';
    } else {
      let anyInvalid = false;
      signerInputs.forEach(input => {
        const value = input.value.trim();
        const bad = value.length > 0 && !isValidStellarKey(value, ['G']);
        if (bad) anyInvalid = true;
        if (!show) return;
        input.classList.toggle('error', bad);
        if (bad) {
          input.setAttribute('aria-invalid', 'true');
        } else {
          input.removeAttribute('aria-invalid');
        }
      });
      if (anyInvalid) signerErr = 'Each signer must be a valid Stellar address (starts with G, 56 characters).';
      else if (new Set(signers).size !== signers.length) signerErr = 'Signer addresses must be unique.';
    }
    if (show) setErr('err-signers', signerErr);
    return !signerErr;
  }

  // show=false checks validity without touching inline errors, so the submit
  // button can be gated without flagging fields the user has not reached yet.
  function validateForm(show = true) {
    let ok = true;
    Object.keys(FIELD_VALIDATORS).forEach(fieldId => {
      if (!validateField(fieldId, show)) ok = false;
    });
    if (!validateSigners(show)) ok = false;
    if (!validateThreshold()) ok = false;
    return ok;
  }

  function updateSubmitState() {
    document.getElementById('submit-btn').disabled = !validateForm(false);
  }

  function onSignerInput() {
    updateThresholdLabel();
    validateSigners(true);
  }

  // ── Contract interaction ───────────────────────────────────────────────────
  // CONTRACT_ID and RPC_URL are imported from lumenflow-shared.js

  /**
   * Wallet adapter hook.
   *
   * Replace the body of `walletAdapter` with your preferred wallet library:
   *   - Freighter:  https://docs.freighter.app
   *   - Albedo:     https://albedo.link/docs
   *   - WalletConnect / Stellar WalletKit (community)
   *
   * The adapter must resolve to { publicKey: string } on success or throw on
   * failure. Downstream call helpers (`callInitiateMultisig`, etc.) then pass
   * the public key to the transaction builder and request signature approval.
   *
   * @returns {Promise<{publicKey: string}>}
   */
  const walletAdapter = {
    /**
     * Request wallet connection. Returns the connected public key.
     * Throws a user-friendly message if the wallet is unavailable.
     */
    async connect() {
      // ── Freighter integration point ─────────────────────────────────────
      // import { isConnected, getPublicKey, requestAccess } from '@stellar/freighter-api';
      // const connected = await isConnected();
      // if (!connected.isConnected) await requestAccess();
      // const result = await getPublicKey();
      // if (result.error) throw new Error(result.error);
      // return { publicKey: result.address };
      // ────────────────────────────────────────────────────────────────────

      throw new Error(
        'No wallet detected. Install the Freighter browser extension (freighter.app) ' +
        'and reload the page, or set window.LUMENFLOW_CONTRACT_ID in demo mode.'
      );
    },

    /**
     * Sign and submit a transaction XDR.
     * @param {string} xdr - Base64-encoded transaction envelope XDR.
     * @returns {Promise<{hash: string}>}
     */
    async signAndSubmit(xdr) {
      // ── Freighter integration point ─────────────────────────────────────
      // import { signTransaction } from '@stellar/freighter-api';
      // const { signedTxXdr, error } = await signTransaction(xdr, { networkPassphrase: Networks.TESTNET });
      // if (error) throw new Error(error);
      // const server = new SorobanRpc.Server(RPC_URL);
      // const tx = TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);
      // const result = await server.sendTransaction(tx);
      // if (result.status === 'ERROR') throw new Error(result.errorResult?.result().switch().name);
      // return { hash: result.hash };
      // ────────────────────────────────────────────────────────────────────

      throw new Error('Wallet adapter not configured. See walletAdapter.signAndSubmit in multisig.html.');
    },
  };

  // Connected wallet public key (null in demo mode or before wallet connect).
  let connectedPublicKey = null;

  async function connectWallet() {
    const btn  = document.getElementById('connect-wallet-btn');
    const bar  = document.getElementById('wallet-bar');
    const text = document.getElementById('wallet-bar-text');
    btn.disabled = true;
    btn.textContent = 'Connecting…';

    if (!CONTRACT_ID) {
      bar.className = 'demo';
      text.textContent = '⚠ Demo mode – set LUMENFLOW_CONTRACT_ID to connect to a live contract.';
      btn.disabled = false;
      btn.textContent = 'Connect Wallet';
      return;
    }

    try {
      const { publicKey } = await walletAdapter.connect();
      connectedPublicKey = publicKey;
      bar.className = 'live';
      text.textContent = `✔ Wallet connected: ${publicKey.slice(0, 8)}…${publicKey.slice(-4)}`;
      btn.textContent = 'Disconnect';
      btn.onclick = disconnectWallet;
    } catch (e) {
      bar.className = 'error';
      text.textContent = `✖ ${e.message}`;
      btn.disabled = false;
      btn.textContent = 'Retry';
    }
  }

  function disconnectWallet() {
    connectedPublicKey = null;
    const bar  = document.getElementById('wallet-bar');
    const text = document.getElementById('wallet-bar-text');
    const btn  = document.getElementById('connect-wallet-btn');
    bar.className = 'demo';
    text.textContent = '⚠ Demo mode – transactions are simulated. Connect a wallet to go live.';
    btn.textContent = 'Connect Wallet';
    btn.onclick = connectWallet;
  }

  async function callInitiateMultisig({ paymentId, merchantAddress, tokenAddress, amount, signers, required }) {
    if (!CONTRACT_ID) {
      // ⚠ DEMO MODE: The logic below is a placeholder. No real transaction is sent.
      // In production, use a Stellar wallet (e.g. Freighter) to sign transactions.
      // NEVER hardcode or expose private keys in frontend code.
      // See docs/multisig-guide.md for production integration instructions.
      await new Promise(r => setTimeout(r, 600));
      return { success: true };
    }
    if (!connectedPublicKey) {
      return { success: false, error: 'Please connect a wallet before initiating a payment.' };
    }
    try {
      const { SorobanRpc, Contract, nativeToScVal, Networks, TransactionBuilder, BASE_FEE } =
        await import('https://cdn.jsdelivr.net/npm/@stellar/stellar-sdk@12/+esm');
      const server   = new SorobanRpc.Server(RPC_URL);
      const contract = new Contract(CONTRACT_ID);
      const account  = await server.getAccount(connectedPublicKey);
      const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(contract.call(
          'initiate_multisig_payment',
          nativeToScVal(connectedPublicKey, { type: 'address' }),
          nativeToScVal(paymentId,          { type: 'string'  }),
          nativeToScVal(merchantAddress,    { type: 'address' }),
          nativeToScVal(tokenAddress,       { type: 'address' }),
          nativeToScVal(BigInt(amount),     { type: 'i128'    }),
          nativeToScVal(signers.map(s => nativeToScVal(s, { type: 'address' }))),
          nativeToScVal(required,           { type: 'u32'     }),
        ))
        .setTimeout(30)
        .build();
      const sim = await server.simulateTransaction(tx);
      if (SorobanRpc.Api.isSimulationError(sim)) throw new Error(sim.error);
      const preparedXdr = SorobanRpc.assembleTransaction(tx, sim).build().toXDR();
      await walletAdapter.signAndSubmit(preparedXdr);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async function callSignMultisig(paymentId, signerAddress) {
    if (!CONTRACT_ID) {
      // ⚠ DEMO MODE: The signing logic below is a placeholder. No real signature is produced.
      // In production, use a Stellar wallet (e.g. Freighter) to sign transactions.
      // NEVER hardcode or expose private keys in frontend code.
      // See docs/multisig-guide.md for production integration instructions.
      await new Promise(r => setTimeout(r, 400));
      return { success: true };
    }
    if (!connectedPublicKey) {
      return { success: false, error: 'Please connect a wallet to sign.' };
    }
    try {
      const { SorobanRpc, Contract, nativeToScVal, Networks, TransactionBuilder, BASE_FEE } =
        await import('https://cdn.jsdelivr.net/npm/@stellar/stellar-sdk@12/+esm');
      const server   = new SorobanRpc.Server(RPC_URL);
      const contract = new Contract(CONTRACT_ID);
      const account  = await server.getAccount(connectedPublicKey);
      const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(contract.call(
          'sign_multisig_payment',
          nativeToScVal(signerAddress, { type: 'address' }),
          nativeToScVal(paymentId,     { type: 'string'  }),
          // ⚠ DEMO MODE: placeholder zero-bytes signature — replace with real wallet-signed bytes in production.
          // In production, the wallet (e.g. Freighter) supplies the real ed25519 signature via signAndSubmit.
          // NEVER derive or pass a real private key here.
          nativeToScVal(new Uint8Array(64)), // placeholder: real signature from wallet
        ))
        .setTimeout(30)
        .build();
      const sim = await server.simulateTransaction(tx);
      if (SorobanRpc.Api.isSimulationError(sim)) throw new Error(sim.error);
      const preparedXdr = SorobanRpc.assembleTransaction(tx, sim).build().toXDR();
      await walletAdapter.signAndSubmit(preparedXdr);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async function callExecuteMultisig(paymentId) {
    if (!CONTRACT_ID) {
      // ⚠ DEMO MODE: The execution logic below is a placeholder. No real transaction is sent.
      // In production, use a Stellar wallet (e.g. Freighter) to sign transactions.
      // NEVER hardcode or expose private keys in frontend code.
      // See docs/multisig-guide.md for production integration instructions.
      await new Promise(r => setTimeout(r, 500));
      return { success: true };
    }
    if (!connectedPublicKey) {
      return { success: false, error: 'Please connect a wallet to execute.' };
    }
    try {
      const { SorobanRpc, Contract, nativeToScVal, Networks, TransactionBuilder, BASE_FEE } =
        await import('https://cdn.jsdelivr.net/npm/@stellar/stellar-sdk@12/+esm');
      const server   = new SorobanRpc.Server(RPC_URL);
      const contract = new Contract(CONTRACT_ID);
      const account  = await server.getAccount(connectedPublicKey);
      const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(contract.call(
          'execute_multisig_payment',
          nativeToScVal(connectedPublicKey, { type: 'address' }),
          nativeToScVal(paymentId,          { type: 'string'  }),
        ))
        .setTimeout(30)
        .build();
      const sim = await server.simulateTransaction(tx);
      if (SorobanRpc.Api.isSimulationError(sim)) throw new Error(sim.error);
      const preparedXdr = SorobanRpc.assembleTransaction(tx, sim).build().toXDR();
      await walletAdapter.signAndSubmit(preparedXdr);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  async function submitForm() {
    if (!validateForm()) return;

    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    btn.textContent = 'Initiating…';

    const paymentId      = document.getElementById('payment-id').value.trim();
    const merchantAddress = document.getElementById('merchant-address').value.trim();
    const tokenAddress   = document.getElementById('token-address').value.trim();
    // Number() matches validateAmount; parseInt would read '1e3' as 1.
    const amount         = Number(document.getElementById('amount').value.trim());
    const signers        = getSignerValues();
    const required       = parseInt(document.getElementById('required-sigs').value, 10);

    const result = await callInitiateMultisig({ paymentId, merchantAddress, tokenAddress, amount, signers, required });

    if (!result.success) {
      const alert = document.getElementById('form-alert');
      alert.textContent = result.error || 'Failed to initiate payment.';
      alert.className   = 'alert alert-error';
      alert.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Initiate Payment';
      return;
    }

    // Store state and show progress panel
    state = { paymentId, merchantAddress, tokenAddress, amount, signers, required, signatures: new Set() };
    document.getElementById('form-panel').style.display = 'none';
    renderProgress();
    document.getElementById('progress-panel').style.display = 'block';
  }

  // ── Progress ───────────────────────────────────────────────────────────────

  function renderProgress() {
    const { paymentId, signers, required, signatures } = state;
    const signed = signatures.size;
    const pct    = Math.round((signed / signers.length) * 100);

    // Show Payment ID with copy button
    let idDisplay = document.getElementById('progress-payment-id');
    if (!idDisplay) {
      idDisplay = document.createElement('p');
      idDisplay.id = 'progress-payment-id';
      idDisplay.style.cssText = 'font-size:0.82rem;color:#555;margin-bottom:0.75rem;';
      document.getElementById('progress-panel').querySelector('.progress-header').after(idDisplay);
    }
    idDisplay.innerHTML = `Payment ID: <code>${paymentId}</code>${copyButtonHtml(paymentId, 'Copy payment ID')}`;

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
        <span class="sig-addr"><code title="${addr}">${addr.slice(0,8)}…</code>${copyButtonHtml(addr, 'Copy signer address')}</span>
        <span class="sig-status ${isSigned ? 'signed' : 'pending'}">${isSigned ? 'Signed' : 'Pending'}</span>
        <button class="sign-btn" onclick="signPayment('${addr}')" ${isSigned ? 'disabled' : ''}>
          ${isSigned ? 'Signed' : 'Sign'}
        </button>`;
      list.appendChild(li);
    });

    const execBtn = document.getElementById('execute-btn');
    execBtn.disabled = signed < required;
  }

  async function signPayment(signerAddress) {
    const btn = [...document.querySelectorAll('.sign-btn')]
      .find(b => b.onclick && b.onclick.toString().includes(signerAddress));
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
    el.textContent   = msg;
    el.className     = 'alert ' + (success ? 'alert-success' : 'alert-error');
    el.style.display = 'block';
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  // Expose handlers used by inline onclick attributes (required for ES modules)
  window.addSigner       = addSigner;
  window.removeSigner    = removeSigner;
  window.updateThresholdLabel = updateThresholdLabel;
  window.validateThreshold    = validateThreshold;
  window.onSignerInput   = onSignerInput;
  window.submitForm      = submitForm;
  window.signPayment     = signPayment;
  window.executePayment  = executePayment;
  window.connectWallet   = connectWallet;

  document.getElementById('required-sigs').addEventListener('input', () => {
    validateThreshold();
    updateSubmitState();
  });

  Object.keys(FIELD_VALIDATORS).forEach(fieldId => {
    document.getElementById(fieldId).addEventListener('input', () => {
      validateField(fieldId, true);
      updateSubmitState();
    });
  });

  // Show the demo security notice banner when no CONTRACT_ID is configured.
  // This makes it explicit to developers that the page is in demo/placeholder mode.
  if (!CONTRACT_ID) {
    const notice = document.getElementById('demo-security-notice');
    if (notice) notice.style.display = 'block';
  }

  renderModeBanner();
  initCopyButtons(document.body);
  updateThresholdLabel();
