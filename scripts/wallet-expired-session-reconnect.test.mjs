import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyExpiredWalletSessionReconnect } from './wallet-expired-session-reconnect.mjs';

test('verifyExpiredWalletSessionReconnect evaluates healthy, warning, and critical thresholds', () => {
  const healthy = verifyExpiredWalletSessionReconnect({ subjectId: 'lf-01', primaryCount: 15, secondaryCount: 10, thresholdLimit: 100 });
  assert.equal(healthy.status, 'healthy');
  assert.equal(healthy.scoreBps, 2500);

  const warning = verifyExpiredWalletSessionReconnect({ subjectId: 'lf-02', primaryCount: 40, secondaryCount: 20, thresholdLimit: 100 });
  assert.equal(warning.status, 'warning');
  assert.equal(warning.scoreBps, 6000);

  const critical = verifyExpiredWalletSessionReconnect({ subjectId: 'lf-03', primaryCount: 75, secondaryCount: 20, thresholdLimit: 100 });
  assert.equal(critical.status, 'critical');
  assert.equal(critical.scoreBps, 9500);

  assert.throws(() => verifyExpiredWalletSessionReconnect({ subjectId: '   ' }), /subjectId must be a non-empty string/);
});
