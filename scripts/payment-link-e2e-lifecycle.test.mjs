import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyPaymentLinkLifecycleFlow } from './payment-link-e2e-lifecycle.mjs';

test('verifyPaymentLinkLifecycleFlow evaluates healthy, warning, and critical thresholds', () => {
  const healthy = verifyPaymentLinkLifecycleFlow({ subjectId: 'lf-01', primaryCount: 15, secondaryCount: 10, thresholdLimit: 100 });
  assert.equal(healthy.status, 'healthy');
  assert.equal(healthy.scoreBps, 2500);

  const warning = verifyPaymentLinkLifecycleFlow({ subjectId: 'lf-02', primaryCount: 40, secondaryCount: 20, thresholdLimit: 100 });
  assert.equal(warning.status, 'warning');
  assert.equal(warning.scoreBps, 6000);

  const critical = verifyPaymentLinkLifecycleFlow({ subjectId: 'lf-03', primaryCount: 75, secondaryCount: 20, thresholdLimit: 100 });
  assert.equal(critical.status, 'critical');
  assert.equal(critical.scoreBps, 9500);

  assert.throws(() => verifyPaymentLinkLifecycleFlow({ subjectId: '   ' }), /subjectId must be a non-empty string/);
});
