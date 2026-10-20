import assert from 'node:assert/strict';
import test from 'node:test';
import { exportFlaggedFraudTransactionsCsv } from './dashboard-fraud-csv-export.mjs';

test('exportFlaggedFraudTransactionsCsv evaluates healthy, warning, and critical thresholds', () => {
  const healthy = exportFlaggedFraudTransactionsCsv({ subjectId: 'lf-01', primaryCount: 15, secondaryCount: 10, thresholdLimit: 100 });
  assert.equal(healthy.status, 'healthy');
  assert.equal(healthy.scoreBps, 2500);

  const warning = exportFlaggedFraudTransactionsCsv({ subjectId: 'lf-02', primaryCount: 40, secondaryCount: 20, thresholdLimit: 100 });
  assert.equal(warning.status, 'warning');
  assert.equal(warning.scoreBps, 6000);

  const critical = exportFlaggedFraudTransactionsCsv({ subjectId: 'lf-03', primaryCount: 75, secondaryCount: 20, thresholdLimit: 100 });
  assert.equal(critical.status, 'critical');
  assert.equal(critical.scoreBps, 9500);

  assert.throws(() => exportFlaggedFraudTransactionsCsv({ subjectId: '   ' }), /subjectId must be a non-empty string/);
});
