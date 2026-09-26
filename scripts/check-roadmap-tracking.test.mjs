import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { parseRoadmap, checkRoadmap } from './check-roadmap-tracking.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const REAL_ROADMAP = readFileSync(resolve(here, '..', 'ROADMAP.md'), 'utf8');

const VALID = `# Roadmap

## Near-term

- [ ] **Alpha thing** — does alpha
- [x] **Done thing** — already shipped

## Medium-term

- [ ] **Beta thing** — does beta

---

## Unresolved item tracking

### Milestone legend

| Milestone | Meaning |
|---|---|
| \`v0.4\` | Next release |
| \`Backlog\` | Unscheduled |

### Owners and target milestones

| Item | Owner | Target milestone | Tracking issue | Status |
|---|---|---|---|---|
| Alpha thing | @alice | \`v0.4\` | — | In progress |
| Beta thing | maintainers | \`Backlog\` | [#12](x) | Not started |

---
`;

test('parseRoadmap extracts unresolved items, legend, and rows', () => {
  const parsed = parseRoadmap(VALID);
  assert.deepEqual(parsed.unresolvedItems, ['Alpha thing', 'Beta thing']);
  assert.deepEqual(parsed.legendMilestones, ['v0.4', 'Backlog']);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].owner, '@alice');
  assert.equal(parsed.rows[0].milestone, 'v0.4');
  assert.equal(parsed.rows[1].status, 'Not started');
});

test('checkRoadmap passes on a well-formed document', () => {
  assert.deepEqual(checkRoadmap(VALID), []);
});

test('the committed ROADMAP.md passes the check', () => {
  assert.deepEqual(checkRoadmap(REAL_ROADMAP), []);
});

test('flags an untracked unresolved item', () => {
  const md = VALID.replace(
    '| Beta thing | maintainers | `Backlog` | [#12](x) | Not started |\n',
    '',
  );
  const errors = checkRoadmap(md);
  assert.ok(errors.some((e) => e.includes('"Beta thing" is not present in the tracking table')));
});

test('flags an empty owner cell', () => {
  const md = VALID.replace('| Alpha thing | @alice |', '| Alpha thing |  |');
  const errors = checkRoadmap(md);
  assert.ok(errors.some((e) => e.includes('empty Owner cell')));
});

test('flags an empty target milestone cell', () => {
  const md = VALID.replace('| Alpha thing | @alice | `v0.4` |', '| Alpha thing | @alice |  |');
  const errors = checkRoadmap(md);
  assert.ok(errors.some((e) => e.includes('empty Target milestone cell')));
});

test('flags a milestone that is not in the legend', () => {
  const md = VALID.replace('| Alpha thing | @alice | `v0.4` |', '| Alpha thing | @alice | `v9.9` |');
  const errors = checkRoadmap(md);
  assert.ok(errors.some((e) => e.includes('not in the legend')));
});

test('flags an invalid status value', () => {
  const md = VALID.replace('| — | In progress |', '| — | Maybe Later |');
  const errors = checkRoadmap(md);
  assert.ok(errors.some((e) => e.includes('has status "Maybe Later"')));
});

test('flags a tracking row with no matching roadmap item', () => {
  const md = VALID.replace(
    '| Beta thing | maintainers | `Backlog` | [#12](x) | Not started |',
    '| Ghost thing | maintainers | `Backlog` | [#12](x) | Not started |',
  );
  const errors = checkRoadmap(md);
  assert.ok(errors.some((e) => e.includes('"Ghost thing" does not match any unresolved roadmap item')));
});

test('flags a duplicate tracking row', () => {
  const md = VALID.replace(
    '| Beta thing | maintainers | `Backlog` | [#12](x) | Not started |',
    '| Beta thing | maintainers | `Backlog` | [#12](x) | Not started |\n| Alpha thing | @alice | `v0.4` | — | Done |',
  );
  const errors = checkRoadmap(md);
  assert.ok(errors.some((e) => e.includes('appears more than once')));
});
