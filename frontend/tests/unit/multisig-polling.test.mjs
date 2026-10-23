/**
 * Unit tests for the multisig progress-indicator polling logic (issue #1355).
 *
 * Tests the core polling state machine in isolation:
 *   – startPolling / stopPolling lifecycle
 *   – Progress bar percentage and aria-valuenow updates
 *   – Stopping conditions: threshold met, executed, cancelled, expired
 *   – Transient errors leave polling running
 *   – Execute button aria-disabled reflects threshold state
 *
 * Run with:  npm run test:unit   (from the frontend/ directory)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Minimal DOM + timer shims ─────────────────────────────────────────────────
//
// The polling logic is extracted here rather than imported from the browser
// module, so we can run it in Node without a full DOM or bundler.

function makeFakeDOM() {
  const attrs = {};
  const styles = {};
  const elements = {};

  function el(id) {
    if (!elements[id]) {
      elements[id] = {
        id,
        _style: {},
        _attrs: {},
        _text: '',
        _html: '',
        get style() { return this._style; },
        setAttribute(k, v) { this._attrs[k] = v; },
        getAttribute(k)    { return this._attrs[k] ?? null; },
        get textContent()  { return this._text; },
        set textContent(v) { this._text = v; },
        get innerHTML()    { return this._html; },
        set innerHTML(v)   { this._html = v; },
        get disabled()     { return this._attrs.disabled === 'true'; },
        set disabled(v)    { this._attrs.disabled = String(v); },
      };
    }
    return elements[id];
  }

  return { el, elements };
}

// ── Polling state machine (mirrors multisig-page.js / multisig.html) ─────────

function makePollingMachine({ dom, callGetMultisigPayment }) {
  let _pollInterval = null;
  let state = null;

  function renderProgress() {
    if (!state) return;
    const { signers, required, signatures } = state;
    const signed = signatures.size;
    const pct    = Math.round((signed / signers.length) * 100);

    const bar = dom.el('progress-bar');
    bar.style.width = pct + '%';
    bar.setAttribute('aria-valuenow', String(pct));

    const execBtn = dom.el('execute-btn');
    const thresholdMet = signed >= required;
    execBtn.disabled = !thresholdMet;
    execBtn.setAttribute('aria-disabled', String(!thresholdMet));
  }

  function stopPolling() {
    if (_pollInterval !== null) {
      clearInterval(_pollInterval);
      _pollInterval = null;
    }
  }

  function startPolling() {
    stopPolling();
    _pollInterval = setInterval(async () => {
      if (!state) { stopPolling(); return; }

      const result = await callGetMultisigPayment(state.paymentId);
      if (!result.success) return; // transient error — keep polling

      const ms = result.data;

      if (ms && ms.collected && Array.isArray(ms.collected)) {
        ms.collected.forEach(entry => {
          const addr = entry.signer ?? entry;
          if (addr) state.signatures.add(addr);
        });
      }

      renderProgress();

      const thresholdMet = state.signatures.size >= state.required;
      const isExecuted   = ms && ms.executed;
      const isCancelled  = ms && ms.cancelled;
      const isExpired    = ms && ms.expires_at && (Date.now() / 1000) > ms.expires_at;

      if (thresholdMet || isExecuted || isCancelled || isExpired) {
        stopPolling();
      }
    }, 10_000);
  }

  function setState(s) { state = s; }
  function getInterval() { return _pollInterval; }

  return { startPolling, stopPolling, renderProgress, setState, getInterval };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SIGNER_A = 'G' + 'A'.repeat(55);
const SIGNER_B = 'G' + 'B'.repeat(55);

function baseState(overrides = {}) {
  return {
    paymentId: 'MS_001',
    signers: [SIGNER_A, SIGNER_B],
    required: 2,
    signatures: new Set(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('startPolling sets an interval; stopPolling clears it', () => {
  const dom = makeFakeDOM();
  const machine = makePollingMachine({
    dom,
    callGetMultisigPayment: async () => ({ success: false }),
  });
  machine.setState(baseState());

  machine.startPolling();
  assert.notEqual(machine.getInterval(), null, 'interval should be set after startPolling');

  machine.stopPolling();
  assert.equal(machine.getInterval(), null, 'interval should be null after stopPolling');
});

test('calling startPolling twice does not leak a second interval', () => {
  const dom = makeFakeDOM();
  const intervals = [];
  const origSet   = global.setInterval;
  const origClear = global.clearInterval;

  const active = new Set();
  global.setInterval   = (fn, ms) => { const id = origSet(fn, ms); active.add(id); return id; };
  global.clearInterval = (id)     => { active.delete(id); origClear(id); };

  const machine = makePollingMachine({
    dom,
    callGetMultisigPayment: async () => ({ success: false }),
  });
  machine.setState(baseState());

  machine.startPolling();
  machine.startPolling(); // second call should clear the first

  assert.equal(active.size, 1, 'only one interval should be active after two startPolling calls');

  machine.stopPolling();
  assert.equal(active.size, 0);

  global.setInterval   = origSet;
  global.clearInterval = origClear;
});

test('renderProgress sets aria-valuenow to 0 when no signatures collected', () => {
  const dom = makeFakeDOM();
  const machine = makePollingMachine({
    dom,
    callGetMultisigPayment: async () => ({ success: false }),
  });
  machine.setState(baseState());
  machine.renderProgress();

  assert.equal(dom.el('progress-bar').getAttribute('aria-valuenow'), '0');
});

test('renderProgress sets aria-valuenow to 50 when half the signers have signed', () => {
  const dom = makeFakeDOM();
  const machine = makePollingMachine({
    dom,
    callGetMultisigPayment: async () => ({ success: false }),
  });
  machine.setState(baseState({ signatures: new Set([SIGNER_A]) }));
  machine.renderProgress();

  assert.equal(dom.el('progress-bar').getAttribute('aria-valuenow'), '50');
});

test('renderProgress sets aria-valuenow to 100 when all signers have signed', () => {
  const dom = makeFakeDOM();
  const machine = makePollingMachine({
    dom,
    callGetMultisigPayment: async () => ({ success: false }),
  });
  machine.setState(baseState({ signatures: new Set([SIGNER_A, SIGNER_B]) }));
  machine.renderProgress();

  assert.equal(dom.el('progress-bar').getAttribute('aria-valuenow'), '100');
});

test('execute button is disabled (aria-disabled=true) when threshold is not met', () => {
  const dom = makeFakeDOM();
  const machine = makePollingMachine({
    dom,
    callGetMultisigPayment: async () => ({ success: false }),
  });
  machine.setState(baseState()); // 0 of 2 signatures
  machine.renderProgress();

  assert.equal(dom.el('execute-btn').getAttribute('aria-disabled'), 'true');
});

test('execute button is enabled (aria-disabled=false) when threshold is met', () => {
  const dom = makeFakeDOM();
  const machine = makePollingMachine({
    dom,
    callGetMultisigPayment: async () => ({ success: false }),
  });
  machine.setState(baseState({ signatures: new Set([SIGNER_A, SIGNER_B]) }));
  machine.renderProgress();

  assert.equal(dom.el('execute-btn').getAttribute('aria-disabled'), 'false');
});

test('polling merges new signatures from contract response and stops when threshold is met', async () => {
  const dom = makeFakeDOM();
  let callCount = 0;

  const machine = makePollingMachine({
    dom,
    callGetMultisigPayment: async () => {
      callCount++;
      return {
        success: true,
        data: { collected: [{ signer: SIGNER_A }, { signer: SIGNER_B }] },
      };
    },
  });

  machine.setState(baseState()); // start with 0 signatures

  // Manually trigger one poll tick (simulates setInterval firing)
  const state = machine.getInterval; // capture before start

  // Run the interval callback directly instead of waiting 10 s
  machine.startPolling();
  const id = machine.getInterval();
  assert.notEqual(id, null, 'interval must be active after start');

  // Simulate the interval callback running once
  await new Promise(resolve => {
    const origSet = global.setInterval;
    // The interval was already registered; invoke its callback manually.
    // Re-create via a zero-delay version to trigger immediately in tests.
    machine.stopPolling();

    let cbRef;
    const origInterval = global.setInterval;
    global.setInterval = (cb, ms) => {
      cbRef = cb;
      return origInterval(() => {}, 999999); // register a no-op real interval so clearInterval works
    };
    machine.startPolling();
    global.setInterval = origInterval;

    cbRef().then(() => resolve());
  });

  // After threshold is met the machine should have self-stopped
  assert.equal(machine.getInterval(), null, 'polling should self-stop when threshold is met');
  assert.equal(callCount, 1, 'contract query was called once');
});

test('transient errors do not stop polling', async () => {
  const dom = makeFakeDOM();
  let callCount = 0;

  const machine = makePollingMachine({
    dom,
    callGetMultisigPayment: async () => {
      callCount++;
      return { success: false, error: 'RPC unavailable' };
    },
  });

  machine.setState(baseState());
  machine.startPolling();

  // Invoke the callback manually once
  await new Promise(resolve => {
    machine.stopPolling();
    let cbRef;
    const origInterval = global.setInterval;
    global.setInterval = (cb) => {
      cbRef = cb;
      return origInterval(() => {}, 999999);
    };
    machine.startPolling();
    global.setInterval = origInterval;
    cbRef().then(() => resolve());
  });

  // Interval should still be active — transient errors do not stop polling
  assert.notEqual(machine.getInterval(), null, 'polling should continue after a transient error');
  machine.stopPolling();
});

test('polling stops when payment is marked executed', async () => {
  const dom = makeFakeDOM();

  const machine = makePollingMachine({
    dom,
    callGetMultisigPayment: async () => ({
      success: true,
      data: { collected: [], executed: true },
    }),
  });

  machine.setState(baseState());

  await new Promise(resolve => {
    machine.stopPolling();
    let cbRef;
    const origInterval = global.setInterval;
    global.setInterval = (cb) => {
      cbRef = cb;
      return origInterval(() => {}, 999999);
    };
    machine.startPolling();
    global.setInterval = origInterval;
    cbRef().then(() => resolve());
  });

  assert.equal(machine.getInterval(), null, 'polling should stop when payment is executed');
});

test('polling stops when payment is marked cancelled', async () => {
  const dom = makeFakeDOM();

  const machine = makePollingMachine({
    dom,
    callGetMultisigPayment: async () => ({
      success: true,
      data: { collected: [], cancelled: true },
    }),
  });

  machine.setState(baseState());

  await new Promise(resolve => {
    machine.stopPolling();
    let cbRef;
    const origInterval = global.setInterval;
    global.setInterval = (cb) => {
      cbRef = cb;
      return origInterval(() => {}, 999999);
    };
    machine.startPolling();
    global.setInterval = origInterval;
    cbRef().then(() => resolve());
  });

  assert.equal(machine.getInterval(), null, 'polling should stop when payment is cancelled');
});

test('polling stops when payment has expired', async () => {
  const dom = makeFakeDOM();
  const pastTimestamp = Math.floor(Date.now() / 1000) - 1; // 1 second in the past

  const machine = makePollingMachine({
    dom,
    callGetMultisigPayment: async () => ({
      success: true,
      data: { collected: [], expires_at: pastTimestamp },
    }),
  });

  machine.setState(baseState());

  await new Promise(resolve => {
    machine.stopPolling();
    let cbRef;
    const origInterval = global.setInterval;
    global.setInterval = (cb) => {
      cbRef = cb;
      return origInterval(() => {}, 999999);
    };
    machine.startPolling();
    global.setInterval = origInterval;
    cbRef().then(() => resolve());
  });

  assert.equal(machine.getInterval(), null, 'polling should stop when payment has expired');
});

test('polling does not stop when expires_at is in the future', async () => {
  const dom = makeFakeDOM();
  const futureTimestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

  const machine = makePollingMachine({
    dom,
    callGetMultisigPayment: async () => ({
      success: true,
      data: { collected: [], expires_at: futureTimestamp },
    }),
  });

  machine.setState(baseState());

  await new Promise(resolve => {
    machine.stopPolling();
    let cbRef;
    const origInterval = global.setInterval;
    global.setInterval = (cb) => {
      cbRef = cb;
      return origInterval(() => {}, 999999);
    };
    machine.startPolling();
    global.setInterval = origInterval;
    cbRef().then(() => resolve());
  });

  assert.notEqual(machine.getInterval(), null, 'polling should continue when payment has not yet expired');
  machine.stopPolling();
});
