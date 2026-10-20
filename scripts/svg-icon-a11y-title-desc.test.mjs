import assert from 'node:assert/strict';
import test from 'node:test';
import { auditSvgIconAccessibilityLabels } from './svg-icon-a11y-title-desc.mjs';

test('auditSvgIconAccessibilityLabels evaluates healthy, warning, and critical thresholds', () => {
  const healthy = auditSvgIconAccessibilityLabels({ subjectId: 'lf-01', primaryCount: 15, secondaryCount: 10, thresholdLimit: 100 });
  assert.equal(healthy.status, 'healthy');
  assert.equal(healthy.scoreBps, 2500);

  const warning = auditSvgIconAccessibilityLabels({ subjectId: 'lf-02', primaryCount: 40, secondaryCount: 20, thresholdLimit: 100 });
  assert.equal(warning.status, 'warning');
  assert.equal(warning.scoreBps, 6000);

  const critical = auditSvgIconAccessibilityLabels({ subjectId: 'lf-03', primaryCount: 75, secondaryCount: 20, thresholdLimit: 100 });
  assert.equal(critical.status, 'critical');
  assert.equal(critical.scoreBps, 9500);

  assert.throws(() => auditSvgIconAccessibilityLabels({ subjectId: '   ' }), /subjectId must be a non-empty string/);
});
