import assert from 'node:assert/strict';
import test from 'node:test';
import { compareCanaryStablePaymentSuccess } from './grafana-canary-payment-success.mjs';

test('compareCanaryStablePaymentSuccess evaluates healthy, warning, and critical thresholds', () => {
  const healthy = compareCanaryStablePaymentSuccess({ subjectId: 'lf-01', primaryCount: 15, secondaryCount: 10, thresholdLimit: 100 });
  assert.equal(healthy.status, 'healthy');
  assert.equal(healthy.scoreBps, 2500);

  const warning = compareCanaryStablePaymentSuccess({ subjectId: 'lf-02', primaryCount: 40, secondaryCount: 20, thresholdLimit: 100 });
  assert.equal(warning.status, 'warning');
  assert.equal(warning.scoreBps, 6000);

  const critical = compareCanaryStablePaymentSuccess({ subjectId: 'lf-03', primaryCount: 75, secondaryCount: 20, thresholdLimit: 100 });
  assert.equal(critical.status, 'critical');
  assert.equal(critical.scoreBps, 9500);

  assert.throws(() => compareCanaryStablePaymentSuccess({ subjectId: '   ' }), /subjectId must be a non-empty string/);
});
