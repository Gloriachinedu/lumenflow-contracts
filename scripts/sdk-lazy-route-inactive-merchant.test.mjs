import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveLazyMerchantRouteStatus } from './sdk-lazy-route-inactive-merchant.mjs';

test('resolveLazyMerchantRouteStatus evaluates healthy, warning, and critical thresholds', () => {
  const healthy = resolveLazyMerchantRouteStatus({ subjectId: 'lf-01', primaryCount: 15, secondaryCount: 10, thresholdLimit: 100 });
  assert.equal(healthy.status, 'healthy');
  assert.equal(healthy.scoreBps, 2500);

  const warning = resolveLazyMerchantRouteStatus({ subjectId: 'lf-02', primaryCount: 40, secondaryCount: 20, thresholdLimit: 100 });
  assert.equal(warning.status, 'warning');
  assert.equal(warning.scoreBps, 6000);

  const critical = resolveLazyMerchantRouteStatus({ subjectId: 'lf-03', primaryCount: 75, secondaryCount: 20, thresholdLimit: 100 });
  assert.equal(critical.status, 'critical');
  assert.equal(critical.scoreBps, 9500);

  assert.throws(() => resolveLazyMerchantRouteStatus({ subjectId: '   ' }), /subjectId must be a non-empty string/);
});
