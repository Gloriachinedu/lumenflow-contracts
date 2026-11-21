/**
 * Unit tests for frontend/onboarding-analytics.js
 *
 * Run with:  node --test frontend/tests/onboarding-analytics.test.js
 *
 * Covers the normal path (a valid event reaches the sink with a well-formed,
 * PII-free envelope) plus failure / boundary cases required by the funnel
 * metrics spec (docs/merchant-onboarding-metrics.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function freshModule() {
  // Reload so per-session state (funnelId, startedAt, dropped) is reset.
  const p = path.join(__dirname, '..', 'onboarding-analytics.js');
  delete require.cache[require.resolve(p)];
  // Minimal browser-ish globals; no sessionStorage → in-memory funnel id path.
  globalThis.performance = { now: () => Date.now() };
  return require(p);
}

test('normal path: valid event reaches the sink with a well-formed envelope', () => {
  const A = freshModule();
  const seen = [];
  A.configure((e) => seen.push(e));
  A.start();
  A.track('onboarding_step_viewed', { step: 2, stage: 'wallet' });

  assert.equal(seen.length, 2); // onboarding_started + step_viewed
  const ev = seen[1];
  assert.equal(ev.event, 'onboarding_step_viewed');
  assert.equal(ev.schema_version, 1);
  assert.equal(ev.props.step, 2);
  assert.equal(ev.props.stage, 'wallet');
  assert.match(ev.ts, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(typeof ev.funnel_id === 'string' && ev.funnel_id.length > 0);
  assert.ok(Number.isInteger(ev.t_since_start_s) && ev.t_since_start_s >= 0);
});

test('unknown event names are dropped and counted', () => {
  const A = freshModule();
  const seen = [];
  A.configure((e) => seen.push(e));
  const ok = A.track('totally_made_up_event', { step: 1 });
  assert.equal(ok, false);
  assert.equal(seen.length, 0);
  assert.equal(A.droppedCount(), 1);
});

test('PII-shaped properties are stripped before dispatch', () => {
  const A = freshModule();
  let ev = null;
  A.configure((e) => { ev = e; });
  A.track('wallet_connected', {
    provider: 'freighter',
    is_demo: false,
    wallet_address: 'GABC...SECRET',
    email: 'merchant@example.com',
  });
  assert.ok(ev);
  assert.equal(ev.props.provider, 'freighter');
  assert.equal(ev.props.is_demo, false);
  assert.equal('wallet_address' in ev.props, false);
  assert.equal('email' in ev.props, false);
  assert.equal(JSON.stringify(ev).includes('SECRET'), false);
  assert.equal(JSON.stringify(ev).includes('merchant@example.com'), false);
});

test('out-of-range / invalid props are removed, event still sent', () => {
  const A = freshModule();
  let ev = null;
  A.configure((e) => { ev = e; });
  A.track('onboarding_step_viewed', { step: 99, stage: 'not-a-stage' });
  assert.ok(ev);
  assert.equal('step' in ev.props, false);
  assert.equal('stage' in ev.props, false);
});

test('validation-failed event keeps only known field names', () => {
  const A = freshModule();
  let ev = null;
  A.configure((e) => { ev = e; });
  A.track('business_details_validation_failed', {
    fields: ['email', 'category', 'ssn', 'password'],
  });
  assert.deepEqual(ev.props.fields, ['email', 'category']);
});

test('a throwing sink does not break tracking', () => {
  const A = freshModule();
  A.configure(() => { throw new Error('sink is down'); });
  assert.doesNotThrow(() => A.track('onboarding_started'));
});

test('no-op when unconfigured', () => {
  const A = freshModule();
  assert.equal(A.track('onboarding_started'), true); // validated OK
  // Nothing to assert on a sink; just prove it does not throw and counts 0 drops.
  assert.equal(A.droppedCount(), 0);
});

test('start() is idempotent — onboarding_started fires once', () => {
  const A = freshModule();
  const seen = [];
  A.configure((e) => seen.push(e.event));
  A.start();
  A.start();
  A.start();
  assert.deepEqual(seen, ['onboarding_started']);
});

test('duration_ms is coerced to a non-negative integer', () => {
  const A = freshModule();
  let ev = null;
  A.configure((e) => { ev = e; });
  A.track('onboarding_completed', { duration_ms: -5, is_demo: true });
  assert.equal('duration_ms' in ev.props, false); // negative rejected
  A.track('onboarding_completed', { duration_ms: 1234.7, is_demo: true });
  assert.equal(ev.props.duration_ms, 1235);
});

test('stepViewed records a timestamp for the current step', () => {
  const A = freshModule();
  A.configure(() => {});
  A.start();
  A.stepViewed(2, 'wallet');
  const state = A.stepTimingState();
  assert.ok(state);
  assert.equal(state.step, 2);
  assert.equal(state.stage, 'wallet');
  assert.ok(Number.isFinite(state.viewedAt) && state.viewedAt > 0);
});

test('step change emits onboarding_step_duration with correct step/stage', () => {
  const A = freshModule();
  const seen = [];
  A.configure((e) => seen.push(e));
  A.start();
  A.stepViewed(1, 'business');
  A.stepViewed(2, 'wallet');

  const durations = seen.filter((e) => e.event === 'onboarding_step_duration');
  assert.equal(durations.length, 1);
  const ev = durations[0];
  assert.equal(ev.props.step, 1);
  assert.equal(ev.props.stage, 'business');
  assert.ok(Number.isInteger(ev.props.duration_ms));
  assert.ok(ev.props.duration_ms >= 0);
});

test('invalid step durations are rejected', () => {
  const A = freshModule();
  let ev = null;
  A.configure((e) => { ev = e; });
  A.track('onboarding_step_duration', { step: 1, stage: 'wallet', duration_ms: -1 });
  assert.ok(ev);
  assert.equal('duration_ms' in ev.props, false);
  ev = null;
  A.track('onboarding_step_duration', { step: 1, stage: 'wallet', duration_ms: NaN });
  assert.ok(ev);
  assert.equal('duration_ms' in ev.props, false);
});

test('step duration event is dropped when unconfigured', () => {
  const A = freshModule();
  A.stepViewed(1, 'business');
  A.stepViewed(2, 'wallet');
  // No sink configured: nothing dispatched, nothing counted as dropped.
  assert.equal(A.droppedCount(), 0);
});
