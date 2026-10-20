import assert from 'node:assert/strict';
import test from 'node:test';
import { validateOpenApiSpecContract } from './openapi-spec-pr-validator.mjs';

test('validateOpenApiSpecContract evaluates healthy, warning, and critical thresholds', () => {
  const healthy = validateOpenApiSpecContract({ subjectId: 'lf-01', primaryCount: 15, secondaryCount: 10, thresholdLimit: 100 });
  assert.equal(healthy.status, 'healthy');
  assert.equal(healthy.scoreBps, 2500);

  const warning = validateOpenApiSpecContract({ subjectId: 'lf-02', primaryCount: 40, secondaryCount: 20, thresholdLimit: 100 });
  assert.equal(warning.status, 'warning');
  assert.equal(warning.scoreBps, 6000);

  const critical = validateOpenApiSpecContract({ subjectId: 'lf-03', primaryCount: 75, secondaryCount: 20, thresholdLimit: 100 });
  assert.equal(critical.status, 'critical');
  assert.equal(critical.scoreBps, 9500);

  assert.throws(() => validateOpenApiSpecContract({ subjectId: '   ' }), /subjectId must be a non-empty string/);
});
