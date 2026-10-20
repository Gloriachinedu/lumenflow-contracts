import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPaymentRequestExpiredEvent } from './payment-request-expired-event.mjs';

test('buildPaymentRequestExpiredEvent evaluates healthy, warning, and critical thresholds', () => {
  const healthy = buildPaymentRequestExpiredEvent({ subjectId: 'lf-01', primaryCount: 15, secondaryCount: 10, thresholdLimit: 100 });
  assert.equal(healthy.status, 'healthy');
  assert.equal(healthy.scoreBps, 2500);

  const warning = buildPaymentRequestExpiredEvent({ subjectId: 'lf-02', primaryCount: 40, secondaryCount: 20, thresholdLimit: 100 });
  assert.equal(warning.status, 'warning');
  assert.equal(warning.scoreBps, 6000);

  const critical = buildPaymentRequestExpiredEvent({ subjectId: 'lf-03', primaryCount: 75, secondaryCount: 20, thresholdLimit: 100 });
  assert.equal(critical.status, 'critical');
  assert.equal(critical.scoreBps, 9500);

  assert.throws(() => buildPaymentRequestExpiredEvent({ subjectId: '   ' }), /subjectId must be a non-empty string/);
});
